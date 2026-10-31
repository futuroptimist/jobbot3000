import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createIngestionBudget,
  createRequestOwner,
  limitsFor,
  LIMIT_CEILINGS,
  IngestionError,
} from "../src/shared/http/ingestion-budget.js";
import { collectPaginatedResults } from "../src/modules/scraping/adapters/common.js";

afterEach(() => vi.useRealTimers());
describe("finite ingestion budgets", () => {
  it.each([NaN, Infinity, -1, 0, 0.5, "2", null])(
    "rejects invalid limits %s",
    (value) => {
      expect(() => limitsFor({ jobs: value })).toThrow();
    },
  );
  it("checks ceilings, accepts zero retries/redirects, and freezes limits", () => {
    for (const [key, ceiling] of Object.entries(LIMIT_CEILINGS)) {
      expect(() => limitsFor({ [key]: ceiling + 1 })).toThrow();
    }
    expect(limitsFor({ retries: 0, redirects: 0 }).retries).toBe(0);
    expect(Object.isFrozen(limitsFor())).toBe(true);
  });
  it.each(["jobs", "pages", "attempts", "encoded", "decoded"])(
    "bounds %s before next work",
    (kind) => {
      const budget = createIngestionBudget({
        limits: { jobs: 1, pages: 1, attempts: 1, runBytes: 1 },
      });
      budget.charge(kind);
      expect(() => budget.charge(kind)).toThrow(IngestionError);
      expect(budget.counts[kind]).toBe(1);
    },
  );
  it("reports incremental saved IDs without claiming rollback", () => {
    const budget = createIngestionBudget({ limits: { jobs: 1 } });
    budget.progress.saved = 1;
    budget.progress.completed = 1;
    budget.progress.jobIds.push("synthetic-snapshot");
    try {
      budget.charge("jobs", 2);
    } catch (error) {
      expect(error).toMatchObject({
        code: "RUN_LIMIT",
        saved: 1,
        completed: 1,
        jobIds: ["synthetic-snapshot"],
      });
    }
  });
  it("includes queued time and uses the earliest run/request deadline", async () => {
    vi.useFakeTimers();
    const budget = createIngestionBudget({ limits: { runMs: 20 } });
    const owner = createRequestOwner(budget, 100);
    await vi.advanceTimersByTimeAsync(20);
    expect(owner.signal.aborted).toBe(true);
    expect(() => owner.check()).toThrow();
    owner.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects cancellation before request construction", () => {
    const controller = new AbortController();
    controller.abort();
    const budget = createIngestionBudget({ signal: controller.signal });
    expect(() => createRequestOwner(budget)).toThrow();
  });
  it("stops repeated offsets instead of returning silent partial success", async () => {
    const fetchPage = vi.fn(async () => ({
      items: ["synthetic"],
      nextOffset: 0,
    }));
    await expect(collectPaginatedResults(fetchPage)).rejects.toMatchObject({
      code: "RUN_LIMIT",
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it("stops at page limits before another fetch", async () => {
    const fetchPage = vi.fn(async ({ offset }) => ({
      items: [offset],
      nextOffset: offset + 1,
    }));
    await expect(
      collectPaginatedResults(fetchPage, {
        budget: createIngestionBudget({ limits: { pages: 2 } }),
      }),
    ).rejects.toMatchObject({ code: "RUN_LIMIT" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it("rejects a repeated page even when the supplied offset advances", async () => {
    const fetchPage = vi.fn(async ({ offset }) => ({
      items: [{ id: "synthetic" }],
      nextOffset: offset + 1,
    }));
    await expect(collectPaginatedResults(fetchPage)).rejects.toMatchObject({
      code: "RUN_LIMIT",
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
