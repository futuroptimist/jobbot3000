import { describe, expect, it } from "vitest";
import { createClientPayloadStore } from "../src/web/client-payload-store.js";

describe("createClientPayloadStore", () => {
  it("evicts oldest clients when exceeding the global maximum", () => {
    const store = createClientPayloadStore({
      maxEntriesPerClient: 2,
      maxClients: 3,
    });

    store.record("client-a", "summarize", { value: "A1" });
    store.record("client-b", "summarize", { value: "B1" });
    store.record("client-c", "summarize", { value: "C1" });

    expect(store.getRecent("client-a")).toHaveLength(1);
    expect(store.getRecent("client-b")).toHaveLength(1);
    expect(store.getRecent("client-c")).toHaveLength(1);

    store.record("client-d", "summarize", { value: "D1" });

    expect(store.getRecent("client-a")).toEqual([]);
    expect(store.getRecent("client-b")).toHaveLength(1);
    expect(store.getRecent("client-c")).toHaveLength(1);
    expect(store.getRecent("client-d")).toHaveLength(1);
  });

  it("treats recently updated clients as most recent", () => {
    const store = createClientPayloadStore({
      maxEntriesPerClient: 1,
      maxClients: 2,
    });

    store.record("client-a", "summarize", { value: "A1" });
    store.record("client-b", "summarize", { value: "B1" });

    // Update client-a so it becomes the most recent entry.
    store.record("client-a", "summarize", { value: "A2" });

    store.record("client-c", "summarize", { value: "C1" });

    expect(store.getRecent("client-b")).toEqual([]);
    expect(store.getRecent("client-a")).toEqual([
      expect.objectContaining({ command: "summarize" }),
    ]);
    expect(store.getRecent("client-c")).toEqual([
      expect.objectContaining({ command: "summarize" }),
    ]);
  });

  it("encrypts payloads per client and refuses mismatched keys", () => {
    const keys = new Map();
    const store = createClientPayloadStore({
      encryption: {
        deriveKey(clientId) {
          if (!clientId) return null;
          if (!keys.has(clientId)) {
            keys.set(clientId, `secret:${clientId}`);
          }
          return keys.get(clientId);
        },
      },
    });

    store.record("client-a", "summarize", {
      value: "A1",
      hidden: "\u0007 Details \u0000",
    });

    const decrypted = store.getRecent("client-a");
    expect(decrypted).toEqual([
      {
        command: "summarize",
        payload: { value: "A1", hidden: "Details" },
        timestamp: expect.any(String),
      },
    ]);

    keys.set("client-a", "different-secret");
    expect(store.getRecent("client-a")).toEqual([]);
  });

  it("jitters payload timestamps before encryption", () => {
    const fixedNow = Date.UTC(2025, 0, 1, 0, 0, 0);
    const store = createClientPayloadStore({
      now: () => fixedNow,
      jitter: () => 420,
      encryption: {
        deriveKey(clientId) {
          return `secret-${clientId}`;
        },
      },
    });

    const entry = store.record("client-a", "summarize", { value: "A1" });

    expect(entry?.timestamp).toBe("2025-01-01T00:00:00.420Z");
    expect(store.getRecent("client-a")).toEqual([
      {
        command: "summarize",
        payload: { value: "A1" },
        timestamp: "2025-01-01T00:00:00.420Z",
      },
    ]);
  });

  it("drops empty collections and whitespace-only keys when sanitizing payloads", () => {
    const store = createClientPayloadStore();

    const entry = store.record("client-a", "summarize", {
      " input ": "  Candidate summary  ",
      notes: [],
      tags: ["priority", "  ", "\u0000"],
      meta: {
        " label ": "  Keep me  ",
        " \t ": "ignored",
        blank: "   ",
        nestedEmpty: {},
      },
    });

    expect(entry).toEqual({
      command: "summarize",
      payload: {
        input: "Candidate summary",
        tags: ["priority"],
        meta: { label: "Keep me" },
      },
      timestamp: expect.any(String),
    });

    expect(store.getRecent("client-a")).toEqual([
      {
        command: "summarize",
        payload: {
          input: "Candidate summary",
          tags: ["priority"],
          meta: { label: "Keep me" },
        },
        timestamp: entry?.timestamp,
      },
    ]);
  });
});
