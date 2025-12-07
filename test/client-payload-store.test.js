import { describe, it, expect, vi } from "vitest";

import { createClientPayloadStore } from "../src/web/client-payload-store.js";

function fixedNow() {
  return Date.UTC(2025, 10, 24, 12, 0, 0, 0);
}

describe("createClientPayloadStore", () => {
  it("caps timestamp jitter to the documented 750ms window", () => {
    const store = createClientPayloadStore({
      now: fixedNow,
      jitter: () => 2500,
    });

    const entry = store.record("client-a", "summarize", { foo: "bar" }, { ok: true });

    expect(entry?.timestamp).toBe("2025-11-24T12:00:00.750Z");
    expect(store.getRecent("client-a")[0].timestamp).toBe(entry.timestamp);
  });

  it("decrypts and returns sanitized results for encrypted payload histories", () => {
    const deriveKey = vi.fn(() => Buffer.alloc(32, 1));
    const store = createClientPayloadStore({
      now: fixedNow,
      jitter: () => -125,
      encryption: { deriveKey },
    });

    const recordResult = store.record(
      "client-b",
      "match",
      { input: "\u0000 resume", locale: " en-US  " },
      { stdout: "  ok\u0007\u0007  " },
    );

    expect(recordResult).toMatchObject({
      payload: { input: "resume", locale: "en-US" },
      result: { stdout: "ok" },
      timestamp: "2025-11-24T11:59:59.875Z",
    });

    const history = store.getRecent("client-b");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject(recordResult);
    expect(deriveKey).toHaveBeenCalledWith(expect.stringContaining("client-b"), {
      operation: "record",
    });
    expect(deriveKey).toHaveBeenCalledWith(expect.stringContaining("client-b"), {
      operation: "read",
    });
  });

  it("sanitizes command identifiers before recording history", () => {
    const store = createClientPayloadStore({ jitter: () => 0 });

    store.record("client-b", " summarize\u0007 ", { input: "text" }, { ok: true });

    const entries = store.getRecent("client-b");

    expect(entries).toEqual([
      {
        command: "summarize",
        payload: { input: "text" },
        result: { ok: true },
        timestamp: entries[0].timestamp,
      },
    ]);
    expect(entries[0].timestamp).toMatch(/Z$/);
  });

  it("evicts oldest entries per client while preserving newest writes", () => {
    const store = createClientPayloadStore({
      maxEntriesPerClient: 2,
      now: () => 0,
      jitter: () => 0,
    });

    store.record("client-c", "cmd-1", { a: 1 });
    store.record("client-c", "cmd-2", { a: 2 });
    store.record("client-c", "cmd-3", { a: 3 });

    const history = store.getRecent("client-c");
    expect(history.map((entry) => entry.command)).toEqual(["cmd-2", "cmd-3"]);
  });

  it("drops entries that cannot be decrypted because a read key is missing", () => {
    const deriveKey = vi
      .fn()
      .mockReturnValueOnce(Buffer.alloc(32, 2))
      .mockReturnValueOnce(null);

    const store = createClientPayloadStore({
      encryption: { deriveKey },
      now: fixedNow,
      jitter: () => 0,
    });

    store.record("client-d", "cmd-1", { a: "b" });
    expect(store.getRecent("client-d")).toEqual([]);
  });

  it("removes empty or control-only fields during sanitization", () => {
    const store = createClientPayloadStore({
      now: () => 0,
      jitter: () => 0,
    });

    const entry = store.record(
      "client-e",
      "cmd-4",
      {
        "\u0007invalid": "\u0000\u0001",
        nested: { ok: " yes ", empty: "  " },
      },
      undefined,
    );

    expect(entry).toEqual({
      command: "cmd-4",
      payload: { nested: { ok: "yes" } },
      timestamp: "1970-01-01T00:00:00.000Z",
    });
    expect(store.getRecent("client-e")).toEqual([entry]);
  });
});
