import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Duplex } from "node:stream";
import net from "node:net";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import {
  gzipSync,
  deflateSync,
  deflateRawSync,
  brotliCompressSync,
} from "node:zlib";
import { Response } from "node-fetch";
import { createPublicTransport } from "../src/shared/http/direct-transport.js";
import { createIngestionBudget } from "../src/shared/http/ingestion-budget.js";

const nativeRequest = http.request;
const publicRecord = { address: "93.184.216.34", family: 4 };
function fakeSocket(event, fields = {}) {
  const socket = Object.assign(new EventEmitter(), fields, {
    destroyed: false,
  });
  socket.destroy = vi.fn(() => {
    if (!socket.destroyed) {
      socket.destroyed = true;
      socket.emit("close");
    }
  });
  if (event)
    Promise.resolve().then(() => {
      if (!socket.destroyed) socket.emit(event);
    });
  return socket;
}
function harness({
  answers = [publicRecord],
  reply = () => ({}),
  tcp,
  secure,
} = {}) {
  const sockets = [];
  const responses = [];
  const requests = [];
  const resolve = vi.fn(async () => answers);
  const dial = vi.fn((options) => {
    const socket = tcp
      ? tcp(options)
      : fakeSocket("connect", {
          remoteAddress: options.host,
          remotePort: options.port,
        });
    sockets.push(socket);
    return socket;
  });
  const wrap = vi.fn((options) => {
    const socket = secure
      ? secure(options)
      : fakeSocket("secureConnect", {
          authorized: true,
          getPeerCertificate: () =>
            options.servername
              ? { subjectaltname: `DNS:${options.servername}` }
              : { subjectaltname: `IP Address:${publicRecord.address}` },
        });
    sockets.push(socket);
    return socket;
  });
  const request = vi.fn((url, options, receive) => {
    const req = fakeSocket();
    requests.push(req);
    options.agent.createConnection({}, (error, socket) => {
      expect(error).toBeNull();
      expect(socket.destroyed).toBe(false);
    });
    req.end = () => {
      Promise.resolve()
        .then(() => reply(url, options))
        .then((result) => {
          if (req.destroyed) return;
          if (result.error) {
            req.emit("error", result.error);
            return;
          }
          if (result.noHeaders) return;
          const response =
            result.stream ??
            Readable.from(result.chunks ?? [Buffer.from(result.body ?? "ok")]);
          Object.assign(response, {
            statusCode: result.status ?? 200,
            statusMessage: "Synthetic",
            rawHeaders: Object.entries(result.headers ?? {}).flat(),
            complete: result.complete ?? true,
          });
          responses.push(response);
          receive(response);
        })
        .catch((error) => req.emit("error", error));
    };
    return req;
  });
  const run = createPublicTransport({
    resolve,
    tcp: dial,
    secure: wrap,
    request,
  });
  return { run, resolve, dial, wrap, request, sockets, responses, requests };
}
beforeEach(() => {
  // Any accidentally reached real connector fails immediately, including production defaults.
  const deny = () => {
    throw new Error("REAL NETWORK CONNECTOR REACHED");
  };
  vi.spyOn(net, "connect").mockImplementation(deny);
  vi.spyOn(tls, "connect").mockImplementation(deny);
  vi.spyOn(dns, "lookup").mockImplementation(deny);
  vi.spyOn(http, "request").mockImplementation(deny);
  vi.spyOn(https, "request").mockImplementation(deny);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.JOBBOT_OFFLINE;
});

