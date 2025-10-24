import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, within } from "@testing-library/dom";
import { JSDOM } from "jsdom";

const activeServers = [];

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

async function loadStatusHubScript(server, dom) {
  if (dom.__jobbotBooted) {
    return;
  }
  const asset = await fetch(`${server.url}/assets/status-hub.js`);
  if (asset.status !== 200) {
    throw new Error(`Failed to load status hub script: ${asset.status}`);
  }
  const code = await asset.text();
  dom.window.eval(code);
  dom.__jobbotBooted = true;
}

async function renderStatusDom(server, options = {}) {
  const { autoBoot = true, ...jsdomOptions } = options;
  const response = await fetch(`${server.url}/`);
  if (response.status !== 200) {
    throw new Error(`Unexpected status code: ${response.status}`);
  }
  const html = await response.text();
  const cookies = response.headers.getSetCookie?.() ?? [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: `${server.url}/`,
    ...jsdomOptions,
  });
  if (cookies.length > 0 && dom.window.document) {
    for (const cookie of cookies) {
      const [pair] = (cookie || "").split(";");
      if (pair) {
        dom.window.document.cookie = pair;
      }
    }
  }
  dom.window.fetch = async (input, init) => {
    const requestInit = init && typeof init === "object" ? { ...init } : {};
    const headers = new Headers();
    const originalHeaders = requestInit.headers;
    if (originalHeaders instanceof Headers) {
      originalHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    } else if (Array.isArray(originalHeaders)) {
      for (const [key, value] of originalHeaders) {
        headers.set(key, value);
      }
    } else if (originalHeaders && typeof originalHeaders === "object") {
      for (const [key, value] of Object.entries(originalHeaders)) {
        headers.set(key, value);
      }
    }
    if (!headers.has("cookie")) {
      const cookieString = dom.window.document?.cookie || "";
      if (cookieString) {
        headers.set("cookie", cookieString);
      }
    }
    requestInit.headers = headers;
    return fetch(input, requestInit);
  };

  const boot = async () => {
    if (dom.__jobbotBooted) {
      return;
    }
    await loadStatusHubScript(server, dom);
  };

  if (autoBoot) {
    await boot();
  }

  return { dom, boot };
}

function waitForDocumentEvent(dom, name, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${name} timed out`));
    }, timeout);
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

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
  vi.restoreAllMocks();
});

describe("status hub frontend", () => {
  it("navigates to Applications and renders shortlist rows", async () => {
    const shortlistList = vi.fn(async () => ({
      data: {
        items: [
          {
            id: "JOB-123",
            metadata: {
              location: "Remote",
              level: "Senior",
              compensation: "$120k",
              synced_at: "2025-11-07T12:00:00Z",
            },
            tags: ["remote", "priority"],
            discard_count: 1,
            last_discard: {
              reason: "Not a fit",
              discarded_at: "2025-11-05T09:30:00Z",
              tags: ["culture"],
            },
          },
        ],
        offset: 0,
        limit: 10,
        total: 1,
      },
    }));
    const listingsProviders = vi.fn(async () => ({
      data: {
        providers: [],
        tokenStatus: [],
      },
    }));

    const server = await startServer({
      commandAdapter: {
        "shortlist-list": shortlistList,
        "listings-providers": listingsProviders,
      },
    });

    const { dom } = await renderStatusDom(server);
    await waitForDocumentEvent(dom, "jobbot:status-panels-ready");

    const nav = dom.window.document.querySelector(
      'nav[aria-label="Status navigation"]',
    );
    const navQueries = within(nav);
    const applicationsLink = navQueries.getByRole("link", { name: /Applications/i });

    fireEvent.click(applicationsLink);
    await waitForDocumentEvent(dom, "jobbot:applications-loaded");

    expect(applicationsLink.getAttribute("aria-current")).toBe("page");
    expect(shortlistList).toHaveBeenCalledTimes(1);

    const table = dom.window.document.querySelector("[data-shortlist-table]");
    expect(table).not.toBeNull();
    expect(table.hasAttribute("hidden")).toBe(false);

    const tableQueries = within(table);
    const row = tableQueries.getByRole("row", { name: /JOB-123/ });
    expect(row.textContent).toContain("JOB-123");
    expect(row.textContent).toContain("Remote");
    expect(row.textContent).toContain("$120k");
  });
});
