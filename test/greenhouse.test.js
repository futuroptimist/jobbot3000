import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

import { clearFetchRateLimits } from "../src/fetch.js";

import { createIngestionBudget } from "../src/shared/http/ingestion-budget.js";

const JOBS_DIR = "jobs";

describe("Greenhouse ingest", () => {
  let dataDir;

  beforeEach(async () => {
    process.env.JOBBOT_GREENHOUSE_RATE_LIMIT_MS = "1000";
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "jobbot-greenhouse-"));
    process.env.JOBBOT_DATA_DIR = dataDir;
    fetch.mockReset();
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
    delete process.env.JOBBOT_GREENHOUSE_RATE_LIMIT_MS;
    clearFetchRateLimits();
    vi.useRealTimers();
  });

  it.each([0, 1])(
    "bounds omitted retry counts by a %s-retry budget",
    async (retries) => {
      const { fetchGreenhouseJobs } = await import("../src/greenhouse.js");
      const budget = createIngestionBudget({ limits: { retries } });
      fetch.mockResolvedValue({ status: 503, body: "synthetic unavailable" });
      await expect(
        fetchGreenhouseJobs(`retry-budget-${retries}`, { budget }),
      ).rejects.toMatchObject({ code: "HTTP_STATUS" });
      expect(fetch).toHaveBeenCalledTimes(retries + 1);
      await expect(
        fetchGreenhouseJobs(`retry-budget-${retries}`, {
          budget,
          retry: { retries: retries + 1 },
        }),
      ).rejects.toMatchObject({ code: "URL_POLICY" });
      expect(fetch).toHaveBeenCalledTimes(retries + 1);
    },
  );

  it("accepts a reduced request budget without an explicit timeout", async () => {
    const { fetchGreenhouseJobs } = await import("../src/greenhouse.js");
    const budget = createIngestionBudget({ limits: { requestMs: 100 } });
    fetch.mockResolvedValue({ body: '{"jobs":[]}' });
    await fetchGreenhouseJobs("budget-example", { budget });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.counts.attempts).toBe(1);
  });

  it("fetches Greenhouse jobs and writes snapshots", async () => {
    const html = `
      <h1>Staff Engineer</h1>
      <p>Company: Example Corp</p>
      <p>Location: Remote</p>
      <h3>Requirements</h3>
      <ul>
        <li>Experience shipping production systems</li>
      </ul>
    `;
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        jobs: [
          {
            id: 123,
            title: "Staff Engineer",
            location: { name: "Remote" },
            absolute_url: "https://boards.greenhouse.io/example/jobs/123",
            content: html,
            updated_at: "2025-04-05T06:07:08Z",
          },
        ],
      }),
    });

    const { ingestGreenhouseBoard } = await import("../src/greenhouse.js");

    const result = await ingestGreenhouseBoard({ board: "example" });

    expect(fetch).toHaveBeenCalledWith(
      "https://boards.greenhouse.io/v1/boards/example/jobs?content=true",
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "jobbot3000" }),
      }),
    );

    expect(result).toMatchObject({
      board: "example",
      saved: 1,
      notModified: false,
    });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(
      await fs.readFile(path.join(jobsDir, files[0]), "utf8"),
    );
    expect(saved.source).toMatchObject({
      type: "greenhouse",
      value: "https://boards.greenhouse.io/example/jobs/123",
    });
    expect(saved.source.headers).toEqual({ "User-Agent": "jobbot3000" });
    expect(saved.parsed.title).toBe("Staff Engineer");
    expect(saved.parsed.location).toBe("Remote");
    const hasRequirement = saved.parsed.requirements.some((req) =>
      req.includes("Experience shipping production systems"),
    );
    expect(hasRequirement).toBe(true);
    expect(saved.fetched_at).toBe("2025-04-05T06:07:08.000Z");
  });

  it("throws when the board fetch fails", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });

    const { ingestGreenhouseBoard } = await import("../src/greenhouse.js");

    await expect(
      ingestGreenhouseBoard({ board: "missing" }),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
  });

  it("retries transient failures before succeeding", async () => {
    const transientError = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({}),
    };
    const html = `
      <h1>Senior Engineer</h1>
      <p>Location: Remote</p>
      <h3>Requirements</h3>
      <ul><li>Reliability experience</li></ul>
    `;
    const recovery = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        jobs: [
          {
            id: 42,
            title: "Senior Engineer",
            location: { name: "Remote" },
            absolute_url: "https://boards.greenhouse.io/example/jobs/42",
            content: html,
            updated_at: "2025-06-07T08:09:10Z",
          },
        ],
      }),
    };
    fetch.mockResolvedValueOnce(transientError).mockResolvedValueOnce(recovery);

    const { ingestGreenhouseBoard } = await import("../src/greenhouse.js");

    const result = await ingestGreenhouseBoard({
      board: "example",
      retry: { retries: 1, delayMs: 0 },
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.saved).toBe(1);
  });

  it("persists caching headers for subsequent Greenhouse requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const headers = {
      get: (name) => {
        const lower = name.toLowerCase();
        if (lower === "etag") return '"etag-123"';
        if (lower === "last-modified") return "Wed, 01 Jan 2025 00:00:00 GMT";
        return null;
      },
    };
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers,
      json: async () => ({ jobs: [] }),
    });

    const { ingestGreenhouseBoard } = await import("../src/greenhouse.js");

    const cachedResult = await ingestGreenhouseBoard({ board: "example" });
    expect(cachedResult.notModified).toBe(false);

    const cachePath = path.join(dataDir, "cache", "greenhouse", "example.json");
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    expect(cached).toEqual({
      etag: '"etag-123"',
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
      fetchedAt: "2025-01-01T00:00:00.000Z",
    });
  });

  it("sends conditional headers and skips work when the board is unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-02-02T00:00:00Z"));
    const cacheDir = path.join(dataDir, "cache", "greenhouse");
    await fs.mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, "example.json");
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        etag: '"etag-123"',
        lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
      }),
    );

    fetch.mockImplementation(async (url, init) => {
      expect(init.headers).toMatchObject({
        "user-agent": "jobbot3000",
        "if-none-match": '"etag-123"',
        "if-modified-since": "Wed, 01 Jan 2025 00:00:00 GMT",
      });
      return {
        ok: false,
        status: 304,
        statusText: "Not Modified",
        headers: { get: () => null },
        json: async () => {
          throw new Error("body should not be read for 304 responses");
        },
      };
    });

    const { ingestGreenhouseBoard } = await import("../src/greenhouse.js");

    const result = await ingestGreenhouseBoard({ board: "example" });

    expect(result).toMatchObject({
      board: "example",
      saved: 0,
      jobIds: [],
      notModified: true,
    });
    const jobsDir = path.join(dataDir, JOBS_DIR);
    await expect(fs.readdir(jobsDir)).rejects.toMatchObject({ code: "ENOENT" });

    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    expect(cached).toEqual({
      etag: '"etag-123"',
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
      fetchedAt: "2025-02-02T00:00:00.000Z",
    });
  });

  it("waits between successive fetches when a rate limit is configured", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-01T00:00:00Z"));
    process.env.JOBBOT_GREENHOUSE_RATE_LIMIT_MS = "1000";

    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => ({ jobs: [] }),
    });

    const { ingestGreenhouseBoard } = await import("../src/greenhouse.js");

    await ingestGreenhouseBoard({ board: "example" });
    expect(fetch).toHaveBeenCalledTimes(1);

    const second = ingestGreenhouseBoard({ board: "example" });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await second;

    delete process.env.JOBBOT_GREENHOUSE_RATE_LIMIT_MS;
  });

  it("does not replace validators after invalid JSON or an oversized body", async () => {
    const cacheDir = path.join(dataDir, "cache", "greenhouse");
    await fs.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, "synthetic.json");
    const initial = JSON.stringify({ etag: "synthetic-old" });
    await fs.writeFile(file, initial);
    const { fetchGreenhouseJobs } = await import("../src/greenhouse.js");
    for (const body of ["invalid-json", Buffer.alloc(8 * 1024 * 1024 + 1)]) {
      clearFetchRateLimits();
      fetch.mockResolvedValue({ body, rawHeaders: ["etag", "synthetic-new"] });
      await expect(fetchGreenhouseJobs("synthetic")).rejects.toMatchObject({
        code: typeof body === "string" ? "PAYLOAD_INVALID" : "BODY_LIMIT",
      });
      expect(await fs.readFile(file, "utf8")).toBe(initial);
    }
  });
  it("clears redirected validators for future requests", async () => {
    const cacheDir = path.join(dataDir, "cache", "greenhouse");
    await fs.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, "synthetic.json");
    await fs.writeFile(file, JSON.stringify({ etag: "synthetic-old" }));
    fetch.mockImplementation(async (url) =>
      url.includes("boards.greenhouse.io")
        ? {
            status: 302,
            rawHeaders: ["location", "https://cdn.example.test/jobs"],
          }
        : { body: '{"jobs":[]}', rawHeaders: ["etag", "synthetic-cdn"] },
    );
    const { fetchGreenhouseJobs } = await import("../src/greenhouse.js");
    await fetchGreenhouseJobs("synthetic");
    expect(fetch.mock.calls[0][1].headers["if-none-match"]).toBe(
      "synthetic-old",
    );
    expect(fetch.mock.calls[1][1].headers["if-none-match"]).toBeUndefined();
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
      fetchedAt: expect.any(String),
    });
    clearFetchRateLimits();
    await fetchGreenhouseJobs("synthetic");
    expect(fetch.mock.calls[2][1].headers["if-none-match"]).toBeUndefined();
  });
  it("rejects redirected 304 without recording a successful cache refresh", async () => {
    const cacheDir = path.join(dataDir, "cache", "greenhouse");
    await fs.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, "synthetic.json");
    const original = JSON.stringify({ etag: "synthetic-original" });
    await fs.writeFile(file, original);
    fetch
      .mockResolvedValueOnce({
        status: 302,
        rawHeaders: ["location", "https://cdn.example.test/jobs"],
      })
      .mockResolvedValueOnce({ status: 304 });
    const { fetchGreenhouseJobs } = await import("../src/greenhouse.js");
    await expect(fetchGreenhouseJobs("synthetic")).rejects.toMatchObject({
      code: "PAYLOAD_INVALID",
    });
    expect(await fs.readFile(file, "utf8")).toBe(original);
  });
});
