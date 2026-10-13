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

import { describe, it, expect, vi } from "vitest";

function expectSnapshotShape(snapshot) {
  expect(snapshot).toBeDefined();
  expect(typeof snapshot.id).toBe("string");
  expect(snapshot.id.length).toBeGreaterThan(0);
  expect(typeof snapshot.raw).toBe("string");
  expect(snapshot.source).toBeDefined();
  expect(snapshot.source.value).toMatch(/^https?:\/\//);
  expect(snapshot.source.type).toBeDefined();
  expect(typeof snapshot.parsed).toBe("object");
  expect(snapshot.parsed).not.toBeNull();
  expect(snapshot.requestHeaders).toBeDefined();
}

describe("job source adapters", () => {
  it("exposes a greenhouse adapter with normalization helpers", async () => {
    const { greenhouseAdapter } = await import("../src/greenhouse.js");
    expect(greenhouseAdapter).toBeDefined();
    expect(greenhouseAdapter.provider).toBe("greenhouse");
    expect(typeof greenhouseAdapter.listOpenings).toBe("function");
    expect(typeof greenhouseAdapter.normalizeJob).toBe("function");
    expect(typeof greenhouseAdapter.toApplicationEvent).toBe("function");

    const job = {
      id: 42,
      absolute_url: "https://boards.greenhouse.io/acme/jobs/42",
      content: "<p>Build resilient systems</p>",
      updated_at: "2025-01-01T00:00:00.000Z",
      title: "Engineer",
      location: { name: "Remote" },
    };

    const snapshot = greenhouseAdapter.normalizeJob(job, { slug: "acme" });
    expectSnapshotShape(snapshot);
    expect(snapshot.source.type).toBe("greenhouse");
  });

  it("exposes an ashby adapter with normalization helpers", async () => {
    const { ashbyAdapter } = await import("../src/ashby.js");
    expect(ashbyAdapter).toBeDefined();
    expect(ashbyAdapter.provider).toBe("ashby");
    expect(typeof ashbyAdapter.listOpenings).toBe("function");
    expect(typeof ashbyAdapter.normalizeJob).toBe("function");
    expect(typeof ashbyAdapter.toApplicationEvent).toBe("function");

    const job = {
      id: "abc",
      jobPostingUrl: "https://jobs.ashbyhq.com/acme/job/abc",
      descriptionText: "Guide discovery sprints",
      title: "Product Manager",
      locationName: "Hybrid",
      updatedAt: "2025-01-02T00:00:00.000Z",
    };

    const snapshot = ashbyAdapter.normalizeJob(job, { slug: "acme" });
    expectSnapshotShape(snapshot);
    expect(snapshot.source.type).toBe("ashby");
  });

  it("exposes a lever adapter with normalization helpers", async () => {
    const { leverAdapter } = await import("../src/lever.js");
    expect(leverAdapter).toBeDefined();
    expect(leverAdapter.provider).toBe("lever");
    expect(typeof leverAdapter.listOpenings).toBe("function");
    expect(typeof leverAdapter.normalizeJob).toBe("function");
    expect(typeof leverAdapter.toApplicationEvent).toBe("function");

    const job = {
      id: "lever-1",
      hostedUrl: "https://jobs.lever.co/acme/lever-1",
      descriptionPlain: "Ship fast, learn faster",
      text: "Developer Advocate",
      updatedAt: "2025-01-03T00:00:00.000Z",
      categories: { location: "Remote" },
    };

    const snapshot = leverAdapter.normalizeJob(job, { slug: "acme" });
    expectSnapshotShape(snapshot);
    expect(snapshot.source.type).toBe("lever");
  });

  it("exposes a smartrecruiters adapter with normalization helpers", async () => {
    const { smartRecruitersAdapter } = await import(
      "../src/smartrecruiters.js"
    );
    expect(smartRecruitersAdapter).toBeDefined();
    expect(smartRecruitersAdapter.provider).toBe("smartrecruiters");
    expect(typeof smartRecruitersAdapter.listOpenings).toBe("function");
    expect(typeof smartRecruitersAdapter.normalizeJob).toBe("function");
    expect(typeof smartRecruitersAdapter.toApplicationEvent).toBe("function");

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          jobAd: { text: "<p>Coach cross-functional pods</p>" },
          postingUrl: "https://careers.example.com/jobs/123",
          releasedDate: "2025-01-04T00:00:00.000Z",
        };
      },
    }));

    const posting = {
      id: "123",
      postingUrl: "https://careers.example.com/jobs/123",
      location: { fullLocation: "Remote" },
      name: "Staff Engineer",
      releasedDate: "2025-01-04T00:00:00.000Z",
    };

    fetch.mockImplementation(fetchImpl);
    const snapshot = await smartRecruitersAdapter.normalizeJob(posting, {
      slug: "acme",

      rateLimitKey: "smartrecruiters:acme",
    });
    expectSnapshotShape(snapshot);
    expect(snapshot.source.type).toBe("smartrecruiters");
  });

  it("exposes a workable adapter with normalization helpers", async () => {
    const { workableAdapter } = await import("../src/workable.js");
    expect(workableAdapter).toBeDefined();
    expect(workableAdapter.provider).toBe("workable");
    expect(typeof workableAdapter.listOpenings).toBe("function");
    expect(typeof workableAdapter.normalizeJob).toBe("function");
    expect(typeof workableAdapter.toApplicationEvent).toBe("function");

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          title: "Director of Engineering",
          application_url: "https://apply.workable.com/acme/j/XYZ/",
          description: "<p>Lead platform investments</p>",
        };
      },
    }));

    const job = {
      shortcode: "XYZ",
      description: "<p>Lead platform investments</p>",
      title: "Director of Engineering",
      updated_at: "2025-01-05T00:00:00.000Z",
    };

    fetch.mockImplementation(fetchImpl);
    const snapshot = await workableAdapter.normalizeJob(job, {
      slug: "acme",

      headers: { Authorization: "Bearer secret" },
      rateLimitKey: "workable:acme",
    });
    expectSnapshotShape(snapshot);
    expect(snapshot.source.type).toBe("workable");
  });
});
