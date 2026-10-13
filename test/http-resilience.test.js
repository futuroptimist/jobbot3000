import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import {
  fetchWithRetry,
  __resetHttpCircuitBreakersForTest,
  setFetchRateLimit,
  clearFetchRateLimits,
} from "../src/shared/http/fetch.js";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  fetch.mockReset();
  __resetHttpCircuitBreakersForTest();
  clearFetchRateLimits();
  vi.useRealTimers();
});
describe("HTTP resilience", () => {
  it("preserves breaker metadata and reset after body completion", async () => {
    const options = {
      retry: { retries: 0 },
      circuitBreaker: { threshold: 2, resetMs: 60000 },
    };
    fetch.mockRejectedValue(new Error("synthetic failure"));
    for (let i = 0; i < 2; i++) {
      await expect(
        fetchWithRetry("https://example.test", options),
      ).rejects.toMatchObject({ code: "HTTP_STATUS" });
    }
    await expect(
      fetchWithRetry("https://example.test", options),
    ).rejects.toMatchObject({
      name: "CircuitBreakerOpenError",
      circuitKey: "https://example.test",
      retryAt: 60000,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(60000);
    fetch.mockResolvedValue({ body: "recovered" });
    expect(
      await (await fetchWithRetry("https://example.test", options)).text(),
    ).toBe("recovered");
  });
  it("shares breaker identity but excludes policy rejection", async () => {
    const options = {
      retry: { retries: 0 },
      circuitBreaker: { threshold: 1, resetMs: 10000 },
      rateLimitKey: "provider:synthetic",
    };
    await expect(
      fetchWithRetry("http://127.0.0.1", options),
    ).rejects.toMatchObject({ code: "ADDRESS_POLICY" });
    fetch.mockRejectedValue(new Error("synthetic failure"));
    await expect(
      fetchWithRetry("https://one.example.test", options),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
    await expect(
      fetchWithRetry("https://two.example.test", options),
    ).rejects.toMatchObject({
      name: "CircuitBreakerOpenError",
      circuitKey: "provider:synthetic",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("performs two exponential delays under one absolute deadline", async () => {
    const times = [];
    fetch.mockImplementation(async () => {
      times.push(Date.now());
      if (times.length < 3) throw new Error("synthetic reset");
      return { body: "ok" };
    });
    const pending = fetchWithRetry("https://example.test", {
      retry: { delayMs: 25, factor: 2 },
    });
    await vi.advanceTimersByTimeAsync(75);
    expect(await (await pending).text()).toBe("ok");
    expect(times).toEqual([0, 25, 75]);
  });
  it("honors rate intervals including a zero timestamp and zero interval", async () => {
    setFetchRateLimit("provider:synthetic", 1000, { lastInvokedAt: 0 });
    vi.setSystemTime(500);
    fetch.mockResolvedValue({ body: "ok" });
    const pending = fetchWithRetry("https://example.test", {
      rateLimitKey: "provider:synthetic",
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    setFetchRateLimit("provider:synthetic", 0);
    await fetchWithRetry("https://example.test", {
      rateLimitKey: "provider:synthetic",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("counts each completed retry failure toward the breaker", async () => {
    fetch.mockResolvedValue({ status: 503 });
    const options = {
      retry: { delayMs: 0 },
      circuitBreaker: { threshold: 2, resetMs: 1000 },
    };
    const pending = fetchWithRetry("https://example.test", options);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(
      fetchWithRetry("https://example.test", options),
    ).rejects.toMatchObject({ name: "CircuitBreakerOpenError" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