describe("direct transport without real networking", () => {
  it("pins an immutable DNS result despite a subsequent resolver answer change", async () => {
    const records = [{ ...publicRecord }];
    const h = harness({ answers: records });
    h.resolve
      .mockImplementationOnce(async () => records)
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const response = await h.run("http://example.test/a");
    expect(await response.text()).toBe("ok");
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.dial.mock.calls[0][0]).toMatchObject({
      host: publicRecord.address,
      family: 4,
      port: 80,
      autoSelectFamily: false,
    });
    expect(() => h.dial.mock.calls[0][0].lookup()).toThrow(
      "Numeric dial required",
    );
    expect(h.sockets.every((socket) => socket.destroyed)).toBe(true);
  });
  it.each([
    [[]],
    [[{ address: "127.0.0.1", family: 4 }]],
    [[{ address: "8.8.8.8", family: 6 }]],
  ])("never dials inadmissible DNS %j", async (answers) => {
    const h = harness({ answers });
    await expect(h.run("http://example.test")).rejects.toThrow();
    expect(h.dial).not.toHaveBeenCalled();
  });
  it.each([
    { remoteAddress: "127.0.0.1", remotePort: 80 },
    { remoteAddress: publicRecord.address, remotePort: 81 },
  ])("checks peer before HTTP %j", async (peer) => {
    const h = harness({ tcp: () => fakeSocket("connect", peer) });
    await expect(h.run("http://example.test")).rejects.toMatchObject({
      code: "ADDRESS_POLICY",
    });
    expect(h.request).not.toHaveBeenCalled();
    expect(h.sockets[0].destroyed).toBe(true);
  });
  it("accepts mapped OS peer notation but uses logical TLS identity", async () => {
    const h = harness({
      tcp: (options) =>
        fakeSocket("connect", {
          remoteAddress: `::ffff:${options.host}`,
          remotePort: options.port,
        }),
    });
    await h.run("https://EXAMPLE.test.:8443/a");
    expect(h.wrap.mock.calls[0][0]).toMatchObject({
      servername: "example.test",
      rejectUnauthorized: true,
      ALPNProtocols: ["http/1.1"],
    });
    expect(h.request.mock.calls[0][0].host).toBe("example.test:8443");
    expect(h.request.mock.calls[0][1].headers.host).toBeUndefined();
  });
  it("omits SNI for IP literals and verifies the IP certificate", async () => {
    const h = harness();
    await h.run(`https://${publicRecord.address}/`);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.wrap.mock.calls[0][0].servername).toBeUndefined();
  });
  it("rejects TLS mismatch before HTTP and never retries it", async () => {
    const h = harness({
      secure: () =>
        fakeSocket("secureConnect", {
          authorized: true,
          getPeerCertificate: () => ({
            subjectaltname: "DNS:wrong.example.test",
          }),
        }),
    });
    await expect(h.run("https://example.test")).rejects.toMatchObject({
      code: "TLS_IDENTITY",
    });
    expect(h.dial).toHaveBeenCalledTimes(1);
    expect(h.request).not.toHaveBeenCalled();
  });
  it("starts the approved alternate family at 250ms and destroys the stalled loser", async () => {
    vi.useFakeTimers();
    const h = harness({
      answers: [{ address: "2606:4700:4700::1111", family: 6 }, publicRecord],
      tcp: (options) =>
        fakeSocket(options.family === 6 ? undefined : "connect", {
          remoteAddress: options.host,
          remotePort: options.port,
        }),
    });
    const pending = h.run("http://example.test");
    await vi.advanceTimersByTimeAsync(249);
    expect(h.dial).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(h.dial).toHaveBeenCalledTimes(2);
    expect(h.sockets.every((socket) => socket.destroyed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([301, 302, 303, 307, 308])(
    "admits redirect %s separately and returns a genuine Response",
    async (status) => {
      const h = harness({
        reply: (url) =>
          url.pathname === "/a"
            ? { status, headers: { location: "/b?opaque=x%2Fy" } }
            : {
                body: '{"synthetic":true}',
                headers: { "content-type": "application/json" },
              },
      });
      const response = await h.run("https://example.test/a");
      expect(response).toBeInstanceOf(Response);
      expect(response.url).toBe("https://example.test/b?opaque=x%2Fy");
      expect(response.redirected).toBe(true);
      expect(response.bodyUsed).toBe(false);
      const clone = response.clone();
      expect(await response.json()).toEqual({ synthetic: true });
      expect(response.bodyUsed).toBe(true);
      expect(await clone.text()).toBe('{"synthetic":true}');
      expect(h.resolve).toHaveBeenCalledTimes(2);
      expect(h.sockets.every((socket) => socket.destroyed)).toBe(true);
    },
  );
  it.each([
    "http://127.0.0.1/",
    "https://example.test/a",
    "http://example.test/b",
    "http://[bad]",
  ])("refuses redirect %s before another dial", async (location) => {
    const h = harness({
      reply: () => ({ status: 302, headers: { location } }),
    });
    await expect(h.run("https://example.test/a")).rejects.toMatchObject({
      code: "REDIRECT_POLICY",
    });
    expect(h.dial).toHaveBeenCalledTimes(1);
  });
  it("refuses missing locations and a zero redirect budget", async () => {
    for (const headers of [{}, { location: "/b" }]) {
      const h = harness({ reply: () => ({ status: 302, headers }) });
      await expect(
        h.run("https://example.test/a", { limits: { redirects: 0 } }),
      ).rejects.toMatchObject({ code: "REDIRECT_POLICY" });
      expect(h.dial).toHaveBeenCalledTimes(1);
    }
  });
  it("allows credentialless CDN redirects and upgrades while removing validators", async () => {
    const h = harness({
      reply: (url) =>
        url.protocol === "http:"
          ? {
              status: 302,
              headers: { location: "https://cdn.example.test/b?q=opaque" },
            }
          : {},
    });
    await h.run("http://example.test/a", {
      headers: { "If-None-Match": "synthetic", Accept: "text/plain" },
    });
    expect(h.request.mock.calls[1][1].headers).toMatchObject({
      accept: "text/plain",
    });
    expect(h.request.mock.calls[1][1].headers["if-none-match"]).toBeUndefined();
  });
  it.each([
    { Authorization: "Bearer synthetic" },
    { Cookie: "synthetic=1" },
    { "X-Unknown": "opaque" },
  ])("blocks credentialed cross-origin redirects %j", async (headers) => {
    const h = harness({
      reply: () => ({
        status: 302,
        headers: { location: "https://cdn.example.test/" },
      }),
    });
    await expect(
      h.run("https://example.test/a", { headers }),
    ).rejects.toMatchObject({ code: "REDIRECT_POLICY" });
    expect(h.dial).toHaveBeenCalledTimes(1);
  });
  it("redacts query content from failure diagnostics", async () => {
    const h = harness({
      reply: () => ({
        status: 302,
        headers: { location: "https://cdn.example.test/" },
      }),
    });
    const error = await h
      .run("https://example.test/?token=synthetic-private-marker")
      .catch((error) => error);
    expect(error.code).toBe("REDIRECT_POLICY");
    expect(String(error)).not.toContain("synthetic-private-marker");
  });
  it.each(["idle", "absolute"])(
    "owns cancellation through a %s body stall",
    async (kind) => {
      vi.useFakeTimers();
      const stream = new Readable({ read() {} });
      const h = harness({ reply: () => ({ stream }) });
      const pending = h
        .run("http://example.test", {
          timeoutMs: kind === "absolute" ? 30 : 100,
          limits: { idleMs: kind === "idle" ? 20 : 50 },
        })
        .catch((error) => error);
      await vi.advanceTimersByTimeAsync(100);
      expect((await pending).code).toBe(
        kind === "idle" ? "BODY_IDLE" : "DEADLINE",
      );
      expect(stream.destroyed).toBe(true);
      expect(h.requests.every((req) => req.destroyed)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("the absolute deadline stops endless slow trickles", async () => {
    vi.useFakeTimers();
    const stream = new Readable({ read() {} });
    const interval = setInterval(() => stream.push(Buffer.from("x")), 5);
    const h = harness({ reply: () => ({ stream }) });
    const pending = h
      .run("http://example.test", { timeoutMs: 30, limits: { idleMs: 10 } })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(30);
    expect((await pending).code).toBe("DEADLINE");
    clearInterval(interval);
    expect(stream.destroyed).toBe(true);
  });
  it.each([
    ["gzip", gzipSync],
    ["br", brotliCompressSync],
    ["deflate", deflateSync],
    ["deflate", deflateRawSync],
  ])("bounds and decodes %s", async (encoding, compress) => {
    const body = compress(Buffer.from("synthetic content"));
    const h = harness({
      reply: () => ({ body, headers: { "content-encoding": encoding } }),
    });
    expect(await (await h.run("https://example.test")).text()).toBe(
      "synthetic content",
    );
    const bomb = harness({
      reply: () => ({
        body: compress(Buffer.alloc(10000, "x")),
        headers: { "content-encoding": encoding },
      }),
    });
    await expect(
      bomb.run("https://example.test", { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: "BODY_LIMIT" });
  });
  it.each([
    { body: "12345" },
    { body: "12345", headers: { "content-length": "1" } },
  ])("bounds encoded bytes regardless of length %j", async (reply) => {
    const h = harness({ reply: () => reply });
    await expect(
      h.run("http://example.test", { maxBytes: 4 }),
    ).rejects.toMatchObject({ code: "BODY_LIMIT" });
  });
  it.each([
    { complete: false },
    { headers: { "content-length": "20" } },
    { headers: { "content-encoding": "gzip, br" } },
    { body: "broken", headers: { "content-encoding": "gzip" } },
  ])("rejects malformed body %j", async (reply) => {
    const h = harness({ reply: () => reply });
    await expect(h.run("http://example.test")).rejects.toMatchObject({
      code: "PAYLOAD_INVALID",
    });
    expect(h.dial).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["HEAD", 200],
    ["GET", 204],
    ["GET", 304],
  ])("handles null %s/%s representation length", async (method, status) => {
    const h = harness({
      reply: () => ({
        status,
        headers: {
          "content-length": "999999999",
          "content-encoding": "unsupported",
        },
      }),
    });
    const response = await h.run("https://example.test", { method });
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
  });
  it("charges retry and redirect traffic to one request/run budget", async () => {
    let count = 0;
    const budget = createIngestionBudget();
    const h = harness({
      reply: () =>
        ++count < 3 ? { status: 503, body: "err" } : { body: "ok" },
    });
    await h.run("http://example.test", { retry: { delayMs: 0 } }, budget);
    expect(budget.counts).toMatchObject({
      attempts: 3,
      encoded: 8,
      decoded: 8,
    });
    expect(h.responses.every((response) => response.destroyed)).toBe(true);
  });
  it("does not reset the deadline when retry backoff exhausts it", async () => {
    vi.useFakeTimers();
    const h = harness({ reply: () => ({ status: 503 }) });
    const pending = h
      .run("http://example.test", { timeoutMs: 50 })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).code).toBe("DEADLINE");
    expect(h.dial).toHaveBeenCalledTimes(1);
  });
  it("ignores late DNS after cancellation and never opens a connection", async () => {
    let finish;
    const h = harness();
    h.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = h
      .run("http://example.test", { signal: controller.signal })
      .catch((error) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.abort();
    expect((await pending).code).toBe("DEADLINE");
    finish([publicRecord]);
    await Promise.resolve();
    expect(h.dial).not.toHaveBeenCalled();
  });
  it.each(["tcp", "tls", "headers", "body"])(
    "closes late cancellation in %s phase",
    async (phase) => {
      const h = harness({
        tcp:
          phase === "tcp"
            ? (options) =>
                fakeSocket(undefined, {
                  remoteAddress: options.host,
                  remotePort: options.port,
                })
            : undefined,
        secure: phase === "tls" ? () => fakeSocket() : undefined,
        reply: () =>
          phase === "headers"
            ? { noHeaders: true }
            : { stream: new Readable({ read() {} }) },
      });
      const controller = new AbortController();
      const pending = h
        .run("https://example.test", { signal: controller.signal })
        .catch((error) => error);
      await vi.waitFor(() =>
        expect(
          phase === "tcp" ? h.dial : phase === "tls" ? h.wrap : h.request,
        ).toHaveBeenCalled(),
      );
      controller.abort();
      expect((await pending).code).toBe("DEADLINE");
      expect(h.sockets.every((socket) => socket.destroyed)).toBe(true);
    },
  );
  it("holds the origin slot through the body even with different rate keys", async () => {
    const stream = new Readable({ read() {} });
    let count = 0;
    const h = harness({ reply: () => (++count === 1 ? { stream } : {}) });
    const first = h.run("http://example.test/a", { rateLimitKey: "one" });
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    const second = h.run("http://example.test/b", { rateLimitKey: "two" });
    await Promise.resolve();
    expect(h.request).toHaveBeenCalledTimes(1);
    stream.push(null);
    await Promise.all([first, second]);
    expect(h.request).toHaveBeenCalledTimes(2);
  });
  it("releases origin locks before reciprocal redirects", async () => {
    const h = harness({
      reply: (url) =>
        url.pathname === "/a"
          ? {
              status: 302,
              headers: {
                location:
                  "http://" +
                  (url.hostname === "one.example.test" ? "two" : "one") +
                  ".example.test/b",
              },
            }
          : {},
    });
    const responses = await Promise.all(
      ["one", "two"].map((host) => h.run(`http://${host}.example.test/a`)),
    );
    expect(responses.every((response) => response.ok)).toBe(true);
    expect(h.request).toHaveBeenCalledTimes(4);
  });
  it("bounds the queue and cancels requests before dialing", async () => {
    const controller = new AbortController();
    const h = harness({ reply: () => ({ noHeaders: true }) });
    const pending = Array.from({ length: 69 }, (_, i) =>
      h
        .run(`http://host${i}.example.test/`, {
          signal: controller.signal,
        })
        .catch((error) => error),
    );
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(4));
    controller.abort();
    const results = await Promise.all(pending);
    expect(
      results.filter((result) => result.code === "RUN_LIMIT").length,
    ).toBeGreaterThanOrEqual(1);
    expect(h.dial).toHaveBeenCalledTimes(4);
  });
  it("offline and invalid request options cannot reach the resolver", async () => {
    const h = harness();
    process.env.JOBBOT_OFFLINE = "enabled";
    await expect(h.run("https://example.test")).rejects.toMatchObject({
      code: "URL_POLICY",
    });
    delete process.env.JOBBOT_OFFLINE;
    await expect(
      h.run("https://example.test", { fetchImpl: vi.fn() }),
    ).rejects.toMatchObject({ code: "URL_POLICY" });
    expect(h.resolve).not.toHaveBeenCalled();
  });
  it("qualifies the installed Node Agent callback against an in-memory socket", async () => {
    let wire = "";
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        wire += chunk.toString();
        callback();
        if (wire.includes("\r\n\r\n"))
          this.push("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
      },
    });
    Object.assign(socket, {
      remoteAddress: publicRecord.address,
      remotePort: 80,
    });
    const transport = createPublicTransport({
      resolve: async () => [publicRecord],
      tcp: () => {
        Promise.resolve().then(() => socket.emit("connect"));
        return socket;
      },
      request: (url, options, receive) => nativeRequest(url, options, receive),
    });
    expect(await (await transport("http://example.test/path")).text()).toBe(
      "ok",
    );
    expect(wire).toContain("Host: example.test\r\n");
    expect(wire).toContain("GET /path HTTP/1.1");
    expect(socket.destroyed).toBe(true);
    expect(net.connect).not.toHaveBeenCalled();
  });
  it("enforces reduced per-request limits and rejects fake contexts", async () => {
    const h = harness({ reply: () => ({ body: "12345" }) });
    await expect(
      h.run("http://example.test", { limits: { bodyBytes: 4 } }),
    ).rejects.toMatchObject({ code: "BODY_LIMIT" });
    const before = h.dial.mock.calls.length;
    for (const options of [
      { maxBytes: null },
      { timeoutMs: null },
      { limits: { retries: 0 }, retry: { retries: 1 } },
      { limits: { urlBytes: 5 } },
      { limits: { runBytes: 1 } },
      { budget: { check() {}, limits: {} } },
    ]) {
      await expect(h.run("http://example.test", options)).rejects.toMatchObject(
        { code: "URL_POLICY" },
      );
    }
    expect(h.dial).toHaveBeenCalledTimes(before);
  });
  it("enforces the reduced requestMs limit through header waits", async () => {
    vi.useFakeTimers();
    const h = harness({ reply: () => ({ noHeaders: true }) });
    const pending = h
      .run("http://example.test", { limits: { requestMs: 5 } })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(5);
    expect((await pending).code).toBe("DEADLINE");
  });
  it("bounds outstanding resolver work after timeout and ignores every late answer", async () => {
    vi.useFakeTimers();
    const finish = [];
    const h = harness();
    h.resolve.mockImplementation(
      () => new Promise((resolve) => finish.push(resolve)),
    );
    const pending = Array.from({ length: 5 }, (_, i) =>
      h
        .run(`http://dns${i}.example.test`, {
          timeoutMs: 50,
          limits: { dnsMs: 5 },
        })
        .catch((error) => error),
    );
    await vi.advanceTimersByTimeAsync(50);
    const errors = await Promise.all(pending);
    expect(h.resolve).toHaveBeenCalledTimes(4);
    expect(
      errors.filter((error) => error.code === "DNS_UNRESOLVED"),
    ).toHaveLength(4);
    expect(errors.filter((error) => error.code === "DEADLINE")).toHaveLength(1);
    finish.forEach((resolve) => resolve([publicRecord]));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.dial).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a queued same-origin request without affecting the active body", async () => {
    const stream = new Readable({ read() {} });
    const h = harness({ reply: () => ({ stream }) });
    const first = h.run("http://example.test/a");
    await vi.waitFor(() => expect(h.responses).toHaveLength(1));
    const controller = new AbortController();
    const queued = h
      .run("http://example.test/b", { signal: controller.signal })
      .catch((error) => error);
    controller.abort();
    expect((await queued).code).toBe("DEADLINE");
    expect(stream.destroyed).toBe(false);
    expect(h.request).toHaveBeenCalledTimes(1);
    stream.push(null);
    await first;
  });
  it("bounds retry bytes and attempts before another connection", async () => {
    for (const limits of [{ runBytes: 3 }, { attempts: 1 }]) {
      const budget = createIngestionBudget({ limits });
      const h = harness({ reply: () => ({ status: 503, body: "four" }) });
      await expect(
        h.run("http://example.test", { retry: { delayMs: 0 } }, budget),
      ).rejects.toMatchObject({ code: "RUN_LIMIT" });
      expect(h.dial).toHaveBeenCalledTimes(1);
    }
  });
  it("does not retry statuses outside 429 and the 5xx range", async () => {
    const h = harness({ reply: () => ({ status: 600 }) });
    expect((await h.run("https://example.test")).status).toBe(600);
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});
