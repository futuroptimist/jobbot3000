import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "node:fs/promises";
import path from "node:path";

let activeServers = [];

async function startServer(options) {
  const { startWebServer } = await import("../src/web/server.js");
  const server = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    csrfToken: "test-csrf-token",
    rateLimit: { windowMs: 1000, max: 50 },
    ...options,
  });
  activeServers.push(server);
  return server;
}

async function fetchStatusHtml(server) {
  const response = await fetch(`${server.url}/`);
  expect(response.status).toBe(200);
  return response.text();
}

async function loadStatusHubScript(server, dom) {
  const asset = await fetch(`${server.url}/assets/status-hub.js`);
  expect(asset.status).toBe(200);
  const code = await asset.text();
  dom.window.eval(code);
}

async function renderStatusDom(server, options = {}) {
  const { autoBoot = true, ...jsdomOptions } = options;
  const html = await fetchStatusHtml(server);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: `${server.url}/`,
    ...jsdomOptions,
  });
  if (!dom.window.fetch) {
    dom.window.fetch = (input, init) => fetch(input, init);
  }

  const boot = async () => {
    if (dom.__jobbotBooted) return;
    await loadStatusHubScript(server, dom);
    dom.__jobbotBooted = true;
  };

  if (autoBoot) {
    await boot();
  }

  return { dom, html, boot };
}

