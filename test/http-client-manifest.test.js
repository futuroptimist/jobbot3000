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

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdapterHttpClient } from "../src/modules/scraping/adapters/common.js";
import { __resetHttpCircuitBreakersForTest } from "../src/shared/http/fetch.js";
import { __resetHttpClientFeatureConfigForTest } from "../src/shared/http/config.js";

const HTTP_ENV_KEYS = [
  "JOBBOT_HTTP_MAX_RETRIES",
  "JOBBOT_HTTP_BACKOFF_MS",
  "JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD",
  "JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS",
];

const originalEnv = {};

for (const key of HTTP_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

describe("http client manifest defaults", () => {
  afterEach(() => {
    for (const key of HTTP_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fetch.mockReset();
    vi.useRealTimers();
    __resetHttpCircuitBreakersForTest();
    __resetHttpClientFeatureConfigForTest();
  });

  it("applies manifest retry and backoff settings to adapter clients", async () => {
    vi.useFakeTimers();
    process.env.JOBBOT_HTTP_MAX_RETRIES = "1";
    process.env.JOBBOT_HTTP_BACKOFF_MS = "10";
    __resetHttpClientFeatureConfigForTest();

    const httpClient = createAdapterHttpClient({ provider: "test-provider" });
    const firstResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    };
    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    };
    const fetchImpl = fetch
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(successResponse);

    const pending = httpClient.request("https://example.com");
    await vi.advanceTimersByTimeAsync(9);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("opens the circuit breaker using manifest thresholds", async () => {
    process.env.JOBBOT_HTTP_MAX_RETRIES = "0";
    process.env.JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD = "2";
    process.env.JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS = "50";
    __resetHttpClientFeatureConfigForTest();

    const httpClient = createAdapterHttpClient({ provider: "test-provider" });
    let now = 0;
    const clock = { now: () => now };
    const failure = new Error("boom");
    const fetchImpl = fetch.mockRejectedValue(failure);

    await expect(
      httpClient.request("https://example.com", {
        clock,
      }),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });

    await expect(
      httpClient.request("https://example.com", {
        clock,
      }),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });

    await expect(
      httpClient.request("https://example.com", {
        clock,
      }),
    ).rejects.toMatchObject({ name: "CircuitBreakerOpenError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = 75;
    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    };
    fetchImpl.mockResolvedValueOnce(successResponse);

    const response = await httpClient.request("https://example.com", {
      clock,
    });

    expect(await response.json()).toEqual({ ok: true });
  });
});
