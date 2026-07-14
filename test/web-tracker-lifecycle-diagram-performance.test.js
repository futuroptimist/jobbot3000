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

function largeBundle(count = 1000) {
  const applications = [];
  const lifecycleEvents = [];
  for (let i = 0; i < count; i += 1) {
    const id = `perf-app-${String(i).padStart(4, "0")}`;
    const origin = origins[i % origins.length];
    applications.push({
      id,
      company: `Synthetic ${i}`,
      role: "Role",
      status: "offer",
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
      i % 2 ? "offer_negotiating" : "offer_accepted",
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
    const smallBundle = largeBundle(10);
    const timeline = buildLifecycleTimeline(bundle);
    const snapshot = projectLifecycleAt(bundle, "current");
    const smallSnapshot = projectLifecycleAt(smallBundle, "current");
    const serialized = JSON.stringify(snapshot);
    Object.freeze(snapshot);
    expect(calculateLifecycleDiagramLayout(snapshot).height).toBe(
      calculateLifecycleDiagramLayout(smallSnapshot).height,
    );

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
    expect(Number(root.querySelector("svg").getAttribute("height"))).toBe(
      calculateLifecycleDiagramLayout(snapshot, 1200).height,
    );
    expect(
      root.querySelectorAll("[data-diagram-node='perf-app-0001']"),
    ).toHaveLength(0);
    expect(
      root.querySelectorAll("[data-diagram-node^='company:']"),
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
    for (const element of root.querySelectorAll("path"))
      expect(element.getAttribute("d") ?? "").not.toMatch(/NaN|Infinity/u);
    for (const element of root.querySelectorAll("rect, text")) {
      for (const attribute of ["x", "y", "width", "height"])
        expect(element.getAttribute(attribute) ?? "").not.toMatch(
          /NaN|Infinity/u,
        );
    }
  });
});
