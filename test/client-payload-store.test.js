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
});
