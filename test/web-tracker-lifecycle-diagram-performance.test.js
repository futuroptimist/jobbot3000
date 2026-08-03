/* global document, window */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  calculateLifecycleDiagramLayout,
  createLifecycleDiagramView,
} from "../src/web/tracker/lifecycleDiagram.js";
import {
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";

const origins = [
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
];

const endpoints = [
  { id: "offer_negotiating", status: "offer" },
  { id: "offer_accepted", status: "accepted", event: "offer_accepted" },
  { id: "employer_rejected", status: "rejected", event: "employer_rejected" },
  {
    id: "candidate_withdrew",
    status: "withdrawn",
    event: "candidate_withdrew",
  },
  { id: "offer_declined", status: "withdrawn", event: "offer_declined" },
];

function largeBundle(count = 1000) {
  const applications = [];
  const lifecycleEvents = [];
  for (let i = 0; i < count; i += 1) {
    const id = `perf-app-${String(i).padStart(4, "0")}`;
    const origin = origins[0];
    const endpoint = endpoints[0];
    applications.push({
      id,
      company: `Synthetic ${i}`,
      role: "Role",
      status: endpoint.status,
      origin,
    });
    [
      origin,
      "employer_response_received",
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
      endpoint.event ?? endpoint.id,
    ].forEach((eventType, index) => {
      lifecycleEvents.push({
        id: `perf-event-${String(i).padStart(4, "0")}-${index}`,
        applicationId: id,
        eventType,
        occurredAt:
          `2026-04-${String((index % 28) + 1).padStart(2, "0")}` +
          `T${String(index).padStart(2, "0")}:00:00.000Z`,
        occurredAtPrecision: "instant",
        inferred: false,
        createdAt: "2026-04-01T00:00:00.000Z",
        actionStatus:
          eventType === "assessment_take_home" ? "submitted" : undefined,
      });
    });
  }
  return { applications, lifecycleEvents };
}

function staggeredBundle(count) {
  // Unlike largeBundle() above, occurredAt here is unique per (app,
  // eventIndex) pair: every application's 8-event chain lands on
  // completely distinct instants from every other application's, so each
  // bucket transition advances exactly one application instead of all of
  // them simultaneously. This is the case per-app memoization is designed
  // to speed up; largeBundle()'s shared-timestamp fixture is adversarial
  // to it (every dated bucket changes every app's event set at once).
  const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
  const applications = [];
  const lifecycleEvents = [];
  const endpoint = endpoints[0];
  for (let i = 0; i < count; i += 1) {
    const id = `stag-app-${String(i).padStart(4, "0")}`;
    applications.push({
      id,
      company: `Synthetic ${i}`,
      role: "Role",
      status: endpoint.status,
      origin: origins[0],
    });
    [
      origins[0],
      "employer_response_received",
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
      endpoint.event ?? endpoint.id,
    ].forEach((eventType, index) => {
      lifecycleEvents.push({
        id: `stag-event-${String(i).padStart(4, "0")}-${index}`,
        applicationId: id,
        eventType,
        occurredAt: new Date(
          baseMs + i * 1000 + index * 10_000_000,
        ).toISOString(),
        occurredAtPrecision: "instant",
        inferred: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        actionStatus:
          eventType === "assessment_take_home" ? "submitted" : undefined,
      });
    });
  }
  return { applications, lifecycleEvents };
}

function setup() {
  const dom = new JSDOM(
    "<!doctype html><main><div data-lifecycle-diagram></div></main>",
    {
      url: "https://example.test/tracker",
      pretendToBeVisual: true,
    },
  );
  global.document = dom.window.document;
  global.window = dom.window;
  Object.defineProperty(
    document.querySelector("[data-lifecycle-diagram]"),
    "clientWidth",
    { value: 1200 },
  );
  global.ResizeObserver = class {
    observe = vi.fn();
    disconnect = vi.fn();
  };
  window.ResizeObserver = global.ResizeObserver;
  window.matchMedia = () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return document.querySelector("[data-lifecycle-diagram]");
}

describe("lifecycle diagram large-data rendering", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

  it("bounds SVG/table DOM, preserves reachability, and avoids projection mutation", () => {
    const bundle = largeBundle();
    const timeline = buildLifecycleTimeline(bundle);
    const snapshot = projectLifecycleAt(bundle, "current");
    const smallSnapshot = projectLifecycleAt(largeBundle(10), "current");
    const largeLayout = calculateLifecycleDiagramLayout(snapshot, 1200);
    expect(largeLayout).toEqual(
      calculateLifecycleDiagramLayout(smallSnapshot, 1200),
    );
    expect(largeLayout.height).toBeLessThanOrEqual(900);
    const serialized = JSON.stringify(snapshot);
    Object.freeze(snapshot);

    let root = setup();
    let view = createLifecycleDiagramView(root);
    view.update({ timeline, snapshot, selectedBucketId: "current" });
    view.destroy();

    root = setup();
    view = createLifecycleDiagramView(root);
    const start = performance.now();
    view.update({ timeline, snapshot, selectedBucketId: "current" });
    expect(performance.now() - start).toBeLessThan(5000);

    expect(
      root.querySelectorAll("[data-diagram-node]").length,
    ).toBeLessThanOrEqual(21);
    expect(
      root.querySelectorAll("[data-diagram-node='perf-app-0001']"),
    ).toHaveLength(0);
    expect(root.querySelectorAll("caption")).not.toHaveLength(0);
    expect(root.querySelectorAll("caption").item(4).textContent).toBe(
      "Selected-boundary events",
    );
    expect(
      root
        .querySelectorAll("caption")
        .item(4)
        .closest("table")
        .querySelectorAll("tbody tr"),
    ).toHaveLength(50);
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 1–50 of 8000",
    );
    while (
      !root.getByText &&
      !root.querySelector("[aria-label='Next event page']").disabled
    )
      root.querySelector("[aria-label='Next event page']").click();
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 7951–8000 of 8000",
    );

    root
      .querySelector("button[aria-label='Select Offer/negotiating']")
      ?.click();
    if (!root.querySelector("[data-affected-applications]"))
      root.querySelector("button[aria-label^='Select flow']").click();
    expect(
      root.querySelectorAll("[data-affected-applications] li").length,
    ).toBeLessThanOrEqual(50);
    const firstRange = root.querySelector(
      "[data-application-range]",
    ).textContent;
    expect(firstRange).toMatch(/^Applications 1–50 of /u);
    while (!root.querySelector("[aria-label='Next application page']").disabled)
      root.querySelector("[aria-label='Next application page']").click();
    expect(root.querySelector("[data-application-range]").textContent).not.toBe(
      firstRange,
    );
    expect(JSON.stringify(snapshot)).toBe(serialized);
    expect(root.querySelector("svg").getAttribute("height")).toBe(
      String(largeLayout.height),
    );
    for (const element of root.querySelectorAll("path"))
      expect(element.getAttribute("d") ?? "").not.toMatch(/NaN|Infinity/u);
    for (const element of root.querySelectorAll("rect, text, path"))
      for (const attribute of ["x", "y", "width", "height", "stroke-width"])
        expect(element.getAttribute(attribute) ?? "").not.toMatch(
          /NaN|Infinity/u,
        );
  });

  it("caches repeated scrub-bucket visits far cheaper than first-visit cost", () => {
    // This is the regression guard for the scrubber-jank fix: it doesn't
    // just check that a single call is fast (the test above), it checks
    // that *revisiting* a bucket while scrubbing back and forth is a cache
    // hit rather than a full recompute.
    const bundleData = largeBundle();
    const timeline = buildLifecycleTimeline(bundleData);
    const bucketIds = timeline.buckets
      .map((entry) => entry.id)
      .filter((id) => id !== "unknown-date" && id !== "current");
    expect(bucketIds.length).toBeGreaterThan(0);

    const firstVisitStart = performance.now();
    for (const bucketId of bucketIds) projectLifecycleAt(bundleData, bucketId);
    const firstVisitDuration = performance.now() - firstVisitStart;

    const revisitStart = performance.now();
    for (const bucketId of [...bucketIds].reverse())
      projectLifecycleAt(bundleData, bucketId);
    const revisitDuration = performance.now() - revisitStart;

    expect(revisitDuration).toBeLessThan(Math.max(firstVisitDuration / 4, 5));

    const repeatedTimelineStart = performance.now();
    for (let i = 0; i < 50; i += 1) buildLifecycleTimeline(bundleData);
    expect(performance.now() - repeatedTimelineStart).toBeLessThan(50);
  });

  it("reuses cached application paths across adjacent scrub buckets", () => {
    // Complements the revisit test above, which largeBundle() can't probe:
    // every application there shares identical timestamps, so every dated
    // bucket changes all applications' event sets simultaneously and never
    // exercises per-app cache hits. staggeredBundle() stages timestamps so
    // each bucket transition advances exactly one application — the case
    // per-app memoization is designed to speed up.
    //
    // Sample a *contiguous* window starting right after every application
    // has entered (bucket index `appCount`), not an evenly spaced sample
    // across the whole timeline: within this window, moving from one
    // bucket to the next always changes exactly one application's included
    // event set, so every other application's `projectApp` result must be
    // byte-identical to the previous bucket's — memoization should return
    // the *same object reference* for it rather than recomputing.
    //
    // This asserts that structural fact directly, by reference identity,
    // instead of via wall-clock timing: a wall-clock ratio (even a
    // multi-trial median) is inherently host-dependent and was observed to
    // fail intermittently on some machines despite passing reliably on
    // others. Reference-identity counting is deterministic — it either
    // reused the cached object or it didn't — and needs no calibrated
    // threshold, timing margin, or retries.
    const appCount = 100;
    const windowSize = 50;
    const bundleTemplate = staggeredBundle(appCount);
    const timeline = buildLifecycleTimeline(bundleTemplate);
    const allBucketIds = timeline.buckets
      .map((entry) => entry.id)
      .filter((id) => id !== "unknown-date" && id !== "current");
    const windowIds = allBucketIds.slice(appCount, appCount + windowSize);
    expect(windowIds.length).toBe(windowSize);

    // Persistent (warm) walk: one long-lived bundle, so the per-application
    // path cache accumulates across the whole window.
    const persistentBundle = staggeredBundle(appCount);
    const pathsByApplicationPerBucket = windowIds.map((id) => {
      const projection = projectLifecycleAt(persistentBundle, id);
      return new Map(
        projection.paths.map((path) => [path.applicationId, path]),
      );
    });
    expect(pathsByApplicationPerBucket[0].size).toBe(appCount);
    expect(pathsByApplicationPerBucket.at(-1).size).toBe(appCount);

    let reused = 0;
    let changed = 0;
    for (let i = 1; i < pathsByApplicationPerBucket.length; i += 1) {
      const previous = pathsByApplicationPerBucket[i - 1];
      for (const [applicationId, path] of pathsByApplicationPerBucket[i]) {
        if (path === previous.get(applicationId)) reused += 1;
        else changed += 1;
      }
    }
    const uniquePersistentPaths = new Set(
      pathsByApplicationPerBucket.flatMap((byApplication) => [
        ...byApplication.values(),
      ]),
    );
    // (windowSize - 1) adjacent-bucket transitions, one changed application
    // each; every other application across every transition is reused.
    const transitions = windowSize - 1;
    expect(changed).toBe(transitions);
    expect(reused).toBe(transitions * appCount - transitions);
    // One real computation per application at the first bucket, plus one
    // more per transition for the single application that changed.
    expect(uniquePersistentPaths.size).toBe(appCount + transitions);

    // Cold walk: a fresh, content-identical bundle clone for every single
    // bucket call, so no cross-call cache reuse of any kind is possible —
    // every path in every bucket must be a distinct object.
    const uniqueColdPaths = new Set();
    for (const id of windowIds) {
      const projection = projectLifecycleAt(staggeredBundle(appCount), id);
      for (const path of projection.paths) uniqueColdPaths.add(path);
    }
    expect(uniqueColdPaths.size).toBe(windowSize * appCount);
  });
});