function waitForDomEvent(dom, name, timeout = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${name} timed out`)),
      timeout,
    );
    dom.window.document.addEventListener(
      name,
      (event) => {
        clearTimeout(timer);
        resolve(event);
      },
      { once: true },
    );
  });
}

function buildCommandHeaders(server, overrides = {}) {
  const headerName = server?.csrfHeaderName ?? "x-jobbot-csrf";
  const token = server?.csrfToken ?? "test-csrf-token";
  return {
    "content-type": "application/json",
    [headerName]: token,
    ...overrides,
  };
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe("web server health endpoint", () => {
  it("reports ok status with metadata when all checks pass", async () => {
    const server = await startServer({
      info: { service: "jobbot-web", version: "0.1.0-test" },
      healthChecks: [
        {
          name: "cli",
          async run() {
            return { details: { command: "jobbot --help" } };
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "ok",
      service: "jobbot-web",
      version: "0.1.0-test",
    });
    expect(typeof payload.uptime).toBe("number");
    expect(payload.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(payload.timestamp).toString()).not.toBe("Invalid Date");
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]).toMatchObject({
      name: "cli",
      status: "ok",
      details: { command: "jobbot --help" },
    });
    expect(typeof payload.checks[0].duration_ms).toBe("number");
  });

  it("bubbles check failures and returns a 503 status", async () => {
    const server = await startServer({
      healthChecks: [
        {
          name: "resume-pipeline",
          async run() {
            throw new Error("resume pipeline unavailable");
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.status).toBe("error");
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]).toMatchObject({
      name: "resume-pipeline",
      status: "error",
      error: "resume pipeline unavailable",
    });
  });

  it("surface warn statuses without failing the overall health", async () => {
    const server = await startServer({
      healthChecks: [
        {
          name: "queue-depth",
          async run() {
            return { status: "warn", details: { depth: 42 } };
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("warn");
    expect(payload.checks[0]).toMatchObject({
      name: "queue-depth",
      status: "warn",
      details: { depth: 42 },
    });
  });

  it("rejects invalid health check definitions", async () => {
    const { startWebServer } = await import("../src/web/server.js");
    expect(() =>
      startWebServer({ healthChecks: [{ name: "bad-check" }] }),
    ).toThrow(/health check/);
  });
});

describe("web server status page", () => {
  it("exposes a theme toggle that persists the preferred mode", async () => {
    const server = await startServer();

    const html = await fetchStatusHtml(server);
    expect(html).toContain("data-theme-toggle");

    const asset = await fetch(`${server.url}/assets/status-hub.js`);
    expect(asset.status).toBe(200);
    const code = await asset.text();
    expect(code).toMatch(/jobbot:web:theme/);
    expect(code).toMatch(/prefers-color-scheme/);
  });

  it("links to the web operations playbook for on-call guidance", async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html);
    const operationsLink = dom.window.document.querySelector(
      'nav[aria-label="Documentation links"] a[href$="docs/web-operational-playbook.md"]',
    );

    expect(operationsLink?.textContent).toMatch(/Operations playbook/i);
  });

  it("supports keyboard navigation between status sections", async () => {
    const server = await startServer();
    const { dom } = await renderStatusDom(server);
    const { document } = dom.window;

    const router = document.querySelector("[data-router]");
    expect(router?.getAttribute("data-active-route")).toBe("overview");

    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );

    expect(router?.getAttribute("data-active-route")).toBe("applications");
    const activeLink = document.activeElement;
    expect(activeLink?.getAttribute("data-route-link")).toBe("applications");

    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
      }),
    );

    expect(router?.getAttribute("data-active-route")).toBe("overview");

    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );

    expect(router?.getAttribute("data-active-route")).toBe("audits");

    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );

    expect(router?.getAttribute("data-active-route")).toBe("overview");
  });

  it("ignores global shortcuts when focus is inside a form control", async () => {
    const server = await startServer();
    const { dom } = await renderStatusDom(server);
    const { document } = dom.window;

    const router = document.querySelector("[data-router]");
    expect(router?.getAttribute("data-active-route")).toBe("overview");

    const locationInput = document.querySelector(
      '[data-shortlist-filter="location"]',
    );
    expect(locationInput).toBeTruthy();
    locationInput?.focus();

    locationInput?.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );

    expect(router?.getAttribute("data-active-route")).toBe("overview");
  });

  it("serves the status hub script via an external asset endpoint", async () => {
    const server = await startServer();

    const homepage = await fetch(`${server.url}/`);
    expect(homepage.status).toBe(200);
    const html = await homepage.text();
    const dom = new JSDOM(html);
    const scriptEl = dom.window.document.querySelector(
      'script[src="/assets/status-hub.js"]',
    );

    expect(scriptEl).not.toBeNull();
    expect(scriptEl?.getAttribute("defer")).not.toBeNull();

    const asset = await fetch(`${server.url}/assets/status-hub.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(asset.headers.get("cache-control")).toBe("no-store");
    const code = await asset.text();
    expect(code.trim().startsWith("(() => {")).toBe(true);
    expect(code).toContain("jobbot:status-panels-ready");
    expect(code.trim().endsWith("})();")).toBe(true);
  });

  it("supports hash-based navigation between status sections", async () => {
    const server = await startServer();

    const { dom, boot } = await renderStatusDom(server, { autoBoot: false });

    const routerReady = waitForDomEvent(dom, "jobbot:router-ready");
    await boot();
    await routerReady;

    const { document } = dom.window;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    const overview = document.querySelector('[data-route="overview"]');
    const commands = document.querySelector('[data-route="commands"]');
    const overviewLink = document.querySelector('[data-route-link="overview"]');
    const commandsLink = document.querySelector('[data-route-link="commands"]');

    expect(overview).not.toBeNull();
    expect(commands).not.toBeNull();
    expect(overview?.hasAttribute("hidden")).toBe(false);
    expect(commands?.hasAttribute("hidden")).toBe(true);
    expect(overviewLink?.getAttribute("aria-current")).toBe("page");
    expect(commandsLink?.hasAttribute("aria-current")).toBe(false);

    dom.window.location.hash = "#commands";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    expect(commands?.hasAttribute("hidden")).toBe(false);
    expect(overview?.hasAttribute("hidden")).toBe(true);
    expect(commandsLink?.getAttribute("aria-current")).toBe("page");
    expect(overviewLink?.hasAttribute("aria-current")).toBe(false);
  });

  it("exposes status panels with loading and error states", async () => {
    const server = await startServer();

    const { dom, boot } = await renderStatusDom(server, { autoBoot: false });

    const panelsReady = waitForDomEvent(dom, "jobbot:status-panels-ready");
    await boot();
    await panelsReady;

    const { document } = dom.window;
    const api = dom.window.JobbotStatusHub;

    expect(typeof api).toBe("object");
    expect(typeof api?.setPanelState).toBe("function");
    expect(typeof api?.getPanelState).toBe("function");

    const commandsPanel = document.querySelector(
      '[data-status-panel="commands"]',
    );
    expect(commandsPanel).not.toBeNull();
    expect(commandsPanel?.getAttribute("data-state")).toBe("ready");

    const readySlot = commandsPanel?.querySelector('[data-state-slot="ready"]');
    const loadingSlot = commandsPanel?.querySelector(
      '[data-state-slot="loading"]',
    );
    const errorSlot = commandsPanel?.querySelector('[data-state-slot="error"]');

    expect(readySlot?.hasAttribute("hidden")).toBe(false);
    expect(loadingSlot?.hasAttribute("hidden")).toBe(true);
    expect(errorSlot?.hasAttribute("hidden")).toBe(true);

    expect(api?.getPanelState("commands")).toBe("ready");

    expect(api?.setPanelState("commands", "loading")).toBe(true);
    expect(commandsPanel?.getAttribute("data-state")).toBe("loading");
    expect(loadingSlot?.hasAttribute("hidden")).toBe(false);
    expect(readySlot?.hasAttribute("hidden")).toBe(true);

    expect(
      api?.setPanelState("commands", "error", { message: "Failed to load" }),
    ).toBe(true);
    expect(commandsPanel?.getAttribute("data-state")).toBe("error");
    expect(errorSlot?.hasAttribute("hidden")).toBe(false);
    const errorMessage = errorSlot?.querySelector("[data-error-message]");
    expect(errorMessage?.textContent).toContain("Failed to load");

    expect(api?.setPanelState("commands", "unknown")).toBe(true);
    expect(commandsPanel?.getAttribute("data-state")).toBe("ready");
    expect(readySlot?.hasAttribute("hidden")).toBe(false);

    expect(api?.setPanelState("missing", "loading")).toBe(false);
  });

  it("renders the applications view with shortlist filters and pagination markup", async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('data-route="applications"');
    expect(html).toContain("data-shortlist-filters");
    expect(html).toContain("data-shortlist-table");
    expect(html).toContain("data-shortlist-pagination");
  });

  it("loads shortlist entries and paginates the applications view with filters", async () => {
    const jobs = [
      {
        id: "job-1",
        metadata: {
          location: "Remote",
          level: "Senior",
          compensation: "$185k",
          synced_at: "2025-03-06T08:00:00.000Z",
        },
        tags: ["remote", "dream"],
        discard_count: 0,
      },
      {
        id: "job-2",
        metadata: {
          location: "Remote",
          level: "Senior",
          compensation: "$185k",
          synced_at: "2025-03-04T09:00:00.000Z",
        },
        tags: ["remote"],
        discard_count: 1,
        last_discard: {
          reason: "Paused hiring",
          discarded_at: "2025-03-02T10:00:00.000Z",
          tags: ["paused"],
        },
      },
    ];

    const commandAdapter = {
      "shortlist-list": vi.fn(async (payload) => {
        const offset = Number(payload.offset ?? 0);
        const limit = Number(payload.limit ?? 20);
        const slice = jobs.slice(offset, offset + limit);
        return {
          command: "shortlist-list",
          format: "json",
          stdout: "",
          stderr: "",
          data: {
            total: jobs.length,
            offset,
            limit,
            filters: { ...payload },
            items: slice,
            hasMore: offset + limit < jobs.length,
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    commandAdapter.trackReminders = commandAdapter["track-reminders"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    vi.spyOn(
      dom.window.HTMLAnchorElement.prototype,
      "click",
    ).mockImplementation(() => {});

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    const readyEvent = await readyPromise;
    expect(readyEvent.detail).toMatchObject({ available: true });

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(1);

    const document = dom.window.document;
    const tableBody = document.querySelector("[data-shortlist-body]");
    expect(tableBody?.children.length).toBe(2);
    expect(tableBody?.children[0].querySelector("td")?.textContent).toBe(
      "job-1",
    );

    const locationInput = document.querySelector(
      '[data-shortlist-filter="location"]',
    );
    const tagsInput = document.querySelector('[data-shortlist-filter="tags"]');
    const limitInput = document.querySelector(
      '[data-shortlist-filter="limit"]',
    );
    if (locationInput) locationInput.value = "Remote";
    if (tagsInput) tagsInput.value = "remote";
    if (limitInput) limitInput.value = "1";

    const form = document.querySelector("[data-shortlist-filters]");
    form?.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(2);
    const latestCall =
      commandAdapter["shortlist-list"].mock.calls.at(-1)?.[0] ?? {};
    expect(latestCall).toMatchObject({
      location: "Remote",
      tags: ["remote"],
      limit: 1,
      offset: 0,
    });

    expect(tableBody?.children.length).toBe(1);
    expect(tableBody?.children[0].querySelector("td")?.textContent).toBe(
      "job-1",
    );
    const range = document.querySelector("[data-shortlist-range]");
    expect(range?.textContent).toContain("Showing 1-1 of 2");

    const nextButton = document.querySelector("[data-shortlist-next]");
    nextButton?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(3);
    const nextCall =
      commandAdapter["shortlist-list"].mock.calls.at(-1)?.[0] ?? {};
    expect(nextCall).toMatchObject({ offset: 1, limit: 1 });
    expect(tableBody?.children.length).toBe(1);
    expect(tableBody?.children[0].querySelector("td")?.textContent).toBe(
      "job-2",
    );
    expect(range?.textContent).toContain("Showing 2-2 of 2");
  });

  it("exports shortlist views as JSON and CSV", async () => {
    const shortlistItems = [
      {
        id: "job-1",
        metadata: {
          location: "Remote",
          level: "=IMPORT(\"https://evil\")",
          compensation: "$185k",
          synced_at: "2025-03-01T00:00:00.000Z",
        },
        tags: ["remote", "dream"],
        discard_count: 1,
        last_discard: {
          reason: "duplicate",
          discarded_at: "2025-02-28T17:00:00.000Z",
          tags: ["stale"],
        },
      },
      {
        id: "job-2",
        metadata: {
          location: "San Francisco",
          level: "Staff",
          compensation: "$210k",
          synced_at: "2025-02-25T12:00:00.000Z",
        },
        tags: ["onsite", "   @malicious"],
        discard_count: 0,
      },
    ];

    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        returnValue: 0,
        data: {
          total: shortlistItems.length,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: shortlistItems,
        },
      })),
    };
    commandAdapter.shortlistList = commandAdapter["shortlist-list"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");

    const { URL } = dom.window;
    URL.createObjectURL = vi.fn(() => "blob:shortlist");
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi
      .spyOn(dom.window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const jsonButton = dom.window.document.querySelector(
      "[data-shortlist-export-json]",
    );
    const csvButton = dom.window.document.querySelector(
      "[data-shortlist-export-csv]",
    );
    const message = dom.window.document.querySelector(
      "[data-shortlist-export-message]",
    );

    expect(jsonButton).not.toBeNull();
    expect(csvButton).not.toBeNull();

    const click = () =>
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });

    jsonButton?.dispatchEvent(click());
    const jsonEvent = await waitForEvent("jobbot:shortlist-exported");

    expect(jsonEvent.detail).toMatchObject({
      format: "json",
      success: true,
      count: shortlistItems.length,
      offset: 0,
      limit: 20,
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const jsonBlob = URL.createObjectURL.mock.calls[0]?.[0];
    expect(jsonBlob).toBeInstanceOf(dom.window.Blob);
    expect(jsonBlob.type).toBe("application/json");
    const jsonText = await jsonBlob.text();
    const parsed = JSON.parse(jsonText);
    expect(parsed).toMatchObject({
      total: shortlistItems.length,
      offset: 0,
      limit: 20,
      items: shortlistItems,
    });
    expect(message?.textContent).toContain("shortlist-entries.json");

    csvButton?.dispatchEvent(click());
    const csvEvent = await waitForEvent("jobbot:shortlist-exported");

    expect(csvEvent.detail).toMatchObject({
      format: "csv",
      success: true,
      count: shortlistItems.length,
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(anchorClick).toHaveBeenCalledTimes(2);
    const csvBlob = URL.createObjectURL.mock.calls[1]?.[0];
    expect(csvBlob).toBeInstanceOf(dom.window.Blob);
    expect(csvBlob.type).toBe("text/csv");
    const csvText = await csvBlob.text();
    expect(csvText).toContain("job_id,location,level,compensation,tags");
    expect(csvText).toContain("job-1");
    expect(csvText).toContain("duplicate");
    expect(csvText).toContain("'=IMPORT(");
    expect(csvText).toContain("'@malicious");
    expect(message?.textContent).toContain("shortlist-entries.csv");
  });

  it("downloads reminder calendars from the applications view", async () => {
    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        data: {
          total: 0,
          offset: 0,
          limit: 10,
          filters: {},
          items: [],
          hasMore: false,
        },
      })),
      "track-reminders": vi.fn(async (payload) => {
        expect(payload).toMatchObject({ format: "ics", upcomingOnly: true });
        return {
          command: "track-reminders",
          format: "ics",
          stdout: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
          stderr: "",
          returnValue: 0,
          data: {
            calendar: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
            filename: "jobbot-reminders.ics",
            reminders: [],
            sections: [{ heading: "Upcoming", reminders: [] }],
            upcomingOnly: true,
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    commandAdapter.trackReminders = commandAdapter["track-reminders"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");

    const { URL } = dom.window;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:reminders");
    URL.revokeObjectURL = vi.fn();
    const BlobConstructor = dom.window.Blob;
    const anchorClick = vi
      .spyOn(dom.window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const button = dom.window.document.querySelector("[data-reminders-export]");
    const message = dom.window.document.querySelector(
      "[data-reminders-message]",
    );

    button?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    const exportEvent = await waitForEvent("jobbot:reminders-exported");

    expect(commandAdapter["track-reminders"]).toHaveBeenCalledTimes(1);
    expect(exportEvent.detail).toMatchObject({ success: true, format: "ics" });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(BlobConstructor);
    expect(blob.type).toBe("text/calendar");
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(message?.textContent).toContain("jobbot-reminders.ics");

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    anchorClick.mockRestore();
  });

  it("logs reminder export failures and surfaces a bug report download", async () => {
    const logPath = path.resolve("logs", "calendar.log");
    await fs.rm(logPath, { force: true });

    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        data: {
          total: 0,
          offset: 0,
          limit: 10,
          filters: {},
          items: [],
          hasMore: false,
        },
      })),
      "track-reminders": vi.fn(async () => {
        const error = new Error("Calendar serialization failed");
        error.stdout = "writing calendar";
        error.stderr = "invalid reminder";
        error.correlationId = "corr-test";
        throw error;
      }),
    };
    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    
    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");

    const { URL } = dom.window;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:bug-report");
    URL.revokeObjectURL = vi.fn();
    const BlobConstructor = dom.window.Blob;
    const blobCalls = [];
    const blobSpy = vi
      .spyOn(dom.window, "Blob")
      .mockImplementation((parts = [], options) => {
        blobCalls.push({ parts, options });
        return new BlobConstructor(parts, options);
      });
    const anchorClick = vi
      .spyOn(dom.window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const button = dom.window.document.querySelector("[data-reminders-export]");
    const message = dom.window.document.querySelector(
      "[data-reminders-message]",
    );
    const reportButton = dom.window.document.querySelector(
      "[data-reminders-report]",
    );

    button?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    const exportEvent = await waitForEvent("jobbot:reminders-exported");

    expect(commandAdapter["track-reminders"]).toHaveBeenCalledTimes(1);
    expect(exportEvent.detail).toMatchObject({ success: false, format: "ics" });
    expect(message?.textContent).toContain("Calendar serialization failed");
    expect(reportButton?.hasAttribute("hidden")).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    reportButton?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(BlobConstructor);
    const reportRaw = blobCalls[0]?.parts?.[0];
    expect(typeof reportRaw).toBe("string");
    const reportContents = JSON.parse(reportRaw);
    expect(reportContents).toMatchObject({
      logPath: "logs/calendar.log",
      entry: expect.objectContaining({
        error: "Calendar serialization failed",
        command: "track-reminders",
      }),
    });

    const logFile = await fs.readFile(logPath, "utf8");
    const lines = logFile.trim().split(/\r?\n/);
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry).toMatchObject({
      error: "Calendar serialization failed",
      command: "track-reminders",
    });

    await fs.rm(logPath, { force: true });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    blobSpy.mockRestore();
    anchorClick.mockRestore();
  });

  it("loads provider listings and supports ingesting and archiving roles", async () => {
    const providers = [
      {
        id: "all",
        label: "All providers",
        requiresIdentifier: false,
      },
      {
        id: "greenhouse",
        label: "Greenhouse",
        identifierLabel: "Greenhouse board token",
        placeholder: "acme-co",
        requiresIdentifier: true,
      },
    ];
    const listings = [
      {
        jobId: "job-1",
        title: "Staff Software Engineer",
        company: "Acme Co",
        location: "Remote",
        team: "Platform",
        remote: true,
        url: "https://example.com/job-1",
        ingested: false,
        provider: "greenhouse",
        identifier: "acme-co",
      },
      {
        jobId: "job-2",
        title: "Product Engineer",
        company: "Acme Co",
        location: "New York, NY",
        team: "Product",
        remote: false,
        url: "https://example.com/job-2",
        ingested: false,
        provider: "lever",
        identifier: "acme",
      },
    ];

    const commandAdapter = {
      "listings-providers": vi.fn(async () => ({
        command: "listings-providers",
        format: "json",
        stdout: "",
        stderr: "",
        data: { providers, tokenStatus: [] },
      })),
      "listings-fetch": vi.fn(async (payload) => ({
        command: "listings-fetch",
        format: "json",
        stdout: "",
        stderr: "",
        data: {
          provider: payload.provider,
          identifier: payload.identifier,
          listings,
        },
      })),
      "listings-ingest": vi.fn(async (payload) => ({
        command: "listings-ingest",
        format: "json",
        stdout: "",
        stderr: "",
        data: {
          listing: {
            ...listings[0],
            jobId: payload.jobId,
            ingested: true,
            archived: false,
          },
        },
      })),
      "listings-archive": vi.fn(async (payload) => ({
        command: "listings-archive",
        format: "json",
        stdout: "",
        stderr: "",
        data: { jobId: payload.jobId, archived: true },
      })),
    };
    commandAdapter.listingsProviders = commandAdapter["listings-providers"];
    commandAdapter.listingsFetch = commandAdapter["listings-fetch"];
    commandAdapter.listingsIngest = commandAdapter["listings-ingest"];
    commandAdapter.listingsArchive = commandAdapter["listings-archive"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 1000) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:listings-ready", 1000);
    await boot();
    const readyEvent = await readyPromise;
    expect(readyEvent.detail).toMatchObject({ available: true });

    await vi.waitFor(() => {
      expect(commandAdapter["listings-providers"]).toHaveBeenCalledTimes(1);
    });

    const document = dom.window.document;
    const listingsSection = document.querySelector('[data-route="listings"]');
    expect(listingsSection?.hasAttribute("hidden")).toBe(true);

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#listings";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await vi.waitFor(() => {
      expect(listingsSection?.hasAttribute("hidden")).toBe(false);
    });

    const providerSelect = document.querySelector("[data-listings-provider]");
    const identifierInput = document.querySelector(
      "[data-listings-identifier]",
    );
    const identifierGroup = identifierInput?.closest("label");
    const titleInput = document.querySelector('[data-listings-filter="title"]');

    const providerValue =
      providerSelect instanceof dom.window.HTMLSelectElement
        ? providerSelect.value
        : null;
    expect(providerValue).toBe("all");
    expect(identifierGroup?.hasAttribute("hidden")).toBe(true);
    expect(identifierInput?.hasAttribute("disabled")).toBe(true);
    if (titleInput instanceof dom.window.HTMLInputElement) {
      titleInput.value = "Engineer";
    }

    const form = document.querySelector("[data-listings-form]");
    form?.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );

    const loadedEvent = await waitForEvent("jobbot:listings-loaded", 1000);
    expect(Array.isArray(loadedEvent.detail?.listings)).toBe(true);
    expect(loadedEvent.detail?.listings).toHaveLength(2);

    expect(commandAdapter["listings-fetch"]).toHaveBeenCalledTimes(1);
    const fetchPayload =
      commandAdapter["listings-fetch"].mock.calls.at(-1)?.[0] ?? {};
    expect(fetchPayload).toMatchObject({
      provider: "all",
      title: "Engineer",
    });
    expect(fetchPayload.limit).toBeUndefined();
    expect(fetchPayload.identifier).toBeUndefined();

    const resultsContainer = document.querySelector("[data-listings-results]");
    expect(resultsContainer?.children.length).toBe(2);
    const range = document.querySelector("[data-listings-range]");
    expect(range?.textContent).toContain("Showing 1-2 of 2");

    const ingestButton = resultsContainer?.querySelector(
      '[data-listing-id="job-1"] [data-listings-action="ingest"]',
    );
    ingestButton?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(commandAdapter["listings-ingest"]).toHaveBeenCalledTimes(1);
    });
    const ingestPayload =
      commandAdapter["listings-ingest"].mock.calls.at(-1)?.[0] ?? {};
    expect(ingestPayload).toMatchObject({
      provider: "greenhouse",
      identifier: "acme-co",
      jobId: "job-1",
    });

    await vi.waitFor(() => {
      const card = document.querySelector(
        '[data-listings-results] [data-listing-id="job-1"]',
      );
      expect(card).not.toBeNull();
      const badge = card?.querySelector(".listing-card__badge");
      expect(badge?.textContent).toContain("Ingested");
      const archive = card?.querySelector('[data-listings-action="archive"]');
      expect(archive).not.toBeNull();
    });

    const archiveButton = document.querySelector(
      '[data-listings-results] [data-listing-id="job-1"] [data-listings-action="archive"]',
    );
    archiveButton?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(commandAdapter["listings-archive"]).toHaveBeenCalledTimes(1);
    });
    const archivePayload =
      commandAdapter["listings-archive"].mock.calls.at(-1)?.[0] ?? {};
    expect(archivePayload).toMatchObject({ jobId: "job-1" });

    await vi.waitFor(() => {
      const activeIds = Array.from(
        document.querySelectorAll("[data-listings-results] [data-listing-id]"),
      ).map((node) => node.getAttribute("data-listing-id"));
      expect(activeIds).not.toContain("job-1");
      expect(activeIds).toContain("job-2");
    });

    await vi.waitFor(() => {
      const updatedRange = document.querySelector("[data-listings-range]");
      expect(updatedRange?.textContent).toContain("Showing 1-1 of 1");
    });
  });

  it("shows application detail drawer with timeline and attachments", async () => {
    const shortlistEntry = {
      id: "job-42",
      metadata: {
        location: "Remote",
        level: "Staff",
        compensation: "$200k",
        synced_at: "2025-03-05T12:00:00.000Z",
      },
      tags: ["remote", "priority"],
      discard_count: 1,
      last_discard: {
        reason: "Paused hiring",
        discarded_at: "2025-03-04T18:00:00.000Z",
      },
    };

    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: [shortlistEntry],
        },
      })),
      "shortlist-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-42" });
        return {
          command: "shortlist-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-42",
            metadata: {
              location: "Remote",
              level: "Staff",
              compensation: "$200k",
              synced_at: "2025-03-05T12:00:00.000Z",
            },
            tags: ["remote", "priority"],
            discard_count: 1,
            last_discard: {
              reason: "Paused hiring",
              discarded_at: "2025-03-04T18:00:00.000Z",
            },
            events: [
              {
                channel: "email",
                contact: "Recruiter",
                note: "Sent resume",
                documents: ["resume.pdf", "cover-letter.pdf"],
                remind_at: "2025-03-06T15:00:00.000Z",
              },
              {
                channel: "call",
                note: "Follow-up scheduled",
                date: "2025-03-07T09:00:00.000Z",
              },
            ],
          },
        };
      }),
      "track-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-42" });
        return {
          command: "track-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-42",
            status: {
              status: "screening",
              note: "Waiting for feedback",
              updated_at: "2025-03-05T16:00:00.000Z",
            },
            events: [
              {
                channel: "interview",
                note: "Scheduled technical interview",
                date: "2025-03-06T18:00:00.000Z",
              },
            ],
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    commandAdapter.shortlistShow = commandAdapter["shortlist-show"];
    commandAdapter.trackShow = commandAdapter["track-show"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector(
      "[data-shortlist-view]",
    );
    expect(detailToggle?.getAttribute("data-shortlist-view")).toBe("job-42");

    const detailLoaded = waitForEvent("jobbot:application-detail-loaded");
    detailToggle?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await detailLoaded;

    expect(commandAdapter["shortlist-show"]).toHaveBeenCalledTimes(1);
    expect(commandAdapter["track-show"]).toHaveBeenCalledTimes(1);

    const detailPanel = dom.window.document.querySelector(
      "[data-application-detail]",
    );
    expect(detailPanel?.hasAttribute("hidden")).toBe(false);
    expect(detailPanel?.textContent).toContain("job-42");
    expect(detailPanel?.textContent).toContain("Remote");
    expect(detailPanel?.textContent).toContain("Sent resume");
    expect(detailPanel?.textContent).toContain("resume.pdf");
    expect(detailPanel?.textContent).toContain("Follow-up scheduled");
  });

  it("merges attachments from shortlist events when track detail omits them", async () => {
    const shortlistEntry = {
      id: "job-77",
      metadata: {
        location: "Remote",
        level: "Senior",
        compensation: "$180k",
        synced_at: "2025-03-02T15:00:00.000Z",
      },
      tags: ["priority"],
      discard_count: 0,
    };

    const shortlistEvents = [
      {
        channel: "email",
        date: "2025-03-03T09:00:00.000Z",
        documents: [" portfolio.pdf ", "resume.pdf"],
      },
      {
        channel: "call",
        date: "2025-03-04T11:30:00.000Z",
        documents: ["resume.pdf", "notes.txt"],
      },
    ];

    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: [shortlistEntry],
        },
      })),
      "shortlist-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-77" });
        return {
          command: "shortlist-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-77",
            metadata: shortlistEntry.metadata,
            tags: shortlistEntry.tags,
            discard_count: shortlistEntry.discard_count,
            events: shortlistEvents,
          },
        };
      }),
      "track-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-77" });
        return {
          command: "track-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-77",
            status: {
              status: "screening",
              note: "Waiting for feedback",
              updated_at: "2025-03-04T12:00:00.000Z",
            },
            events: [],
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    commandAdapter.shortlistShow = commandAdapter["shortlist-show"];
    commandAdapter.trackShow = commandAdapter["track-show"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector(
      "[data-shortlist-view]",
    );
    expect(detailToggle?.getAttribute("data-shortlist-view")).toBe("job-77");

    const detailLoaded = waitForEvent("jobbot:application-detail-loaded");
    detailToggle?.dispatchEvent(
      new dom.window.Event("click", { bubbles: true }),
    );
    await detailLoaded;

    expect(commandAdapter["shortlist-show"]).toHaveBeenCalledTimes(1);
    expect(commandAdapter["track-show"]).toHaveBeenCalledTimes(1);

    const detailPanel = dom.window.document.querySelector(
      "[data-application-detail]",
    );
    expect(detailPanel?.hasAttribute("hidden")).toBe(false);
    expect(detailPanel?.textContent).toContain(
      "Attachments: portfolio.pdf, resume.pdf, notes.txt",
    );
  });

  it("orders application timeline events by most recent activity first", async () => {
    const shortlistEntry = {
      id: "job-88",
      metadata: {
        location: "Remote",
        level: "Lead",
        compensation: "$210k",
        synced_at: "2025-03-10T08:00:00.000Z",
      },
    };

    const shortlistEvents = [
      {
        channel: "call",
        note: "Checked in with recruiter",
        date: "2025-03-04T11:00:00.000Z",
      },
    ];

    const trackEvents = [
      {
        channel: "interview",
        note: "Technical interview scheduled",
        date: "2025-03-03T16:00:00.000Z",
      },
      {
        channel: "email",
        note: "Offer extended",
        date: "2025-03-07T09:30:00.000Z",
      },
    ];

    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: [shortlistEntry],
        },
      })),
      "shortlist-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-88" });
        return {
          command: "shortlist-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-88",
            metadata: shortlistEntry.metadata,
            events: shortlistEvents,
          },
        };
      }),
      "track-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-88" });
        return {
          command: "track-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-88",
            status: {
              status: "offer",
              note: "Pending signature",
              updated_at: "2025-03-07T12:00:00.000Z",
            },
            events: trackEvents,
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    commandAdapter.shortlistShow = commandAdapter["shortlist-show"];
    commandAdapter.trackShow = commandAdapter["track-show"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector(
      "[data-shortlist-view]",
    );
    expect(detailToggle?.getAttribute("data-shortlist-view")).toBe("job-88");

    const detailLoaded = waitForEvent("jobbot:application-detail-loaded");
    detailToggle?.dispatchEvent(
      new dom.window.Event("click", { bubbles: true }),
    );
    await detailLoaded;

    const detailPanel = dom.window.document.querySelector(
      "[data-application-detail]",
    );
    expect(detailPanel?.hasAttribute("hidden")).toBe(false);

    const timelineEntries = Array.from(
      detailPanel?.querySelectorAll(".application-detail__events li") ?? [],
    ).map((node) => node.textContent ?? "");

    expect(timelineEntries[0]).toContain("Offer extended");
    expect(timelineEntries[1]).toContain("Checked in with recruiter");
    expect(timelineEntries[2]).toContain("Technical interview scheduled");
  });

  it("renders analytics funnel dashboard from CLI data", async () => {
    const commandAdapter = {
      "analytics-funnel": vi.fn(async () => ({
        command: "analytics-funnel",
        format: "json",
        stdout: "",
        stderr: "",
        returnValue: 0,
        data: {
          totals: { trackedJobs: 7, withEvents: 5 },
          stages: [
            { key: "outreach", label: "Outreach", count: 5, conversionRate: 1 },
            {
              key: "screening",
              label: "Screening",
              count: 3,
              conversionRate: 0.6,
              dropOff: 2,
            },
            {
              key: "onsite",
              label: "Onsite",
              count: 2,
              conversionRate: 0.6666666667,
              dropOff: 1,
            },
            {
              key: "offer",
              label: "Offer",
              count: 1,
              conversionRate: 0.5,
              dropOff: 1,
            },
          ],
          largestDropOff: {
            from: "screening",
            fromLabel: "Screening",
            to: "onsite",
            toLabel: "Onsite",
            dropOff: 1,
          },
          missing: {
            statuslessJobs: {
              count: 2,
            },
          },
          sankey: {
            nodes: [
              { key: "outreach", label: "Outreach" },
              { key: "screening", label: "Screening" },
              { key: "onsite", label: "Onsite" },
            ],
            links: [
              { source: "outreach", target: "screening", value: 3 },
              {
                source: "outreach",
                target: "outreach_drop",
                value: 2,
                drop: true,
              },
              { source: "screening", target: "onsite", value: 2 },
            ],
          },
        },
      })),
    };

    commandAdapter.analyticsFunnel = commandAdapter["analytics-funnel"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:analytics-ready");
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#analytics";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:analytics-loaded");

    expect(commandAdapter["analytics-funnel"]).toHaveBeenCalledTimes(1);

    const navLink = dom.window.document.querySelector(
      '[data-route-link="analytics"]',
    );
    expect(navLink?.textContent).toContain("Analytics");

    const summary = dom.window.document.querySelector(
      "[data-analytics-summary]",
    );
    expect(summary?.textContent).toContain("Tracked jobs: 7");
    expect(summary?.textContent).toContain("Outreach events: 5");
    expect(summary?.textContent).toContain(
      "Largest drop-off: Screening → Onsite (1)",
    );

    const table = dom.window.document.querySelector("[data-analytics-table]");
    expect(table?.textContent).toContain("Outreach");
    expect(table?.textContent).toContain("Screening");
    expect(table?.textContent).toContain("100%");
    expect(table?.textContent).toContain("60%");

    const missing = dom.window.document.querySelector(
      "[data-analytics-missing]",
    );
    expect(missing?.textContent).toContain(
      "2 jobs with outreach but no status recorded",
    );

    const sankey = dom.window.document.querySelector("[data-analytics-sankey]");
    expect(sankey?.textContent).toContain("3 links");
    expect(sankey?.textContent).toContain("drop-off edges: 1");
  });

  it("downloads analytics exports as JSON and CSV with optional redaction", async () => {
    const funnelPayload = {
      totals: { trackedJobs: 4, withEvents: 3 },
      stages: [
        {
          key: "outreach",
          label: "Outreach",
          count: 4,
          conversionRate: 1,
          dropOff: 0,
        },
      ],
      largestDropOff: null,
      missing: { statuslessJobs: { count: 0 } },
      sankey: { nodes: [], links: [] },
    };

    const snapshot = {
      generated_at: "2025-03-09T09:30:00.000Z",
      totals: funnelPayload.totals,
      funnel: { stages: funnelPayload.stages },
      statuses: { outreach: 4 },
      channels: { email: 3 },
      activity: { interviewsScheduled: 1 },
      companies: [{ name: "Acme", status: "onsite" }],
    };

    const exportPayloads = [];
    const commandAdapter = {
      "analytics-funnel": vi.fn(async () => ({
        command: "analytics-funnel",
        format: "json",
        stdout: "",
        stderr: "",
        returnValue: 0,
        data: funnelPayload,
      })),
      "analytics-export": vi.fn(async (payload) => {
        exportPayloads.push(payload);
        return {
          command: "analytics-export",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: snapshot,
        };
      }),
    };

    commandAdapter.analyticsFunnel = commandAdapter["analytics-funnel"];
    commandAdapter.analyticsExport = commandAdapter["analytics-export"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:analytics-ready");
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#analytics";
    dom.window.dispatchEvent(new HashChange("hashchange"));
    await waitForEvent("jobbot:analytics-loaded");

    const { URL } = dom.window;
    URL.createObjectURL = vi.fn(() => "blob:analytics");
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi
      .spyOn(dom.window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const jsonButton = dom.window.document.querySelector(
      "[data-analytics-export-json]",
    );
    const csvButton = dom.window.document.querySelector(
      "[data-analytics-export-csv]",
    );
    const redactToggle = dom.window.document.querySelector(
      "[data-analytics-redact-toggle]",
    );
    const message = dom.window.document.querySelector(
      "[data-analytics-export-message]",
    );

    expect(redactToggle).not.toBeNull();
    expect(redactToggle?.checked).toBe(true);

    const click = () =>
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });

    jsonButton?.dispatchEvent(click());

    const jsonEvent = await waitForEvent("jobbot:analytics-exported");

    expect(commandAdapter["analytics-export"]).toHaveBeenCalledTimes(1);
    expect(exportPayloads).toContainEqual({ redact: true });
    expect(jsonEvent.detail).toMatchObject({
      format: "json",
      success: true,
      redact: true,
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const jsonBlob = URL.createObjectURL.mock.calls[0]?.[0];
    expect(jsonBlob).toBeInstanceOf(dom.window.Blob);
    expect(jsonBlob.type).toBe("application/json");
    expect(jsonBlob.size).toBeGreaterThan(0);
    expect(message?.textContent).toContain("analytics-snapshot.json");

    if (redactToggle) {
      redactToggle.checked = false;
      redactToggle.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    }

    csvButton?.dispatchEvent(click());

    const csvEvent = await waitForEvent("jobbot:analytics-exported");

    expect(commandAdapter["analytics-export"]).toHaveBeenCalledTimes(2);
    expect(exportPayloads).toContainEqual({ redact: false });
    expect(csvEvent.detail).toMatchObject({
      format: "csv",
      success: true,
      redact: false,
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(anchorClick).toHaveBeenCalledTimes(2);
    const csvBlob = URL.createObjectURL.mock.calls[1]?.[0];
    expect(csvBlob).toBeInstanceOf(dom.window.Blob);
    expect(csvBlob.type).toBe("text/csv");
    expect(csvBlob.size).toBeGreaterThan(0);
    expect(message?.textContent).toContain("analytics-stages.csv");
  });

  it("records status updates from the applications action panel", async () => {
    const shortlistEntry = {
      id: "job-42",
      metadata: {
        location: "Remote",
        level: "Staff",
        compensation: "$200k",
        synced_at: "2025-03-05T12:00:00.000Z",
      },
      tags: ["remote", "priority"],
      discard_count: 0,
    };

    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: [shortlistEntry],
        },
      })),
      "shortlist-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-42" });
        return {
          command: "shortlist-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-42",
            metadata: shortlistEntry.metadata,
            tags: shortlistEntry.tags,
            discard_count: 0,
            events: [],
          },
        };
      }),
      "track-show": vi.fn(async (payload) => {
        expect(payload).toEqual({ jobId: "job-42" });
        return {
          command: "track-show",
          format: "json",
          stdout: "",
          stderr: "",
          returnValue: 0,
          data: {
            job_id: "job-42",
            status: {
              status: "screening",
              note: "Initial screening",
              updated_at: "2025-03-05T12:30:00.000Z",
            },
            events: [],
          },
        };
      }),
      "track-record": vi.fn(async (payload) => {
        expect(payload).toEqual({
          jobId: "job-42",
          status: "offer",
          note: "Signed offer",
        });
        return {
          command: "track-record",
          format: "text",
          stdout: "Recorded job-42 as offer\n",
          stderr: "",
          returnValue: 0,
          data: {
            message: "Recorded job-42 as offer",
            jobId: "job-42",
            status: "offer",
            note: "Signed offer",
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    commandAdapter.shortlistShow = commandAdapter["shortlist-show"];
    commandAdapter.trackShow = commandAdapter["track-show"];
    commandAdapter.trackRecord = commandAdapter["track-record"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector(
      "[data-shortlist-view]",
    );
    expect(detailToggle?.getAttribute("data-shortlist-view")).toBe("job-42");

    const detailLoaded = waitForEvent("jobbot:application-detail-loaded");
    detailToggle?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await detailLoaded;
    expect(commandAdapter["track-show"]).toHaveBeenCalledTimes(1);

    const statusSelect = dom.window.document.querySelector(
      "[data-application-status]",
    );
    expect(statusSelect).not.toBeNull();
    statusSelect.value = "offer";
    statusSelect.dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );

    const noteInput = dom.window.document.querySelector(
      "[data-application-note]",
    );
    expect(noteInput).not.toBeNull();
    noteInput.value = "Signed offer";
    noteInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const form = dom.window.document.querySelector(
      "[data-application-status-form]",
    );
    expect(form).not.toBeNull();

    const statusRecorded = waitForEvent("jobbot:application-status-recorded");
    const detailReloaded = waitForEvent("jobbot:application-detail-loaded");
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    const statusEvent = await statusRecorded;
    await detailReloaded;
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(commandAdapter["track-record"]).toHaveBeenCalledTimes(1);
    const message = dom.window.document.querySelector("[data-action-message]");
    expect(message?.textContent).toContain("Recorded job-42 as offer");
    expect(statusEvent?.detail?.status).toBe("offer");
    expect(statusEvent?.detail?.statusLabel).toBe("Offer");
  });

  it("refreshes application detail after recording a status update", async () => {
    const shortlistDetail = {
      command: "shortlist-show",
      format: "json",
      stdout: JSON.stringify({
        job_id: "job-42",
        metadata: {
          location: "Remote",
          level: "Senior",
          compensation: "$150k",
          synced_at: "2025-03-05T10:00:00.000Z",
        },
        tags: ["remote"],
        attachments: ["resume.pdf"],
        events: [],
      }),
      stderr: "",
      returnValue: 0,
      data: {
        job_id: "job-42",
        metadata: {
          location: "Remote",
          level: "Senior",
          compensation: "$150k",
          synced_at: "2025-03-05T10:00:00.000Z",
        },
        tags: ["remote"],
        attachments: ["resume.pdf"],
        events: [],
      },
    };

    const trackShowInitial = {
      command: "track-show",
      format: "json",
      stdout: JSON.stringify({
        job_id: "job-42",
        status: "screening",
        events: [],
      }),
      stderr: "",
      returnValue: 0,
      data: {
        job_id: "job-42",
        status: "screening",
        events: [],
      },
    };

    const trackShowUpdated = {
      command: "track-show",
      format: "json",
      stdout: JSON.stringify({
        job_id: "job-42",
        status: "offer",
        events: [
          {
            channel: "email",
            date: "2025-03-06T09:30:00.000Z",
            note: "Offer signed",
          },
        ],
      }),
      stderr: "",
      returnValue: 0,
      data: {
        job_id: "job-42",
        status: "offer",
        events: [
          {
            channel: "email",
            date: "2025-03-06T09:30:00.000Z",
            note: "Offer signed",
          },
        ],
      },
    };

    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        command: "shortlist-list",
        format: "json",
        stdout: JSON.stringify({
          total: 1,
          offset: 0,
          limit: 10,
          items: [
            {
              id: "job-42",
              metadata: {
                location: "Remote",
                level: "Senior",
                compensation: "$150k",
                synced_at: "2025-03-05T10:00:00.000Z",
              },
              tags: ["remote"],
              discard_count: 0,
            },
          ],
        }),
        stderr: "",
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 10,
          items: [
            {
              id: "job-42",
              metadata: {
                location: "Remote",
                level: "Senior",
                compensation: "$150k",
                synced_at: "2025-03-05T10:00:00.000Z",
              },
              tags: ["remote"],
              discard_count: 0,
            },
          ],
        },
      })),
      "shortlist-show": vi
        .fn()
        .mockResolvedValueOnce(shortlistDetail)
        .mockResolvedValueOnce(shortlistDetail),
      "track-show": vi
        .fn()
        .mockResolvedValueOnce(trackShowInitial)
        .mockResolvedValueOnce(trackShowUpdated),
      "track-record": vi.fn(async (payload) => {
        expect(payload).toEqual({
          jobId: "job-42",
          status: "offer",
          note: "Signed offer",
        });
        return {
          command: "track-record",
          format: "text",
          stdout: "Recorded job-42 as offer\n",
          stderr: "",
          returnValue: 0,
          data: {
            message: "Recorded job-42 as offer",
            jobId: "job-42",
            status: "offer",
            note: "Signed offer",
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter["shortlist-list"];
    commandAdapter.shortlistShow = commandAdapter["shortlist-show"];
    commandAdapter.trackShow = commandAdapter["track-show"];
    commandAdapter.trackRecord = commandAdapter["track-record"];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) =>
      waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent("jobbot:applications-ready");
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = "#applications";
    dom.window.dispatchEvent(new HashChange("hashchange"));

    await waitForEvent("jobbot:applications-loaded");
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector(
      "[data-shortlist-view]",
    );
    expect(detailToggle?.getAttribute("data-shortlist-view")).toBe("job-42");

    const detailLoadedPromise = waitForEvent(
      "jobbot:application-detail-loaded",
    );
    detailToggle?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    const firstDetailEvent = await detailLoadedPromise;

    expect(commandAdapter["track-show"]).toHaveBeenCalledTimes(1);

    expect(firstDetailEvent?.detail?.data?.status).toBe("screening");

    const statusSelect = dom.window.document.querySelector(
      "[data-application-status]",
    );
    statusSelect.value = "offer";
    statusSelect.dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );

    const noteInput = dom.window.document.querySelector(
      "[data-application-note]",
    );
    noteInput.value = "Signed offer";
    noteInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const form = dom.window.document.querySelector(
      "[data-application-status-form]",
    );
    const statusRecorded = waitForEvent("jobbot:application-status-recorded");
    const nextDetailLoadedPromise = waitForEvent(
      "jobbot:application-detail-loaded",
    );
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await statusRecorded;
    const secondDetailEvent = await nextDetailLoadedPromise;

    expect(commandAdapter["track-record"]).toHaveBeenCalledTimes(1);
    expect(commandAdapter["track-show"]).toHaveBeenCalledTimes(2);
    expect(commandAdapter["shortlist-show"]).toHaveBeenCalledTimes(2);
    expect(secondDetailEvent?.detail?.data?.status).toBe("offer");
  });
});

