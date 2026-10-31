// The fixture replaces internal resolver/socket primitives, never a production fetch option.
vi.mock("../src/shared/http/direct-transport.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");
  const exchange = vi.fn();
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  function socket(event, fields) {
    const value = Object.assign(new EventEmitter(), fields, {
      destroyed: false,
    });
    value.destroy = () => {
      value.destroyed = true;
      value.emit("close");
    };
    Promise.resolve().then(() => {
      if (!value.destroyed) value.emit(event);
    });
    return value;
  }
  const requestPublic = actual.createPublicTransport({
    resolve: lookup,
    tcp: (options) =>
      socket("connect", {
        remoteAddress: options.host,
        remotePort: options.port,
      }),
    secure: (options) =>
      socket("secureConnect", {
        authorized: true,
        getPeerCertificate: () => ({
          subjectaltname: `DNS:${options.servername}`,
        }),
      }),
    request: (url, options, receive) => {
      const req = new EventEmitter();
      const controller = new AbortController();
      req.destroy = () => {
        controller.abort();
        req.emit("close");
      };
      req.end = () => {
        Promise.resolve()
          .then(() =>
            exchange(url.href, { ...options, signal: controller.signal }),
          )
          .then((result) => {
            if (controller.signal.aborted) return;
            const response = Readable.from(
              (async function* () {
                if (result.body !== undefined) yield Buffer.from(result.body);
                else if (result.text) yield Buffer.from(await result.text());
                else if (result.json)
                  yield Buffer.from(JSON.stringify(await result.json()));
              })(),
            );
            response.statusCode = result.status ?? 200;
            response.statusMessage = result.statusText ?? "OK";
            response.complete = true;
            response.rawHeaders = result.rawHeaders ?? [];
            if (result.headers?.get) {
              for (const key of [
                "content-type",
                "etag",
                "last-modified",
                "location",
              ]) {
                const value = result.headers.get(key);
                if (value) response.rawHeaders.push(key, value);
              }
            }
            receive(response);
          })
          .catch((error) => req.emit("error", error));
      };
      return req;
    },
  });
  return { ...actual, requestPublic, exchange, lookup };
});
import { exchange as fetch } from "../src/shared/http/direct-transport.js";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { jobIdFromSource } from "../src/jobs.js";
import {
  createAdapterHttpClient,
  resolveAdapterRateLimit,
  createSnapshot,
  collectPaginatedResults,
} from "../src/jobs/adapters/common.js";

const ENV_VAR = "JOBBOT_TEST_RATE_LIMIT_MS";

describe("adapter common utilities", () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it("resolves rate limits from environment overrides with sane fallbacks", () => {
    const fallback = resolveAdapterRateLimit({
      envVar: ENV_VAR,
      fallbackMs: 750,
    });
    expect(fallback).toBe(750);

    process.env[ENV_VAR] = "1200";
    expect(resolveAdapterRateLimit({ envVar: ENV_VAR, fallbackMs: 750 })).toBe(
      1200,
    );

    process.env[ENV_VAR] = "not-a-number";
    expect(resolveAdapterRateLimit({ envVar: ENV_VAR, fallbackMs: 750 })).toBe(
      750,
    );
  });

  it("creates consistent job snapshots with normalized metadata", () => {
    const snapshot = createSnapshot({
      provider: "example",
      url: "https://jobs.example.com/posting/123",
      raw: "Raw text",
      parsed: { title: "Example" },
      headers: { "User-Agent": "jobbot3000-tests" },
      fetchedAt: "2025-09-24T12:00:00Z",
    });

    expect(snapshot).toMatchObject({
      raw: "Raw text",
      parsed: { title: "Example" },
      source: {
        type: "example",
        value: "https://jobs.example.com/posting/123",
      },
      requestHeaders: { "User-Agent": "jobbot3000-tests" },
      fetchedAt: "2025-09-24T12:00:00Z",
    });
    expect(snapshot.id).toBe(
      jobIdFromSource({
        provider: "example",
        url: "https://jobs.example.com/posting/123",
      }),
    );
  });

  it("collects paginated results until the fetcher signals completion", async () => {
    const calls = [];
    const results = await collectPaginatedResults(
      async ({ offset, pageIndex }) => {
        calls.push({ offset, pageIndex });
        if (pageIndex === 0) {
          return {
            items: ["job-1", "job-2"],
            nextOffset: offset + 2,
          };
        }
        if (pageIndex === 1) {
          return {
            items: ["job-3"],
            done: true,
          };
        }
        throw new Error("should not request a third page");
      },
    );

    expect(results).toEqual(["job-1", "job-2", "job-3"]);
    expect(calls).toEqual([
      { offset: 0, pageIndex: 0 },
      { offset: 2, pageIndex: 1 },
    ]);
  });

  it("creates HTTP clients with adapter defaults applied to requests", async () => {
    const client = createAdapterHttpClient({
      provider: "example",
      headers: { "X-Provider": "example-client" },
      rateLimitMs: 123,
    });

    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map(),
        text: async () => "",
        json: async () => ({}),
      };
    };

    fetch.mockImplementation(fetchImpl);
    await client.request("https://jobs.example.com/listings", {
      rateLimit: { key: "example:test" },
    });

    expect(requests).toHaveLength(1);
    const [{ init }] = requests;
    expect(init.headers["x-provider"]).toBe("example-client");
    expect(init.headers["user-agent"]).toBeTruthy();
  });
});
