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

describe("Workable ingest", () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "jobbot-workable-"));
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

  it("accepts a reduced request budget without an explicit timeout", async () => {
    const { fetchWorkableJobs } = await import("../src/workable.js");
    const budget = createIngestionBudget({ limits: { requestMs: 100 } });
    fetch.mockResolvedValue({ body: '{"jobs":[]}' });
    await fetchWorkableJobs("budget-example", { budget });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.counts.attempts).toBe(1);
  });

  it("fetches Workable jobs and writes snapshots", async () => {
    const listPayload = {
      jobs: [
        {
          shortcode: "abc123",
          title: "Senior Platform Engineer",
          location: { location_str: "Remote" },
          url: "https://apply.workable.com/example/j/abc123/",
          updated_at: "2025-01-02T03:04:05Z",
        },
      ],
    };

    const detailPayload = {
      shortcode: "abc123",
      title: "Senior Platform Engineer",
      location: { location_str: "Remote" },
      description: `
        <h1>Senior Platform Engineer</h1>
        <p>Build durable infrastructure.</p>
        <h3>Requirements</h3>
        <ul>
          <li>Go</li>
        </ul>
      `,
      updated_at: "2025-01-02T03:04:05Z",
    };

    fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => listPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => detailPayload,
      });

    const { ingestWorkableBoard } = await import("../src/workable.js");

    const result = await ingestWorkableBoard({ account: "example" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://www.workable.com/api/accounts/example/jobs",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": "jobbot3000",
          accept: "application/json",
        }),
      }),
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://www.workable.com/api/accounts/example/jobs/abc123",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": "jobbot3000",
          accept: "application/json",
        }),
      }),
    );

    expect(result).toMatchObject({ account: "example", saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(
      await fs.readFile(path.join(jobsDir, files[0]), "utf8"),
    );
    expect(saved.source).toMatchObject({
      type: "workable",
      value: "https://apply.workable.com/example/j/abc123/",
    });
    expect(saved.source.headers).toEqual({
      Accept: "application/json",
      "User-Agent": "jobbot3000",
    });
    expect(saved.parsed.title).toBe("Senior Platform Engineer");
    expect(saved.parsed.location).toBe("Remote");
    const hasRequirement = saved.parsed.requirements.some((req) =>
      req.includes("Go"),
    );
    expect(hasRequirement).toBe(true);
    expect(saved.fetched_at).toBe("2025-01-02T03:04:05.000Z");
  });

  it("sends authorization header when JOBBOT_WORKABLE_TOKEN is set", async () => {
    process.env.JOBBOT_WORKABLE_TOKEN = "secret-token";

    const listPayload = {
      jobs: [
        {
          shortcode: "def456",
          title: "Staff SRE",
          location: { location_str: "Hybrid" },
          url: "https://apply.workable.com/example/j/def456/",
        },
      ],
    };

    const detailPayload = {
      shortcode: "def456",
      title: "Staff SRE",
      location: { location_str: "Hybrid" },
      description: "<p>Keep systems reliable.</p>",
      updated_at: "2025-02-03T04:05:06Z",
    };

    fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => listPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => detailPayload,
      });

    try {
      const { ingestWorkableBoard } = await import("../src/workable.js");

      const result = await ingestWorkableBoard({ account: "example" });
      expect(result).toMatchObject({ account: "example", saved: 1 });

      expect(fetch).toHaveBeenNthCalledWith(
        1,
        "https://www.workable.com/api/accounts/example/jobs",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer secret-token",
            "user-agent": "jobbot3000",
            accept: "application/json",
          }),
        }),
      );

      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "https://www.workable.com/api/accounts/example/jobs/def456",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer secret-token",
            "user-agent": "jobbot3000",
            accept: "application/json",
          }),
        }),
      );

      const jobsDir = path.join(dataDir, JOBS_DIR);
      const files = await fs.readdir(jobsDir);
      expect(files).toHaveLength(1);
      const saved = JSON.parse(
        await fs.readFile(path.join(jobsDir, files[0]), "utf8"),
      );
      expect(saved.source.headers).toEqual({
        Accept: "application/json",
        "User-Agent": "jobbot3000",
      });
      expect(saved.fetched_at).toBe("2025-02-03T04:05:06.000Z");
    } finally {
      delete process.env.JOBBOT_WORKABLE_TOKEN;
    }
  });

  it("throws when the account fetch fails", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });

    const { ingestWorkableBoard } = await import("../src/workable.js");

    await expect(
      ingestWorkableBoard({ account: "missing" }),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
  });

  it("throws when a job detail fetch fails", async () => {
    const listPayload = {
      jobs: [
        {
          shortcode: "abc123",
          title: "Senior Platform Engineer",
          url: "https://apply.workable.com/example/j/abc123/",
        },
      ],
    };

    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => listPayload,
    });

    const { ingestWorkableBoard } = await import("../src/workable.js");

    await expect(
      ingestWorkableBoard({ account: "example", retry: { delayMs: 0 } }),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
  });

  it("blocks credential-bearing cross-origin redirects before a second request", async () => {
    const { fetchWorkableJobs } = await import("../src/workable.js");
    fetch.mockResolvedValue({
      status: 302,
      rawHeaders: ["location", "https://cdn.example.test/jobs"],
    });
    await expect(
      fetchWorkableJobs("synthetic", { token: "synthetic-test-token" }),
    ).rejects.toMatchObject({ code: "REDIRECT_POLICY" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