describe("web server command endpoint", () => {
  it("executes allow-listed commands with validated payloads", async () => {
    const commandAdapter = {
      summarize: vi.fn(async (options) => {
        expect(options).toEqual({
          input: "job.txt",
          format: "json",
          sentences: 2,
          locale: "en",
          timeoutMs: 5000,
          maxBytes: 2048,
        });
        return {
          command: "summarize",
          format: "json",
          stdout: '{"summary":"ok"}',
          stderr: "",
          data: { summary: "ok" },
        };
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({
        input: "job.txt",
        format: "json",
        sentences: "2",
        locale: "en",
        timeoutMs: 5000,
        maxBytes: 2048,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      command: "summarize",
      format: "json",
      stdout: '{"summary":"ok"}',
      stderr: "",
      data: { summary: "ok" },
    });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown commands", async () => {
    const server = await startServer({ commandAdapter: {} });
    const response = await fetch(`${server.url}/commands/unknown`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toMatch(/unknown command/i);
  });

  it("rejects payloads with unexpected fields", async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: "job.txt", unexpected: true }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/unexpected/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it("returns a 502 status when the CLI invocation fails", async () => {
    const error = new Error("summarize command failed: boom");
    error.stdout = "cli-out";
    error.stderr = "cli-error";
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: "job.txt" }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: "summarize command failed: boom",
      stdout: "cli-out",
      stderr: "cli-error",
    });
  });

  it("includes trace identifiers in error responses when available", async () => {
    const error = new Error("summarize command failed: sanitized");
    error.stdout = "";
    error.stderr = "boom";
    error.correlationId = "trace-42";
    error.traceId = "trace-42";
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: "job.txt" }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: "summarize command failed: sanitized",
      correlationId: "trace-42",
      traceId: "trace-42",
      stderr: "boom",
    });
  });

  it("rejects malformed JSON payloads before invoking the CLI", async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: "{",
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/invalid json payload/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it("redacts secret-like tokens from command responses", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({
        command: "summarize",
        format: "json",
        stdout: "API_KEY=abcd1234secret",
        stderr: "Bearer sk_live_1234567890",
        data: {
          token: "abcd1234secret",
          nested: { client_secret: "supersecret" },
        },
      })),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: "job.txt", format: "json" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stdout).toBe("API_KEY=***");
    expect(payload.stderr).toBe("Bearer ***");
    expect(payload.data).toEqual({
      token: "***",
      nested: { client_secret: "***" },
    });
  });

  it("executes shortlist-list commands with sanitized payloads", async () => {
    const commandAdapter = {
      "shortlist-list": vi.fn(async (payload) => {
        expect(payload).toEqual({
          location: "Remote",
          level: "Senior",
          compensation: "$185k",
          tags: ["remote", "dream"],
          offset: 5,
          limit: 25,
        });
        return {
          command: "shortlist-list",
          format: "json",
          stdout: "",
          stderr: "",
          data: {
            total: 1,
            offset: 5,
            limit: 25,
            filters: payload,
            items: [
              {
                id: "job-remote",
                metadata: {
                  location: "Remote",
                  level: "Senior",
                  compensation: "$185k",
                },
                tags: ["remote", "dream"],
                discard_count: 0,
              },
            ],
            hasMore: false,
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter["shortlist-list"];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/shortlist-list`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({
        location: "Remote",
        level: "Senior",
        compensation: "$185k",
        tags: ["remote", "dream"],
        offset: 5,
        limit: 25,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.command).toBe("shortlist-list");
    expect(payload.data).toMatchObject({
      total: 1,
      offset: 5,
      limit: 25,
      hasMore: false,
    });
    expect(Array.isArray(payload.data.items)).toBe(true);
    expect(payload.data.items[0]).toMatchObject({ id: "job-remote" });
    expect(commandAdapter["shortlist-list"]).toHaveBeenCalledTimes(1);
  });

  it("preserves primitive command responses while sanitizing strings", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => "API_KEY=abcd1234secret\u0007"),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: "job.txt" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toBe("API_KEY=***");
  });

  it("rejects command requests without a valid CSRF token", async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "job.txt" }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/csrf/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it("requires a valid authorization token when configured", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auth: { tokens: ["secret-token-123"] },
    });
    const body = JSON.stringify({ input: "job.txt" });

    const missingAuth = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [server.csrfHeaderName]: server.csrfToken,
      },
      body,
    });
    expect(missingAuth.status).toBe(401);
    expect(await missingAuth.json()).toMatchObject({
      error: expect.stringMatching(/authorization/i),
    });
    expect(commandAdapter.summarize).not.toHaveBeenCalled();

    const invalidAuth = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [server.csrfHeaderName]: server.csrfToken,
        authorization: "Bearer nope",
      },
      body,
    });
    expect(invalidAuth.status).toBe(401);
    expect(await invalidAuth.json()).toMatchObject({
      error: expect.stringMatching(/authorization/i),
    });
    expect(commandAdapter.summarize).not.toHaveBeenCalled();

    const validAuth = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [server.csrfHeaderName]: server.csrfToken,
        authorization: "Bearer secret-token-123",
      },
      body,
    });
    expect(validAuth.status).toBe(200);
    expect(await validAuth.json()).toEqual({ ok: true });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it("supports custom authorization headers without schemes", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auth: { tokens: ["magic-token"], headerName: "x-api-key", scheme: "" },
    });

    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [server.csrfHeaderName]: server.csrfToken,
        "x-api-key": "magic-token",
      },
      body: JSON.stringify({ input: "job.txt" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it("enforces role-based access control for configured tokens", async () => {
    const auditEvents = [];
    const auditLogger = {
      record: vi.fn(async (event) => {
        auditEvents.push(event);
      }),
    };
    const commandAdapter = {
      "shortlist-list": vi.fn(async () => ({
        data: {
          items: [],
          page: { limit: 25, hasMore: false },
        },
      })),
      "track-record": vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auditLogger,
      auth: {
        tokens: [
          {
            token: "viewer-token",
            subject: "viewer@example.com",
            roles: ["viewer"],
          },
          {
            token: "editor-token",
            subject: "editor@example.com",
            roles: ["editor"],
          },
        ],
      },
    });

    const viewerHeaders = buildCommandHeaders(server, {
      authorization: "Bearer viewer-token",
    });
    const viewerList = await fetch(`${server.url}/commands/shortlist-list`, {
      method: "POST",
      headers: viewerHeaders,
      body: JSON.stringify({}),
    });
    expect(viewerList.status).toBe(200);
    await viewerList.json();

    const viewerTrack = await fetch(`${server.url}/commands/track-record`, {
      method: "POST",
      headers: viewerHeaders,
      body: JSON.stringify({ jobId: "job-123", status: "screening" }),
    });
    expect(viewerTrack.status).toBe(403);
    expect(await viewerTrack.json()).toMatchObject({
      error: expect.stringMatching(/permission/i),
    });
    expect(commandAdapter["track-record"]).not.toHaveBeenCalled();

    const editorHeaders = buildCommandHeaders(server, {
      authorization: "Bearer editor-token",
    });
    const editorList = await fetch(`${server.url}/commands/shortlist-list`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({}),
    });
    expect(editorList.status).toBe(200);
    await editorList.json();

    const editorTrack = await fetch(`${server.url}/commands/track-record`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify({ jobId: "job-123", status: "screening" }),
    });
    expect(editorTrack.status).toBe(200);
    expect(await editorTrack.json()).toEqual({ ok: true });
    expect(commandAdapter["track-record"]).toHaveBeenCalledTimes(1);

    expect(auditLogger.record).toHaveBeenCalled();
    const rbacEvent = auditEvents.find((event) => event.reason === "rbac");
    expect(rbacEvent).toMatchObject({
      status: "forbidden",
      command: "track-record",
      requiredRoles: ["editor"],
      actor: "viewer@example.com",
      roles: ["viewer"],
    });
    const successEvent = auditEvents.find(
      (event) => event.status === "success" && event.command === "track-record",
    );
    expect(successEvent.roles).toContain("editor");
    expect(successEvent.actor).toBe("editor@example.com");
  });

  it("records actor display names when role checks deny a command", async () => {
    const auditEvents = [];
    const auditLogger = {
      record: vi.fn(async (event) => {
        auditEvents.push(event);
      }),
    };
    const commandAdapter = {
      "track-record": vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auditLogger,
      auth: {
        tokens: [
          {
            token: "viewer-token",
            subject: "viewer@example.com",
            displayName: "Viewer One",
            roles: ["viewer"],
          },
        ],
      },
    });

    const response = await fetch(`${server.url}/commands/track-record`, {
      method: "POST",
      headers: buildCommandHeaders(server, {
        authorization: "Bearer viewer-token",
      }),
      body: JSON.stringify({ jobId: "job-123", status: "screening" }),
    });

    expect(response.status).toBe(403);
    await response.json();

    const rbacEvent = auditEvents.find((event) => event.reason === "rbac");
    expect(rbacEvent).toMatchObject({
      status: "forbidden",
      command: "track-record",
      actor: "viewer@example.com",
      actorDisplayName: "Viewer One",
      roles: ["viewer"],
    });
  });

  it("rejects tokens with explicitly empty role lists", async () => {
    await expect(
      startServer({
        commandAdapter: { summarize: vi.fn(async () => ({ ok: true })) },
        auth: { tokens: [{ token: "empty-role-token", roles: [] }] },
      }),
    ).rejects.toThrow(/auth token roles must include at least one role/i);
  });

  it("rejects tokens with blank role strings", async () => {
    await expect(
      startServer({
        commandAdapter: { summarize: vi.fn(async () => ({ ok: true })) },
        auth: { tokens: [{ token: "blank-role-token", roles: "   " }] },
      }),
    ).rejects.toThrow(/auth token roles must include at least one role/i);
  });

  it("logs telemetry when commands succeed", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const commandAdapter = {
      summarize: vi.fn(async (options) => {
        expect(options).toEqual({ input: "job.txt" });
        return {
          command: "summarize",
          stdout: "ok",
          stderr: "",
          correlationId: "corr-123",
          traceId: "corr-123",
        };
      }),
    };

    const server = await startServer({ commandAdapter, logger });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: "job.txt" }),
    });

    expect(response.status).toBe(200);
    await response.json();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    const entry = logger.info.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: "web.command",
      command: "summarize",
      status: "success",
      httpStatus: 200,
      correlationId: "corr-123",
      traceId: "corr-123",
      payloadFields: ["input"],
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.stdoutLength).toBe(2);
    expect(entry.stderrLength).toBe(0);
  });

  it("logs telemetry when commands fail", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const error = new Error("summarize command failed: boom");
    error.stdout = "oops";
    error.stderr = "fail";
    error.correlationId = "corr-err";
    error.traceId = "corr-err";
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter, logger });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: "job.txt" }),
    });

    expect(response.status).toBe(502);
    await response.json();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);

    const entry = logger.error.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: "web.command",
      command: "summarize",
      status: "error",
      httpStatus: 502,
      correlationId: "corr-err",
      traceId: "corr-err",
      payloadFields: ["input"],
      errorMessage: "summarize command failed: boom",
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.stdoutLength).toBe(4);
    expect(entry.stderrLength).toBe(4);
  });

  it("sanitizes command payload strings before invoking the adapter", async () => {
    const dirtyInput = "  Senior engineer\u0000\nnotes\u0007 ";
    const dirtyLocale = "\u0007 en-US \u0000";
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({ commandAdapter });

    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: dirtyInput, locale: dirtyLocale }),
    });

    expect(response.status).toBe(200);
    await response.json();

    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
    expect(commandAdapter.summarize).toHaveBeenCalledWith({
      input: "Senior engineer\nnotes",
      locale: "en-US",
    });
  });

  it("records sanitized command payload history per client", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auth: {
        tokens: [
          { token: "viewer-token", subject: "viewer@example.com", roles: ["viewer"] },
          { token: "editor-token", subject: "editor@example.com", roles: ["editor"] },
        ],
        scheme: "Bearer",
      },
    });

    const viewerHeaders = buildCommandHeaders(server, {
      authorization: "Bearer viewer-token",
    });
    const viewerPayload = {
      input: "  Viewer resume\u0000",
      locale: "\u0007 en-US ",
    };
    const viewerResponse = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: viewerHeaders,
      body: JSON.stringify(viewerPayload),
    });
    expect(viewerResponse.status).toBe(200);
    await viewerResponse.json();

    const editorHeaders = buildCommandHeaders(server, {
      authorization: "Bearer editor-token",
    });
    const editorPayload = {
      input: "  Editor brief\u0008",
      locale: "\u0007 en-GB ",
    };
    const editorResponse = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: editorHeaders,
      body: JSON.stringify(editorPayload),
    });
    expect(editorResponse.status).toBe(200);
    await editorResponse.json();

    const viewerHistory = await fetch(`${server.url}/commands/payloads/recent`, {
      method: "GET",
      headers: viewerHeaders,
    });
    expect(viewerHistory.status).toBe(200);
    const viewerBody = await viewerHistory.json();
    expect(viewerBody.entries).toEqual([
      {
        command: "summarize",
        payload: { input: "Viewer resume", locale: "en-US" },
        timestamp: expect.any(String),
      },
    ]);

    const editorHistory = await fetch(`${server.url}/commands/payloads/recent`, {
      method: "GET",
      headers: editorHeaders,
    });
    expect(editorHistory.status).toBe(200);
    const editorBody = await editorHistory.json();
    expect(editorBody.entries).toEqual([
      {
        command: "summarize",
        payload: { input: "Editor brief", locale: "en-GB" },
        timestamp: expect.any(String),
      },
    ]);

    const uniqueViewerTimestamps = new Set(
      viewerBody.entries.map((entry) => entry.timestamp),
    );
    expect(uniqueViewerTimestamps.size).toBe(viewerBody.entries.length);

    const uniqueEditorTimestamps = new Set(
      editorBody.entries.map((entry) => entry.timestamp),
    );
    expect(uniqueEditorTimestamps.size).toBe(editorBody.entries.length);
  });

  it("allows guests to inspect their sanitized command payload history", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({ commandAdapter });

    const guestHeaders = buildCommandHeaders(server, {
      "user-agent": "jobbot-guest-test",
    });
    const guestPayload = {
      input: "  Guest resume snippet\u0000",
      locale: "\u0007 en-US ",
    };

    const summarizeResponse = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: guestHeaders,
      body: JSON.stringify(guestPayload),
    });
    expect(summarizeResponse.status).toBe(200);
    await summarizeResponse.json();

    const sessionHeader = server.sessionHeaderName ?? "x-jobbot-session-id";
    const sessionId = summarizeResponse.headers.get(sessionHeader);
    expect(typeof sessionId).toBe("string");
    expect((sessionId ?? "").trim().length).toBeGreaterThanOrEqual(16);

    const missingCsrfResponse = await fetch(
      `${server.url}/commands/payloads/recent`,
      {
        method: "GET",
        headers: {
          "user-agent": "jobbot-guest-test",
          [sessionHeader]: sessionId,
        },
      },
    );
    expect(missingCsrfResponse.status).toBe(403);

    const historyResponse = await fetch(
      `${server.url}/commands/payloads/recent`,
      {
        method: "GET",
        headers: {
          ...guestHeaders,
          [sessionHeader]: sessionId,
        },
      },
    );
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json();
    expect(history.entries).toEqual([
      {
        command: "summarize",
        payload: { input: "Guest resume snippet", locale: "en-US" },
        timestamp: expect.any(String),
      },
    ]);
  });

  it("isolates guest history by per-session identity", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({ commandAdapter });
    const sessionHeader = server.sessionHeaderName ?? "x-jobbot-session-id";

    const guest1Headers = buildCommandHeaders(server, {
      "user-agent": "shared-guest-agent",
    });
    const guest1Payload = {
      input: "First guest payload",
      locale: "en-US",
    };
    const guest1Response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: guest1Headers,
      body: JSON.stringify(guest1Payload),
    });
    expect(guest1Response.status).toBe(200);
    await guest1Response.json();
    const guest1Session = guest1Response.headers.get(sessionHeader);
    expect(typeof guest1Session).toBe("string");
    expect((guest1Session ?? "").trim()).not.toBe("");

    const guest2Headers = buildCommandHeaders(server, {
      "user-agent": "shared-guest-agent",
    });
    const guest2Payload = {
      input: "Second guest payload",
      locale: "en-US",
    };
    const guest2Response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: guest2Headers,
      body: JSON.stringify(guest2Payload),
    });
    expect(guest2Response.status).toBe(200);
    await guest2Response.json();
    const guest2Session = guest2Response.headers.get(sessionHeader);
    expect(typeof guest2Session).toBe("string");
    expect((guest2Session ?? "").trim()).not.toBe("");
    expect(guest2Session).not.toBe(guest1Session);

    const guest1History = await fetch(`${server.url}/commands/payloads/recent`, {
      method: "GET",
      headers: {
        ...guest1Headers,
        [sessionHeader]: guest1Session,
      },
    });
    expect(guest1History.status).toBe(200);
    const guest1Body = await guest1History.json();
    expect(guest1Body.entries).toEqual([
      {
        command: "summarize",
        payload: { input: "First guest payload", locale: "en-US" },
        timestamp: expect.any(String),
      },
    ]);

    const guest2History = await fetch(`${server.url}/commands/payloads/recent`, {
      method: "GET",
      headers: {
        ...guest2Headers,
        [sessionHeader]: guest2Session,
      },
    });
    expect(guest2History.status).toBe(200);
    const guest2Body = await guest2History.json();
    expect(guest2Body.entries).toEqual([
      {
        command: "summarize",
        payload: { input: "Second guest payload", locale: "en-US" },
        timestamp: expect.any(String),
      },
    ]);
  });

  it("rate limits repeated command requests per client", async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      rateLimit: { windowMs: 5000, max: 2 },
    });

    const headers = buildCommandHeaders(server);
    const body = JSON.stringify({ input: "job.txt" });

    const first = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers,
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers,
      body,
    });
    expect(second.status).toBe(200);

    const third = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers,
      body,
    });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({
      error: expect.stringMatching(/too many/i),
    });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(2);
  });
});
