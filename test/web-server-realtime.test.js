import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

let activeServers = [];
let activeSockets = [];

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

const DEFAULT_CSRF_COOKIE = "jobbot_csrf_token";

function buildCommandHeaders(server, overrides = {}, options = {}) {
  const headerName = server?.csrfHeaderName ?? "x-jobbot-csrf";
  const token = server?.csrfToken ?? "test-csrf-token";
  const cookieName = server?.csrfCookieName ?? DEFAULT_CSRF_COOKIE;
  const includeCookie = options.includeCookie !== false;
  const headers = {
    "content-type": "application/json",
    [headerName]: token,
  };
  if (includeCookie && cookieName) {
    headers.cookie = `${cookieName}=${token}`;
  }
  return {
    ...headers,
    ...overrides,
  };
}

function waitForSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForSocketMessage(socket, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("WebSocket message timed out"));
    }, timeout);
    socket.once("message", (data) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(String(data));
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

afterEach(async () => {
  for (const socket of activeSockets.splice(0)) {
    if (socket.readyState === WebSocket.CLOSED) continue;
    try {
      await new Promise((resolve) => {
        socket.once("close", resolve);
        socket.terminate();
      });
    } catch {
      // ignore cleanup failures
    }
  }

  for (const server of activeServers.splice(0)) {
    await server.close();
  }
});

describe("web server real-time events", () => {
  it("streams command lifecycle events over WebSocket", async () => {
    const commandAdapter = {
      "track-show": vi.fn(async (options) => {
        expect(options).toEqual({ jobId: "abc123" });
        return {
          command: "track-show",
          format: "json",
          stdout: '{"jobId":"abc123"}',
          data: { jobId: "abc123", status: "applied" },
        };
      }),
    };

    const authConfig = {
      headerName: "authorization",
      scheme: "Bearer",
      tokens: [{ token: "secret-token", roles: ["viewer"] }],
    };

    const server = await startServer({ commandAdapter, auth: authConfig });
    const sessionResponse = await fetch(`${server.url}/`);
    const sessionId = sessionResponse.headers.get(server.sessionHeaderName);

    const socketUrl = `${server.url.replace("http", "ws")}/events`;
    const socket = new WebSocket(socketUrl, {
      headers: {
        authorization: "Bearer secret-token",
        [server.sessionHeaderName]: sessionId,
      },
    });
    activeSockets.push(socket);

    await waitForSocketOpen(socket);

    const messagePromise = waitForSocketMessage(socket);

    const response = await fetch(`${server.url}/commands/track-show`, {
      method: "POST",
      headers: buildCommandHeaders(server, {
        authorization: "Bearer secret-token",
        [server.sessionHeaderName]: sessionId,
      }),
      body: JSON.stringify({ jobId: "abc123" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      command: "track-show",
      format: "json",
      stdout: '{"jobId":"abc123"}',
      data: { jobId: "abc123", status: "applied" },
    });

    const event = await messagePromise;
    expect(event).toMatchObject({
      type: "command",
      command: "track-show",
      status: "success",
    });
    expect(event.result).toEqual(payload);
    expect(typeof event.timestamp).toBe("string");
  });

  it("rejects WebSocket connections without valid auth token", async () => {
    const server = await startServer({
      commandAdapter: {
        summarize: vi.fn(async () => ({
          command: "summarize",
          stdout: "{}",
          data: {},
        })),
      },
      auth: {
        headerName: "authorization",
        scheme: "Bearer",
        tokens: [{ token: "another-token", roles: ["viewer"] }],
      },
    });

    const socketUrl = `${server.url.replace("http", "ws")}/events`;

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(socketUrl);
      socket.once("open", () => {
        socket.terminate();
        reject(new Error("WebSocket connection unexpectedly succeeded"));
      });
      socket.once("error", (error) => {
        expect(String(error?.message ?? "")).toContain("401");
        resolve();
      });
    });
  });
});

async function newSession(server, headers = {}) {
  const response = await fetch(`${server.url}/`, { headers });
  expect(response.status).toBe(200);
  return response.headers.get(server.sessionHeaderName);
}

async function connectSession(server, sessionId, token) {
  const headers = { [server.sessionHeaderName]: sessionId };
  if (token) headers.authorization = `Bearer ${token}`;
  const socket = new WebSocket(server.eventsUrl, { headers });
  activeSockets.push(socket);
  const messages = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  await waitForSocketOpen(socket);
  return { socket, messages };
}

async function runCommand(server, sessionId, token, jobId = "private-job") {
  const headers = buildCommandHeaders(server, {
    ...(sessionId ? { [server.sessionHeaderName]: sessionId } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  return fetch(`${server.url}/commands/track-show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jobId }),
  });
}

const sharedAuth = {
  tokens: [
    {
      token: "credential-a",
      subject: "same-name",
      displayName: "Same name",
      roles: ["viewer"],
    },
    {
      token: "credential-b",
      subject: "same-name",
      displayName: "Same name",
      roles: ["viewer"],
    },
  ],
};

// A bounded quiet window checks for unintended frames on actual network sockets.
async function settleFrames() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

describe("private realtime session boundaries", () => {
  it.each([false, true])(
    "isolates success and failure events (auth=%s)",
    async (authenticated) => {
      const server = await startServer({
        auth: authenticated ? sharedAuth : false,
        commandAdapter: {
          "track-show": async ({ jobId }) => {
            if (jobId === "failure") throw new Error("private failure");
            return { data: { jobId } };
          },
        },
      });
      const token = authenticated ? "credential-a" : undefined;
      const sessionA = await newSession(server);
      const sessionB = await newSession(server);
      const a = await connectSession(server, sessionA, token);
      const b = await connectSession(server, sessionB, token);
      const otherCredential = authenticated
        ? await connectSession(server, sessionA, "credential-b")
        : null;
      for (const [jobId, status] of [
        ["private-job", "success"],
        ["failure", "error"],
      ]) {
        const pending = waitForSocketMessage(a.socket);
        const response = await runCommand(server, sessionA, token, jobId);
        expect(response.status).toBe(status === "success" ? 200 : 502);
        const event = await pending;
        expect(event.status).toBe(status);
        expect(event).not.toHaveProperty("sessionId");
        expect(event).not.toHaveProperty("credential");
        expect(JSON.stringify(event)).not.toContain("credential-a");
      }
      const pendingB = waitForSocketMessage(b.socket);
      await runCommand(server, sessionB, token, "b-job");
      expect((await pendingB).result.data.jobId).toBe("b-job");
      await settleFrames();
      expect(a.messages).toHaveLength(2);
      expect(b.messages).toHaveLength(1);
      expect(otherCredential?.messages ?? []).toEqual([]);
    },
  );

  it("requires a live session and accepts a session cookie on upgrades", async () => {
    const server = await startServer({ auth: sharedAuth });
    for (const sessionId of ["", "unknown-session-value"]) {
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(server.eventsUrl, {
          headers: {
            authorization: "Bearer credential-a",
            [server.sessionHeaderName]: sessionId,
          },
        });
        socket.once("open", () => {
          socket.terminate();
          reject(new Error("unexpected upgrade"));
        });
        socket.once("error", (error) => {
          expect(error.message).toContain("401");
          resolve();
        });
      });
    }
    const sessionId = await newSession(server);
    const socket = new WebSocket(server.eventsUrl, {
      headers: {
        authorization: "Bearer credential-a",
        cookie: `${server.sessionCookieName}=${sessionId}`,
      },
    });
    activeSockets.push(socket);
    await waitForSocketOpen(socket);
  });

  it("preserves HTTP history but drops events without live ownership", async () => {
    const server = await startServer({
      auth: sharedAuth,
      commandAdapter: {
        "track-show": async ({ jobId }) => ({ data: { jobId } }),
      },
    });
    const sessionA = await newSession(server);
    const sessionB = await newSession(server);
    const a = await connectSession(server, sessionA, "credential-a");
    const b = await connectSession(server, sessionB, "credential-a");
    expect(
      (await runCommand(server, null, "credential-a", "unscoped-job")).status,
    ).toBe(200);
    await settleFrames();
    expect(a.messages).toEqual([]);
    expect(b.messages).toEqual([]);
    const response = await fetch(`${server.url}/commands/payloads/recent`, {
      headers: buildCommandHeaders(server, {
        authorization: "Bearer credential-a",
        [server.sessionHeaderName]: sessionB,
      }),
    });
    expect(response.status).toBe(200);
    const history = await response.json();
    expect(JSON.stringify(history)).toContain("unscoped-job");
    const other = await fetch(`${server.url}/commands/payloads/recent`, {
      headers: buildCommandHeaders(server, {
        authorization: "Bearer credential-b",
        [server.sessionHeaderName]: sessionB,
      }),
    });
    expect((await other.json()).entries).toEqual([]);
  });

  it.each(
    ["revoke", "rotate", "evict", "idle", "absolute"].flatMap((reason) => [
      [reason, false],
      [reason, true],
    ]),
  )(
    "drops in-flight completions after %s (failure=%s) without replay",
    async (reason, failure) => {
      let now = 0;
      let complete;
      let started;
      const began = new Promise((resolve) => {
        started = resolve;
      });
      const blocked = new Promise((resolve) => {
        complete = resolve;
      });
      const server = await startServer({
        auth: sharedAuth,
        session: {
          clock: { now: () => now },
          maxSessions: reason === "evict" ? 1 : 100,
          rotateAfterMs: reason === "rotate" ? 100 : 10000,
          idleTimeoutMs: reason === "idle" ? 100 : 10000,
          absoluteTimeoutMs: reason === "absolute" ? 100 : 20000,
        },
        commandAdapter: {
          "track-show": async () => {
            started();
            await blocked;
            if (failure) throw new Error("late-private-error");
            return { data: { secret: "late-private-result" } };
          },
        },
      });
      const sessionId = await newSession(server);
      const original = await connectSession(server, sessionId, "credential-a");
      const pending = runCommand(server, sessionId, "credential-a");
      await began;
      let replacement;
      if (reason === "revoke") {
        const response = await fetch(`${server.url}/sessions/revoke`, {
          method: "POST",
          headers: buildCommandHeaders(server, {
            authorization: "Bearer credential-a",
            [server.sessionHeaderName]: sessionId,
          }),
          body: "{}",
        });
        expect(response.status).toBe(200);
        replacement = (await response.json()).sessionId;
      } else if (reason === "evict") {
        replacement = await newSession(server);
      } else {
        now = 100;
        if (reason === "rotate") {
          replacement = await newSession(server, {
            [server.sessionHeaderName]: sessionId,
          });
        }
      }
      const fresh = replacement
        ? await connectSession(server, replacement, "credential-a")
        : null;
      complete();
      expect((await pending).status).toBe(failure ? 502 : 200);
      await settleFrames();
      expect(original.messages).toEqual([]);
      expect(original.socket.readyState).toBe(WebSocket.CLOSED);
      expect(fresh?.messages ?? []).toEqual([]);
    },
  );

  it("closes live subscribers during server shutdown", async () => {
    const server = await startServer({ auth: false });
    const sessionId = await newSession(server);
    const { socket } = await connectSession(server, sessionId);
    const closed = new Promise((resolve) => socket.once("close", resolve));
    await server.close();
    activeServers = activeServers.filter((entry) => entry !== server);
    await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
