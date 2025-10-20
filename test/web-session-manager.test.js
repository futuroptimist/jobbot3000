import { describe, expect, it } from "vitest";

import { createSessionManager } from "../src/web/session-manager.js";

describe("session manager", () => {
  it("evicts the oldest sessions when the capacity is reached", () => {
    let now = 0;
    const manager = createSessionManager({
      rotateAfterMs: 60_000,
      idleTimeoutMs: 60_000,
      absoluteTimeoutMs: 120_000,
      maxSessions: 2,
      clock: { now: () => now },
    });

    const first = manager.ensureSession(null);
    const firstId = first.session.id;
    const second = manager.ensureSession(null);
    const secondId = second.session.id;

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);

    const third = manager.ensureSession(null);
    const thirdId = third.session.id;

    expect(third.created).toBe(true);
    expect(thirdId).toBeTruthy();
    expect(thirdId).not.toBe(firstId);
    expect(thirdId).not.toBe(secondId);

    const firstLookup = manager.ensureSession(firstId, { createIfMissing: false });
    expect(firstLookup).toBeNull();

    const secondLookup = manager.ensureSession(secondId, { createIfMissing: false });
    expect(secondLookup).not.toBeNull();
    expect(secondLookup.session.id).toBe(secondId);

    now += 30_000;
    const secondRefresh = manager.ensureSession(secondId);
    expect(secondRefresh.session.id).toBe(secondId);

    const fourth = manager.ensureSession(null);
    const fourthId = fourth.session.id;
    expect(fourthId).not.toBe(secondId);
    expect(fourthId).not.toBe(thirdId);

    const secondAfterEviction = manager.ensureSession(secondId, {
      createIfMissing: false,
    });
    expect(secondAfterEviction).toBeNull();
  });
});
