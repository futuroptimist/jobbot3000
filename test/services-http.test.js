import { afterEach, describe, expect, it, vi } from "vitest";
import { Headers, Response } from "node-fetch";
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

import { createHttpClient } from "../src/services/http.js";
import { clearFetchRateLimits } from "../src/fetch.js";
afterEach(() => {
  fetch.mockReset();
  clearFetchRateLimits();
  vi.useRealTimers();
});
describe("createHttpClient", () => {
  it("merges header forms and returns genuine Responses", async () => {
    fetch.mockResolvedValue({ body: '{"ok":true}' });
    const client = createHttpClient({
      provider: "synthetic",
      defaultHeaders: { Accept: "application/json" },
      defaultRateLimitMs: 0,
    });
    for (const headers of [
      { Authorization: "Bearer synthetic" },
      new Headers({ Authorization: "Bearer synthetic" }),
      [["Authorization", "Bearer synthetic"]],
    ]) {
      const response = await client.request("https://example.test", {
        headers,
      });
      expect(response).toBeInstanceOf(Response);
      expect(await response.json()).toEqual({ ok: true });
      expect(fetch.mock.lastCall[1].headers).toMatchObject({
        "user-agent": "jobbot3000",
        accept: "application/json",
        authorization: "Bearer synthetic",
      });
    }
  });
  it("keeps the caller cancellation and timeout active through body delivery", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(() => new Promise(() => {}));
    const client = createHttpClient({ defaultTimeoutMs: 20 });
    const pending = client
      .request("https://example.test")
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect((await pending).code).toBe("DEADLINE");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("provides GET and JSON helpers with bounded parse errors", async () => {
    fetch
      .mockResolvedValueOnce({ body: '{"ok":true}' })
      .mockResolvedValueOnce({ body: "invalid json" });
    const client = createHttpClient();
    expect(await (await client.get("https://example.test")).json()).toEqual({
      ok: true,
    });
    expect(fetch.mock.calls[0][1].method).toBe("GET");
    await expect(client.json("https://example.test")).rejects.toMatchObject({
      code: "PAYLOAD_INVALID",
    });
  });
});
