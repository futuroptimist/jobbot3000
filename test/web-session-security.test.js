import { afterEach, describe, expect, it } from "vitest";

const activeServers = [];

async function startServer(options = {}) {
  const { startWebServer } = await import("../src/web/server.js");
  const server = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    csrfToken: "test-csrf-token",
    rateLimit: { windowMs: 1000, max: 100 },
    ...options,
  });
  activeServers.push(server);
  return server;
}

function extractSessionCookie(response, cookieName) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.raw?.()["set-cookie"] ?? [];
  let latest = null;
  for (const entry of setCookies) {
    if (typeof entry !== "string") continue;
    const [pair] = entry.split(";");
    if (!pair) continue;
    const [name, value] = pair.split("=");
    if (name?.trim() === cookieName) {
      latest = decodeURIComponent(value ?? "");
    }
  }
  return latest;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe("web session security", () => {
  it("rotates session identifiers after the configured interval", async () => {
    let now = 0;
    const clock = { now: () => now };
    const server = await startServer({
      session: {
        rotateAfterMs: 200,
        idleTimeoutMs: 1_000,
        absoluteTimeoutMs: 5_000,
        clock,
      },
    });

    const firstResponse = await fetch(`${server.url}/`);
    expect(firstResponse.status).toBe(200);
    const firstSession = extractSessionCookie(
      firstResponse,
      server.sessionCookieName,
    );
    expect(firstSession).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

    now += 150;
    const secondResponse = await fetch(`${server.url}/`, {
      headers: {
        cookie: `${server.sessionCookieName}=${firstSession}`,
        [server.sessionHeaderName]: firstSession,
      },
    });
    expect(secondResponse.status).toBe(200);
    const secondSession = extractSessionCookie(
      secondResponse,
      server.sessionCookieName,
    );
    expect(secondSession).toBe(firstSession);

    now += 300;
    const rotatedResponse = await fetch(`${server.url}/`, {
      headers: {
        cookie: `${server.sessionCookieName}=${secondSession}`,
        [server.sessionHeaderName]: secondSession,
      },
    });
    expect(rotatedResponse.status).toBe(200);
    const rotatedSession = extractSessionCookie(
      rotatedResponse,
      server.sessionCookieName,
    );
    expect(rotatedSession).toBeTruthy();
    expect(rotatedSession).not.toBe(secondSession);
    expect(rotatedResponse.headers.get(server.sessionHeaderName)).toBe(
      rotatedSession,
    );
  });

  it("issues a fresh session when the previous one expires", async () => {
    let now = 0;
    const clock = { now: () => now };
    const server = await startServer({
      session: {
        rotateAfterMs: 10_000,
        idleTimeoutMs: 500,
        absoluteTimeoutMs: 5_000,
        clock,
      },
    });

    const firstResponse = await fetch(`${server.url}/`);
    expect(firstResponse.status).toBe(200);
    const activeSession = extractSessionCookie(
      firstResponse,
      server.sessionCookieName,
    );
    expect(activeSession).toBeTruthy();

    now += 1_000;
    const expiredResponse = await fetch(`${server.url}/`, {
      headers: {
        cookie: `${server.sessionCookieName}=${activeSession}`,
        [server.sessionHeaderName]: activeSession,
      },
    });
    expect(expiredResponse.status).toBe(200);
    const renewedSession = extractSessionCookie(
      expiredResponse,
      server.sessionCookieName,
    );
    expect(renewedSession).toBeTruthy();
    expect(renewedSession).not.toBe(activeSession);
  });

  it("revokes the current session and replaces it with a new identifier", async () => {
    const server = await startServer();

    const firstResponse = await fetch(`${server.url}/`);
    expect(firstResponse.status).toBe(200);
    const initialSession = extractSessionCookie(
      firstResponse,
      server.sessionCookieName,
    );
    expect(initialSession).toBeTruthy();
    const csrfCookie = extractSessionCookie(
      firstResponse,
      server.csrfCookieName,
    );

    const cookiePairs = [`${server.sessionCookieName}=${initialSession}`];
    if (csrfCookie) {
      cookiePairs.push(`${server.csrfCookieName}=${csrfCookie}`);
    }

    const revokeResponse = await fetch(`${server.url}/sessions/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [server.csrfHeaderName]: server.csrfToken,
        cookie: cookiePairs.join("; "),
        [server.sessionHeaderName]: initialSession,
      },
      body: "{}",
    });
    expect(revokeResponse.status).toBe(200);
    const payload = await revokeResponse.json();
    expect(payload).toMatchObject({ revoked: true });
    const replacementSession = extractSessionCookie(
      revokeResponse,
      server.sessionCookieName,
    );
    expect(replacementSession).toBeTruthy();
    expect(replacementSession).not.toBe(initialSession);

    const followUp = await fetch(`${server.url}/`, {
      headers: {
        cookie: `${server.sessionCookieName}=${initialSession}`,
        [server.sessionHeaderName]: initialSession,
      },
    });
    expect(followUp.status).toBe(200);
    const followUpSession = extractSessionCookie(
      followUp,
      server.sessionCookieName,
    );
    expect(followUpSession).toBeTruthy();
    expect(followUpSession).not.toBe(initialSession);
  });
});
