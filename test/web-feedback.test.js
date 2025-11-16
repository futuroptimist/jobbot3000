import { afterEach, describe, expect, it } from "vitest";

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

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

function buildCsrfHeaders(server, extras = {}, cookies = []) {
  const cookieEntries = [
    `${server.csrfCookieName}=test-csrf-token`,
    ...cookies.filter(Boolean),
  ];
  const headers = {
    "content-type": "application/json",
    [server.csrfHeaderName]: server.csrfToken,
    cookie: cookieEntries.join("; "),
    ...extras,
  };
  return headers;
}

describe("web feedback endpoints", () => {
  it("records sanitized feedback and exposes recent entries for guests", async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/feedback`, {
      method: "POST",
      headers: buildCsrfHeaders(server),
      body: JSON.stringify({
        message: "Great flow\u0007!",
        path: "/status\u0000",
        contact: "user@example.com",
      }),
    });

    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry.message).toBe("Great flow!");
    expect(entry.path).toBe("/status");
    expect(entry.contact).toBe("user@example.com");
    expect(entry.recordedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const cookies = response.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies
      .map((cookie) => (cookie || "").split(";")[0])
      .filter(Boolean);

    const recent = await fetch(`${server.url}/feedback/recent`, {
      headers: buildCsrfHeaders(server, {}, sessionCookie),
    });
    expect(recent.status).toBe(200);
    const payload = await recent.json();
    expect(payload.entries[0].message).toBe("Great flow!");
    expect(payload.entries[0].path).toBe("/status");
  });

  it("requires auth when configured and keeps identities isolated", async () => {
    const server = await startServer({
      auth: { tokens: [{ token: "beta-token", subject: "tester" }] },
    });

    const unauthenticated = await fetch(`${server.url}/feedback`, {
      method: "POST",
      headers: buildCsrfHeaders(server),
      body: JSON.stringify({ message: "Hi" }),
    });
    expect(unauthenticated.status).toBe(401);

    const authedHeaders = buildCsrfHeaders(server, {
      authorization: `Bearer beta-token`,
    });
    const authed = await fetch(`${server.url}/feedback`, {
      method: "POST",
      headers: authedHeaders,
      body: JSON.stringify({ message: "Auth ok" }),
    });
    expect(authed.status).toBe(201);

    const recent = await fetch(`${server.url}/feedback/recent`, {
      headers: authedHeaders,
    });
    expect(recent.status).toBe(200);
    const payload = await recent.json();
    expect(payload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Auth ok" }),
      ]),
    );
  });
});

