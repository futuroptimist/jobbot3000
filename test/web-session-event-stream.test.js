import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionManager } from "../src/web/session-manager.js";
import { createSessionEventStream } from "../src/web/session-event-stream.js";

afterEach(() => vi.useRealTimers());

function setup(options = {}) {
  let now = 0;
  const manager = createSessionManager({
    rotateAfterMs: 1000,
    idleTimeoutMs: 100,
    absoluteTimeoutMs: 2000,
    clock: { now: () => now },
    ...options,
  });
  const credential = { subject: "same-name" };
  const credentials = new Set([credential, null]);
  const stream = createSessionEventStream({
    sessionManager: manager,
    isCredentialValid: (value) => credentials.has(value),
  });
  function connect(scope) {
    const client = new EventEmitter();
    client.readyState = 1;
    client.bufferedAmount = 0;
    client.send = vi.fn();
    client.terminate = vi.fn(() => client.emit("close"));
    stream.add(client, scope);
    return client;
  }
  const scope = { sessionId: manager.ensureSession().session.id, credential };
  return {
    manager,
    stream,
    scope,
    connect,
    credentials,
    setTime: (value) => {
      now = value;
    },
  };
}

describe("session event delivery", () => {
  it("fails closed on unscoped events and never serializes internal ownership", () => {
    const { stream, scope, connect } = setup();
    const client = connect(scope);
    stream.publish({ result: "private" });
    stream.publish({ result: "private" }, { sessionId: scope.sessionId });
    expect(client.send).not.toHaveBeenCalled();
    stream.publish({ result: "private" }, scope);
    expect(JSON.parse(client.send.mock.calls[0][0])).toEqual({
      result: "private",
    });
    stream.close();
  });

  it.each([
    ["idle", { idleTimeoutMs: 100 }, 100],
    ["absolute", { idleTimeoutMs: 1000, absoluteTimeoutMs: 100 }, 100],
    ["rotation", { rotateAfterMs: 100 }, 100],
  ])(
    "checks %s expiry at send time without waiting for a timer",
    (_, options, time) => {
      const { stream, scope, connect, setTime } = setup(options);
      const client = connect(scope);
      setTime(90);
      stream.publish({ result: "before" }, scope);
      setTime(time);
      stream.publish({ result: "after" }, scope);
      expect(client.send).toHaveBeenCalledTimes(1);
      expect(client.terminate).toHaveBeenCalledOnce();
      stream.close();
    },
  );

  it("expires silent sockets on their deadline", () => {
    vi.useFakeTimers();
    const { stream, scope, connect, setTime } = setup();
    const client = connect(scope);
    setTime(100);
    vi.advanceTimersByTime(100);
    expect(client.terminate).toHaveBeenCalledOnce();
    stream.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors HTTP idle renewal without subscription or delivery renewing it", () => {
    vi.useFakeTimers();
    const { manager, stream, scope, connect, setTime } = setup();
    setTime(80);
    const client = connect(scope);
    expect(manager.remainingLifetime(scope.sessionId)).toBe(20);
    stream.publish({ result: "private" }, scope);
    expect(manager.remainingLifetime(scope.sessionId)).toBe(20);
    manager.ensureSession(scope.sessionId);
    setTime(100);
    vi.advanceTimersByTime(20);
    expect(client.terminate).not.toHaveBeenCalled();
    expect(manager.remainingLifetime(scope.sessionId)).toBe(80);
    setTime(180);
    vi.advanceTimersByTime(80);
    expect(client.terminate).toHaveBeenCalledOnce();
    stream.close();
  });

  it.each(["revocation", "rotation", "eviction"])(
    "disconnects on %s immediately",
    (reason) => {
      const { manager, stream, scope, connect, setTime } = setup({
        maxSessions: 1,
        idleTimeoutMs: 2000,
      });
      const client = connect(scope);
      if (reason === "revocation") manager.revokeSession(scope.sessionId);
      if (reason === "eviction") manager.ensureSession();
      if (reason === "rotation") {
        setTime(90);
        manager.ensureSession(scope.sessionId);
        setTime(1000);
        manager.ensureSession(scope.sessionId);
      }
      expect(client.terminate).toHaveBeenCalledOnce();
      stream.publish({ result: "late" }, scope);
      expect(client.send).not.toHaveBeenCalled();
      stream.close();
    },
  );

  it("checks validity after serialization and credential revocation", () => {
    const { stream, scope, connect, setTime, credentials } = setup();
    const client = connect(scope);
    stream.publish(
      {
        toJSON: () => {
          setTime(100);
          return "private";
        },
      },
      scope,
    );
    expect(client.send).not.toHaveBeenCalled();
    expect(client.terminate).toHaveBeenCalledOnce();
    setTime(0);
    const another = connect(scope);
    credentials.delete(scope.credential);
    stream.publish({ result: "private" }, scope);
    expect(another.send).not.toHaveBeenCalled();
    expect(another.terminate).toHaveBeenCalledOnce();
    stream.close();
  });

  it("drops slow clients without queueing or replaying events to a reconnect", () => {
    const { stream, scope, connect } = setup();
    const slow = connect(scope);
    slow.bufferedAmount = 1;
    stream.publish({ result: "old" }, scope);
    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.terminate).toHaveBeenCalledOnce();
    const fresh = connect(scope);
    expect(fresh.send).not.toHaveBeenCalled();
    stream.publish({ result: "new" }, scope);
    expect(JSON.parse(fresh.send.mock.calls[0][0])).toEqual({ result: "new" });
    stream.close();
  });
});
