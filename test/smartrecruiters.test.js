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

describe("SmartRecruiters ingest", () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "jobbot-smartrecruiters-"),
    );
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
      const { fetchSmartRecruitersPostings } = await import(
        "../src/smartrecruiters.js"
      );
      const budget = createIngestionBudget({ limits: { retries } });
      fetch.mockResolvedValue({ status: 503, body: "synthetic unavailable" });
      await expect(
        fetchSmartRecruitersPostings(`retry-budget-${retries}`, { budget }),
      ).rejects.toMatchObject({ code: "HTTP_STATUS" });
      expect(fetch).toHaveBeenCalledTimes(retries + 1);
      await expect(
        fetchSmartRecruitersPostings(`retry-budget-${retries}`, {
          budget,
          retry: { retries: retries + 1 },
        }),
      ).rejects.toMatchObject({ code: "URL_POLICY" });
      expect(fetch).toHaveBeenCalledTimes(retries + 1);
    },
  );

  it("accepts a reduced request budget without an explicit timeout", async () => {
    const { fetchSmartRecruitersPostings } = await import(
      "../src/smartrecruiters.js"
    );
    const budget = createIngestionBudget({ limits: { requestMs: 100 } });
    fetch.mockResolvedValue({ body: '{"content":[],"totalFound":0}' });
    await fetchSmartRecruitersPostings("budget-example", { budget });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.counts.attempts).toBe(1);
  });

  it("fetches SmartRecruiters jobs and writes snapshots", async () => {
    const postingUrl =
      "https://jobs.smartrecruiters.com/example/744000082406416-partner-development-manager";

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        offset: 0,
        limit: 100,
        totalFound: 1,
        content: [
          {
            id: "744000082406416",
            name: "Partner Development Manager",
            releasedDate: "2025-09-17T09:30:30.267Z",
            ref: "https://api.smartrecruiters.com/v1/companies/example/postings/744000082406416",
            postingUrl,
            location: { fullLocation: "Remote, United Kingdom" },
          },
        ],
      }),
    });

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        name: "Partner Development Manager",
        postingUrl,
        releasedDate: "2025-09-17T09:30:30.267Z",
        location: { fullLocation: "Remote, United Kingdom" },
        jobAd: {
          sections: {
            jobDescription: {
              title: "Job Description",
              text: "<p>Build scalable systems</p>",
            },
            qualifications: {
              title: "Qualifications",
              text: "<ul><li>Experience shipping production systems</li></ul>",
            },
          },
        },
      }),
    });

    const { ingestSmartRecruitersBoard } = await import(
      "../src/smartrecruiters.js"
    );

    const result = await ingestSmartRecruitersBoard({ company: "example" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.smartrecruiters.com/v1/companies/example/postings?limit=100&offset=0",
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "jobbot3000" }),
      }),
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.smartrecruiters.com/v1/companies/example/postings/744000082406416",
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "jobbot3000" }),
      }),
    );

    expect(result).toMatchObject({ company: "example", saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(
      await fs.readFile(path.join(jobsDir, files[0]), "utf8"),
    );
    expect(saved.source).toMatchObject({
      type: "smartrecruiters",
      value:
        "https://jobs.smartrecruiters.com/example/744000082406416-partner-development-manager",
    });
    expect(saved.parsed.title).toBe("Partner Development Manager");
    expect(saved.parsed.location).toBe("Remote, United Kingdom");
    const hasRequirement = saved.parsed.requirements.some((req) =>
      req.includes("Experience shipping production systems"),
    );
    expect(hasRequirement).toBe(true);
    expect(saved.fetched_at).toBe("2025-09-17T09:30:30.267Z");
  });

  it("throws when the postings fetch fails", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });

    const { ingestSmartRecruitersBoard } = await import(
      "../src/smartrecruiters.js"
    );

    await expect(
      ingestSmartRecruitersBoard({ company: "example", retry: { delayMs: 0 } }),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
  });

  it.each([
    "https://other.example.test/v1/companies/synthetic/postings/one",
    "https://api.smartrecruiters.com/v1/companies/other/postings/one",
    "https://api.smartrecruiters.com/v1/companies/synthetic/postings/two",
    "https://api.smartrecruiters.com/v1/companies/synthetic/postings/one?query=opaque",
    "https://api.smartrecruiters.com/v1/companies/synthetic/postings/one#fragment",
  ])(
    "rejects conflicting detail references before transport: %s",
    async (ref) => {
      const { smartRecruitersAdapter } = await import(
        "../src/smartrecruiters.js"
      );
      await expect(
        smartRecruitersAdapter.normalizeJob(
          { id: "one", ref },
          { slug: "synthetic" },
        ),
      ).rejects.toMatchObject({ code: "URL_POLICY" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("accepts an exact reference supplying an absent ID", async () => {
    const { smartRecruitersAdapter } = await import(
      "../src/smartrecruiters.js"
    );
    const ref =
      "https://api.smartrecruiters.com/v1/companies/synthetic/postings/one";
    fetch.mockResolvedValue({
      body: '{"jobAd":{"text":"<p>Synthetic job</p>"}}',
    });
    await smartRecruitersAdapter.normalizeJob({ ref }, { slug: "synthetic" });
    expect(fetch.mock.calls[0][0]).toBe(ref);
  });
  it("reports saved snapshots when a later detail hits a terminal transport failure", async () => {
    const { ingestSmartRecruitersBoard } = await import(
      "../src/smartrecruiters.js"
    );
    fetch.mockImplementation(async (url) =>
      url.includes("?")
        ? {
            json: async () => ({
              content: [{ id: "one" }, { id: "two" }],
              totalFound: 2,
            }),
          }
        : url.endsWith("/one")
          ? { body: '{"jobAd":{"text":"Synthetic job"}}' }
          : { status: 302, rawHeaders: ["location", "http://127.0.0.1/"] },
    );
    const error = await ingestSmartRecruitersBoard({
      company: "synthetic",
    }).catch((error) => error);
    expect(error).toMatchObject({
      code: "REDIRECT_POLICY",
      saved: 1,
      completed: 1,
    });
    expect(error.jobIds).toHaveLength(1);
    const files = await fs.readdir(path.join(dataDir, "jobs"));
    expect(files).toHaveLength(1);
    expect(
      JSON.parse(
        await fs.readFile(path.join(dataDir, "jobs", files[0]), "utf8"),
      ).id,
    ).toBe(error.jobIds[0]);
  });
});
