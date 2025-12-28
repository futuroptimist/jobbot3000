import { afterEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRateLimiter } from "../src/web/server.js";

describe("rate limit fuzzer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps per-client requests within the rolling window under randomized bursts", () => {
    vi.useFakeTimers();
    const start = new Date("2025-01-01T00:00:00.000Z");
    vi.setSystemTime(start);

    const max = 3;
    const windowMs = 1000;
    const limiter = createInMemoryRateLimiter({ windowMs, max });

    let seed = 42;
    function nextRandomInt(maxExclusive) {
      seed = (seed * 48271) % 2147483647;
      return seed % maxExclusive;
    }

    const clients = ["alpha", "bravo", "charlie", "delta"];
    const windows = new Map();
    let currentTime = start.getTime();
    let observedResets = 0;

    for (let iteration = 0; iteration < 120; iteration += 1) {
      if (iteration % 15 === 0) {
        currentTime += windowMs + 200;
      } else {
        currentTime += 50 + nextRandomInt(550);
      }
      vi.setSystemTime(currentTime);

      const client = clients[nextRandomInt(clients.length)];
      const existing = windows.get(client);
      if (existing && currentTime >= existing.reset) {
        windows.delete(client);
        observedResets += 1;
      }

      const result = limiter.check(client);
      let windowState = windows.get(client);
      if (!windowState) {
        windowState = { reset: result.reset, allowed: 0 };
        windows.set(client, windowState);
      } else {
        expect(result.reset).toBe(windowState.reset);
      }

      if (result.allowed) {
        windowState.allowed += 1;
        expect(windowState.allowed).toBeLessThanOrEqual(max);
      } else {
        expect(windowState.allowed).toBe(max);
      }

      expect(result.reset).toBeGreaterThan(currentTime);
      expect(result.remaining).toBe(Math.max(0, max - windowState.allowed));
    }

    expect(observedResets).toBeGreaterThan(0);
  });
});
