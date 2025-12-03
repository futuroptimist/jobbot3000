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
  });
});
