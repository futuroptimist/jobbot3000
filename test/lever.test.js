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

import { createIngestionBudget } from "../src/shared/http/ingestion-budget.js";

const JOBS_DIR = "jobs";

describe("Lever ingest", () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "jobbot-lever-"));
    process.env.JOBBOT_DATA_DIR = dataDir;
    fetch.mockReset();
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
  });

  it.each([0, 1])(
    "bounds omitted retry counts by a %s-retry budget",
    async (retries) => {
      const { fetchLeverJobs } = await import("../src/lever.js");
      const budget = createIngestionBudget({ limits: { retries } });
      fetch.mockResolvedValue({ status: 503, body: "synthetic unavailable" });
      await expect(
        fetchLeverJobs(`retry-budget-${retries}`, { budget }),
      ).rejects.toMatchObject({ code: "HTTP_STATUS" });
      expect(fetch).toHaveBeenCalledTimes(retries + 1);
      await expect(
        fetchLeverJobs(`retry-budget-${retries}`, {
          budget,
          retry: { retries: retries + 1 },
        }),
      ).rejects.toMatchObject({ code: "URL_POLICY" });
      expect(fetch).toHaveBeenCalledTimes(retries + 1);
    },
  );

  it("accepts a reduced request budget without an explicit timeout", async () => {
    const { fetchLeverJobs } = await import("../src/lever.js");
    const budget = createIngestionBudget({ limits: { requestMs: 100 } });
    fetch.mockResolvedValue({ body: "[]" });
    await fetchLeverJobs("budget-example", { budget });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.counts.attempts).toBe(1);
  });

  it("fetches Lever jobs and writes snapshots", async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [
        {
          id: "abc123",
          text: "Senior Platform Engineer",
          hostedUrl: "https://jobs.lever.co/example/abc123",
          descriptionPlain: `
Title: Senior Platform Engineer
Company: Example Corp
Location: Remote
Requirements
- Ship reliable systems
`,
          categories: { location: "Remote" },
          updatedAt: "2025-01-02T03:04:05Z",
        },
      ],
    });

    const { ingestLeverBoard } = await import("../src/lever.js");

    const result = await ingestLeverBoard({ org: "example" });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.lever.co/v0/postings/example?mode=json",
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "jobbot3000" }),
      }),
    );

    expect(result).toMatchObject({ org: "example", saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(
      await fs.readFile(path.join(jobsDir, files[0]), "utf8"),
    );
    expect(saved.source).toMatchObject({
      type: "lever",
      value: "https://jobs.lever.co/example/abc123",
      headers: { "User-Agent": "jobbot3000" },
    });
    expect(saved.parsed.title).toBe("Senior Platform Engineer");
    expect(saved.parsed.location).toBe("Remote");
    expect(saved.fetched_at).toBe("2025-01-02T03:04:05.000Z");
  });

  it("throws when the org fetch fails", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });

    const { ingestLeverBoard } = await import("../src/lever.js");

    await expect(ingestLeverBoard({ org: "missing" })).rejects.toMatchObject({
      code: "HTTP_STATUS",
    });
  });
});
