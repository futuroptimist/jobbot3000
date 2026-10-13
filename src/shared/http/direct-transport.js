import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import {
  createGunzip,
  createInflate,
  createInflateRaw,
  createBrotliDecompress,
} from "node:zlib";
import { Response, Headers } from "node-fetch";
import {
  admitUrl,
  admitRecords,
  admitOptions,
  redirectHeaders,
  samePeer,
} from "./public-policy.js";
import {
  IngestionError,
  createIngestionBudget,
  assertIngestionBudget,
  createRequestOwner,
  limitsFor,
  waitOwned,
} from "./ingestion-budget.js";

// Register closure ownership at acquisition, before any cancellation can destroy a resource.
class Resources {
  items = new Set();
  closures = [];
  add(item) {
    if (this.items.has(item)) return;
    this.items.add(item);
    if (item.closed !== true) {
      this.closures.push(
        new Promise((resolve) => item.once("close", () => resolve(undefined))),
      );
    }
  }
  destroy() {
    for (const item of this.items) item.destroy();
  }
  async close() {
    this.destroy();
    await Promise.all(this.closures);
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

// Slots are process-wide, independent of provider-supplied rate keys.
let queued = 0;
function semaphore(maximum) {
  let active = 0;
  const queue = [];
  return async (signal) => {
    if (signal.aborted) throw signal.reason;
    if (active >= maximum) {
      if (queued >= 64)
        throw new IngestionError("RUN_LIMIT", "Ingestion queue is full");
      await new Promise((resolve, reject) => {
        queued++;
        const item = {
          resolve: () => {
            queued--;
            cleanup();
            resolve(undefined);
          },
          reject,
        };
        const abort = () => {
          const index = queue.indexOf(item);
          if (index >= 0) {
            queue.splice(index, 1);
            queued--;
          }
          cleanup();
          reject(signal.reason);
        };
        const cleanup = () => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });
        queue.push(item);
      });
    } else active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next) next.resolve();
      else active--;
    };
  };
}
const globalSlot = semaphore(4);
const dialSlot = semaphore(2);
const resolverSlot = semaphore(4);
const origins = new Map();
const rates = new Map();
export function setTransportRate(key, interval, last) {
  if (!interval) rates.delete(key);
  else rates.set(key, { interval, last: last ?? rates.get(key)?.last });
}
export function clearTransportRates() {
  rates.clear();
}
function acquireOrigin(origin, signal) {
  let entry = origins.get(origin);
  if (!entry) {
    entry = { acquire: semaphore(1), users: 0 };
    origins.set(origin, entry);
  }
  entry.users++;
  const leave = () => {
    if (--entry.users === 0) origins.delete(origin);
  };
  return entry.acquire(signal).then(
    (release) => () => {
      release();
      leave();
    },
    (error) => {
      leave();
      throw error;
    },
  );
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(undefined);
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function onceConnected(socket, event, signal, maximum) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      socket.removeListener(event, success);
      socket.removeListener("error", failure);
      socket.removeListener("close", closed);
    };
    const failure = (error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const success = () => {
      cleanup();
      resolve(socket);
    };
    const abort = () => failure(signal.reason);
    const closed = () => failure(new Error("Connection closed"));
    const timer = setTimeout(
      () =>
        failure(
          new IngestionError("DEADLINE", "Connection setup deadline exceeded"),
        ),
      maximum,
    );
    socket.once(event, success);
    socket.once("error", failure);
    socket.once("close", closed);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Internal construction seam: production entry points always use the singleton below.
// Tests supply resolver/socket/HTTP primitives; no request option can replace these.
export function createPublicTransport({
  resolve = (host) => dns.lookup(host, { all: true }),
  tcp = (options) => net.connect(options),
  secure = (options) => tls.connect(options),
  request = (url, options, receive) =>
    (url.protocol === "https:" ? https : http).request(url, options, receive),
} = {}) {
  async function addresses(url, limits, owner) {
    owner.check();
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host))
      return admitRecords(
        [{ address: host, family: net.isIP(host) }],
        limits.records,
      );
    const release = await resolverSlot(owner.signal);
    // Keep the resolver slot until the OS operation settles, even after a timed wait.
    const pending = Promise.resolve()
      .then(() => {
        owner.check();
        return resolve(host);
      })
      .finally(release);
    let records;
    try {
      records = await waitOwned(
        pending,
        owner.signal,
        limits.dnsMs,
        "DNS_UNRESOLVED",
      );
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      throw new IngestionError("DNS_UNRESOLVED", "DNS resolution failed");
    }
    owner.check();
    return admitRecords(records, limits.records);
  }

  async function connect(url, approved, limits, owner, resources) {
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const first = approved[0];
    const second =
      approved.find((item) => item.family !== first.family) ?? approved[1];
    const candidates = second ? [first, second] : [first];
    const controllers = candidates.map(() => new AbortController());
    const cancel = () =>
      controllers.forEach((controller) =>
        controller.abort(owner.signal.reason),
      );
    owner.signal.addEventListener("abort", cancel, { once: true });
    let winner;
    let terminalFailure;
    try {
      const attempts = candidates.map(async (candidate, index) => {
        const controller = controllers[index];
        if (index) await pause(250, controller.signal);
        const release = await dialSlot(controller.signal);
        let socket;
        try {
          owner.check();
          if (controller.signal.aborted) throw controller.signal.reason;
          const start = Date.now();
          socket = tcp({
            host: candidate.address,
            port,
            family: candidate.family,
            autoSelectFamily: false,
            lookup: () => {
              throw new Error("Numeric dial required");
            },
          });
          resources.add(socket);
          // Retain a harmless error sink while destruction completes.
          socket.on("error", () => {});
          await onceConnected(
            socket,
            "connect",
            controller.signal,
            limits.connectMs,
          );
          owner.check();
          if (
            !samePeer(socket.remoteAddress, candidate.address) ||
            socket.remotePort !== port
          ) {
            throw new IngestionError(
              "ADDRESS_POLICY",
              "Connected peer did not match admitted endpoint",
            );
          }
          if (url.protocol === "https:") {
            socket = secure({
              socket,
              servername: net.isIP(host) ? undefined : host,
              rejectUnauthorized: true,
              ALPNProtocols: ["http/1.1"],
              checkServerIdentity: (_name, cert) =>
                tls.checkServerIdentity(host, cert),
            });
            resources.add(socket);
            socket.on("error", () => {});
            try {
              await onceConnected(
                socket,
                "secureConnect",
                controller.signal,
                Math.max(1, limits.connectMs - (Date.now() - start)),
              );
              owner.check();
              if (
                !socket.authorized ||
                tls.checkServerIdentity(host, socket.getPeerCertificate()) ||
                (socket.alpnProtocol && socket.alpnProtocol !== "http/1.1")
              ) {
                throw new Error("TLS identity verification failed");
              }
            } catch (error) {
              if (error instanceof IngestionError || controller.signal.aborted)
                throw error;
              throw new IngestionError(
                "TLS_IDENTITY",
                "TLS identity verification failed",
              );
            }
          }
          if (controller.signal.aborted) throw controller.signal.reason;
          return { socket, index };
        } catch (error) {
          socket?.destroy();
          // A policy/identity error is terminal even if another candidate might succeed.
          if (error instanceof IngestionError && error.code !== "DEADLINE") {
            terminalFailure = error;
            controllers.forEach((other) => other.abort(error));
          }
          throw error;
        } finally {
          release();
        }
      });
      const result = await Promise.any(attempts).catch((error) => {
        throw (
          error.errors?.find((item) => item instanceof IngestionError) ??
          new Error("Connection failed")
        );
      });
      winner = result.socket;
      controllers.forEach((controller, index) => {
        if (index !== result.index)
          controller.abort(new Error("Alternate candidate completed"));
      });
      await Promise.allSettled(attempts);
      if (terminalFailure) throw terminalFailure;
      owner.check();
      return winner;
    } finally {
      owner.signal.removeEventListener("abort", cancel);
      for (const socket of resources)
        if (socket !== winner && !winner) socket.destroy();
    }
  }

  async function hop(url, headers, options, budget, owner, limits) {
    const resources = new Resources();
    const cleanup = () => resources.destroy();
    owner.signal.addEventListener("abort", cleanup, { once: true });
    let agent;
    try {
      owner.check();
      const approved = await addresses(url, limits, owner);
      const socket = await connect(url, approved, limits, owner, resources);
      owner.check();
      agent =
        url.protocol === "https:"
          ? new https.Agent({ keepAlive: false })
          : new http.Agent({ keepAlive: false });
      // Returning undefined is essential: HTTP receives only the callback's vetted socket.
      agent.createConnection = (_options, callback) => {
        callback(null, socket);
        return undefined;
      };
      const response = await waitOwned(
        new Promise((resolveResponse, reject) => {
          owner.check();
          const req = request(
            url,
            {
              method: options.method ?? "GET",
              headers: Object.fromEntries(headers),
              agent,
              maxHeaderSize: limits.headerBytes,
            },
            resolveResponse,
          );
          resources.add(req);
          req.on("error", reject);
          req.end();
        }),
        owner.signal,
      );
      resources.add(response);
      owner.check();
      if (
        response.rawHeaders.reduce(
          (bytes, value) => bytes + Buffer.byteLength(value) + 2,
          0,
        ) > limits.headerBytes
      ) {
        throw new IngestionError("BODY_LIMIT", "Response headers exceed limit");
      }
      const responseHeaders = new Headers();
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        responseHeaders.append(
          response.rawHeaders[i],
          response.rawHeaders[i + 1],
        );
      }
      const status = response.statusCode;
      const nullBody =
        options.method === "HEAD" || status === 204 || status === 304;
      let body = null;
      if (!nullBody) {
        const parts = [];
        let encoded = 0;
        const iterator = response[Symbol.asyncIterator]();
        while (true) {
          const part = await waitOwned(
            iterator.next(),
            owner.signal,
            limits.idleMs,
            "BODY_IDLE",
          );
          owner.check();
          if (part.done) break;
          const chunk = Buffer.from(part.value);
          encoded += chunk.length;
          budget.charge("encoded", chunk.length);
          if (encoded > limits.bodyBytes)
            throw new IngestionError(
              "BODY_LIMIT",
              "Encoded body limit exceeded",
            );
          parts.push(chunk);
        }
        if (!response.complete)
          throw new IngestionError(
            "PAYLOAD_INVALID",
            "Truncated response body",
          );
        const length = responseHeaders.get("content-length");
        if (
          length !== null &&
          (!/^\d+$/.test(length) || Number(length) !== encoded)
        ) {
          throw new IngestionError(
            "PAYLOAD_INVALID",
            "Response body length mismatch",
          );
        }
        const encodedBody = Buffer.concat(parts);
        const encoding = (responseHeaders.get("content-encoding") || "identity")
          .trim()
          .toLowerCase();
        let decoder;
        if (encoding === "gzip" || encoding === "x-gzip")
          decoder = createGunzip();
        else if (encoding === "br") decoder = createBrotliDecompress();
        else if (encoding === "deflate" || encoding === "x-deflate") {
          decoder =
            (encodedBody[0] & 15) === 8 ? createInflate() : createInflateRaw();
        } else if (encoding !== "identity") {
          throw new IngestionError(
            "PAYLOAD_INVALID",
            "Unsupported content encoding",
          );
        }
        const decoded = [];
        let total = 0;
        const source = Readable.from([encodedBody]);
        resources.add(source);
        const stream = decoder ? source.pipe(decoder) : source;
        resources.add(stream);
        try {
          const decodedIterator = stream[Symbol.asyncIterator]();
          while (true) {
            const part = await waitOwned(decodedIterator.next(), owner.signal);
            owner.check();
            if (part.done) break;
            total += part.value.length;
            budget.charge("decoded", part.value.length);
            if (total > limits.bodyBytes)
              throw new IngestionError(
                "BODY_LIMIT",
                "Decoded body limit exceeded",
              );
            decoded.push(part.value);
          }
        } catch (error) {
          if (error instanceof IngestionError) throw error;
          throw new IngestionError(
            "PAYLOAD_INVALID",
            "Invalid encoded response body",
          );
        }
        body = Buffer.concat(decoded);
      }
      owner.check();
      return {
        body,
        status,
        statusText: response.statusMessage,
        headers: responseHeaders,
      };
    } finally {
      agent?.destroy();
      await resources.close();
      owner.signal.removeEventListener("abort", cleanup);
    }
  }

  return async function requestPublic(
    input,
    options = {},
    suppliedBudget,
    onAttemptFailure = () => {},
  ) {
    if (
      /^(1|true|yes|on|enabled)$/i.test(
        String(process.env.JOBBOT_OFFLINE || "").trim(),
      )
    ) {
      throw new IngestionError(
        "URL_POLICY",
        "Offline mode enabled via JOBBOT_OFFLINE",
      );
    }
    const budget =
      suppliedBudget ??
      options.budget ??
      createIngestionBudget({ signal: options.signal });
    assertIngestionBudget(budget);
    const perRequestKeys = new Set([
      "bodyBytes",
      "listBytes",
      "requestMs",
      "dnsMs",
      "connectMs",
      "idleMs",
      "retries",
      "redirects",
      "records",
      "headerBytes",
      "urlBytes",
    ]);
    if (
      Object.keys(options.limits ?? {}).some((key) => !perRequestKeys.has(key))
    ) {
      throw new IngestionError(
        "URL_POLICY",
        "Run limits require a constructed ingestion context",
      );
    }
    const reduced = limitsFor(options.limits, budget.limits);
    const kindCap =
      options.bodyKind === "list" ? reduced.listBytes : reduced.bodyBytes;
    /** @type {Record<string, number>} */
    const limits = {
      ...reduced,
      bodyBytes: options.maxBytes === undefined ? kindCap : options.maxBytes,
    };
    if (
      !Number.isSafeInteger(limits.bodyBytes) ||
      limits.bodyBytes < 1 ||
      limits.bodyBytes > kindCap
    ) {
      throw new IngestionError("URL_POLICY", "Invalid response byte limit");
    }
    // listBytes has a separate ceiling from text/detail bytes.
    const initial = admitUrl(input);
    if (Buffer.byteLength(String(input)) > limits.urlBytes) {
      throw new IngestionError(
        "URL_POLICY",
        "URL length exceeds request limit",
      );
    }
    const initialHeaders = admitOptions(options);
    const retries =
      options.retry?.retries === undefined
        ? limits.retries
        : options.retry.retries;
    limitsFor({ retries }, limits);
    const delay = options.retry?.delayMs ?? 250;
    const factor = options.retry?.factor ?? 2;
    const maxDelay = options.retry?.maxDelayMs ?? 60000;
    if (
      !Number.isSafeInteger(delay) ||
      delay < 0 ||
      !Number.isFinite(factor) ||
      factor < 1 ||
      !Number.isSafeInteger(maxDelay) ||
      maxDelay < 0 ||
      options.retry?.shouldRetry !== undefined
    ) {
      throw new IngestionError("URL_POLICY", "Invalid retry configuration");
    }
    const owner = createRequestOwner(
      budget,
      options.timeoutMs === undefined ? limits.requestMs : options.timeoutMs,
      options.signal,
    );
    let releaseGlobal;
    let redirects = 0;
    try {
      releaseGlobal = await globalSlot(owner.signal);
      for (let attempt = 0; ; attempt++) {
        let current = initial;
        let headers = initialHeaders;
        const visited = new Set([current.href]);
        try {
          while (true) {
            owner.check();
            const releaseOrigin = await acquireOrigin(
              current.origin,
              owner.signal,
            );
            let result;
            const rate = rates.get(options.rateLimitKey ?? current.origin);
            try {
              if (rate?.last !== undefined) {
                await pause(
                  Math.max(0, rate.interval - (Date.now() - rate.last)),
                  owner.signal,
                );
              }
              owner.check();
              budget.charge("attempts");
              result = await hop(
                current,
                headers,
                options,
                budget,
                owner,
                limits,
              );
            } finally {
              if (rate) rate.last = Date.now();
              releaseOrigin();
            }
            if ([301, 302, 303, 307, 308].includes(result.status)) {
              const location = result.headers.get("location");
              if (!location || redirects >= limits.redirects) {
                throw new IngestionError(
                  "REDIRECT_POLICY",
                  "Missing redirect location or redirect limit exceeded",
                );
              }
              let next;
              try {
                next = admitUrl(new URL(location, current));
                if (Buffer.byteLength(next.href) > limits.urlBytes)
                  throw new Error();
              } catch {
                throw new IngestionError(
                  "REDIRECT_POLICY",
                  "Redirect target refused",
                );
              }
              if (visited.has(next.href))
                throw new IngestionError(
                  "REDIRECT_POLICY",
                  "Redirect loop refused",
                );
              const queryCredential =
                options.credentialQuery === true ||
                [...current.searchParams.keys()].some((key) =>
                  /^(token|access_token|api_key|key|signature)$/i.test(key),
                );
              headers = redirectHeaders(
                current,
                next,
                headers,
                queryCredential,
              );
              visited.add(next.href);
              current = next;
              redirects++;
              continue;
            }
            if (
              result.status === 429 ||
              (result.status >= 500 && result.status < 600)
            )
              onAttemptFailure();
            if (
              attempt < retries &&
              (result.status === 429 ||
                (result.status >= 500 && result.status < 600))
            )
              break;
            return new Response(
              result.body,
              /** @type {any} */ ({
                ...result,
                url: current.href,
                counter: redirects,
                size: limits.bodyBytes,
              }),
            );
          }
        } catch (error) {
          owner.check();
          if (!(error instanceof IngestionError)) onAttemptFailure();
          if (error instanceof IngestionError || attempt >= retries)
            throw error;
        }
        await pause(
          Math.min(delay * factor ** attempt, maxDelay),
          owner.signal,
        );
      }
    } catch (error) {
      const failure =
        error instanceof IngestionError
          ? error
          : new IngestionError("HTTP_STATUS", "Public request failed");
      throw budget.annotate(failure);
    } finally {
      releaseGlobal?.();
      owner.close();
    }
  };
}
export const requestPublic = createPublicTransport();
