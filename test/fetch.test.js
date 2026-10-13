import { describe, it, expect, vi, afterEach } from "vitest";
import { Headers } from "node-fetch";
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
import {
  exchange as fetch,
  lookup,
} from "../src/shared/http/direct-transport.js";

import {
  extractTextFromHtml,
  fetchTextFromUrl,
  clearFetchRateLimits,
} from "../src/fetch.js";
describe("extractTextFromHtml", () => {
  it("collapses whitespace and skips non-content tags", () => {
    const html = `
      <html>
        <head>
          <style>.a {}</style>
          <script>1</script>
        </head>
        <body>
          <nav>ignored</nav>
          <p>First   line</p>
          <p>Second line</p>
          <footer>ignored</footer>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe("First line Second line");
  });

  it("omits aside content", () => {
    const html = `
      <html>
        <body>
          <p>Main</p>
          <aside>ignored</aside>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe("Main");
  });

  it("omits header content", () => {
    const html = `
      <html>
        <body>
          <header>ignored</header>
          <p>Main</p>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe("Main");
  });

  it("omits noscript content", () => {
    const html = `
      <html>
        <body>
          <noscript>ignored</noscript>
          <p>Main</p>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe("Main");
  });

  it("includes img alt text without src", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start Logo End");
  });

  it("includes img aria-label when alt is missing", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" aria-label="Logo" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start Logo End");
  });

  it("omits img when aria-hidden is true", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="true" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("omits img without alt text", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("omits img alt text when aria-hidden is true", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="true" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("omits img alt text when aria-hidden uses uppercase true", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="TRUE" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("omits img alt text when aria-hidden uses numeric true", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="1" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("omits img alt text when aria-hidden is present without a value", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("omits img alt text when role is presentation", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" role="presentation" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("omits img alt text when role casing varies", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Decorative" role="Presentation" />
      <img src="logo.png" alt="Another" role="None" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start End");
  });

  it("includes img alt text when aria-hidden is false-like", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="FALSE" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start Logo End");
  });

  it("includes aria-label text when alt is missing", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" aria-label="Logo" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start Logo End");
  });

  it("falls back to aria-label when alt text is whitespace", () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="   " aria-label=" Logo " />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe("Start Logo End");
  });

  it("returns empty string for falsy input", () => {
    expect(extractTextFromHtml("")).toBe("");
    // @ts-expect-error testing null input
    expect(extractTextFromHtml(null)).toBe("");
    // @ts-expect-error testing undefined input
    expect(extractTextFromHtml()).toBe("");
  });
});

afterEach(() => {
  fetch.mockReset();
  lookup.mockClear();
  clearFetchRateLimits();
  delete process.env.JOBBOT_OFFLINE;
  vi.useRealTimers();
});
describe("public text ingestion", () => {
  it.each(["1", "true", "yes", "on", "enabled"])(
    "offline %s makes no resolver calls",
    async (value) => {
      process.env.JOBBOT_OFFLINE = value;
      await expect(
        fetchTextFromUrl("https://example.test"),
      ).rejects.toMatchObject({ code: "URL_POLICY" });
      expect(lookup).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["0", "false", "off", "disabled", ""])(
    "falsy offline %s permits bounded text",
    async (value) => {
      process.env.JOBBOT_OFFLINE = value;
      fetch.mockResolvedValue({ body: "  synthetic  " });
      expect(await fetchTextFromUrl("https://example.test")).toBe("synthetic");
    },
  );
  it("converts HTML after the complete body and trims plain/missing-type text", async () => {
    fetch
      .mockResolvedValueOnce({
        body: '<p>Synthetic <img alt="label"></p>',
        headers: new Headers({ "content-type": "text/html" }),
      })
      .mockResolvedValue({ body: " text " });
    expect(await fetchTextFromUrl("https://example.test")).toBe(
      "Synthetic label",
    );
    expect(await fetchTextFromUrl("https://example.test")).toBe("text");
  });
  it.each([
    { headers: { "X-Synthetic": "one" } },
    { headers: new Headers({ "X-Synthetic": "one" }) },
    { headers: [["X-Synthetic", "one"]] },
  ])("preserves object/Headers/iterable input %j", async ({ headers }) => {
    fetch.mockResolvedValue({ body: "ok" });
    await fetchTextFromUrl("HTTP://example.test", { headers });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      "user-agent": "jobbot3000",
      "x-synthetic": "one",
    });
  });
  it("honors an explicit case-insensitive user agent", async () => {
    fetch.mockResolvedValue({ body: "ok" });
    await fetchTextFromUrl("http://example.test", {
      headers: { "user-agent": "synthetic" },
    });
    expect(fetch.mock.calls[0][1].headers["user-agent"]).toBe("synthetic");
  });
  it("rejects invalid timeouts rather than making them unlimited", async () => {
    await expect(
      fetchTextFromUrl("https://example.test", { timeoutMs: NaN }),
    ).rejects.toMatchObject({ code: "URL_POLICY" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps the existing one MiB default and allows smaller byte limits", async () => {
    fetch.mockResolvedValue({ body: Buffer.alloc(1024 * 1024 + 1) });
    await expect(
      fetchTextFromUrl("https://example.test"),
    ).rejects.toMatchObject({ code: "BODY_LIMIT" });
    fetch.mockResolvedValue({ body: "12345" });
    await expect(
      fetchTextFromUrl("https://example.test", { maxBytes: 4 }),
    ).rejects.toMatchObject({ code: "BODY_LIMIT" });
  });
  it("never uses an arbitrary fetch implementation", async () => {
    const injected = vi.fn();
    await expect(
      fetchTextFromUrl("https://example.test", { fetchImpl: injected }),
    ).rejects.toMatchObject({ code: "URL_POLICY" });
    expect(injected).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
  it("reports HTTP failures without query or response content", async () => {
    fetch.mockResolvedValue({ status: 404, body: "synthetic-private-body" });
    const error = await fetchTextFromUrl(
      "https://example.test/?opaque=synthetic-private-query",
    ).catch((error) => error);
    expect(error.code).toBe("HTTP_STATUS");
    expect(String(error)).not.toContain("synthetic-private");
  });
});
