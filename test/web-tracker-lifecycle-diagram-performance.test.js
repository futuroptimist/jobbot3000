/* global document, window */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { createLifecycleDiagramView } from "../src/web/tracker/lifecycleDiagram.js";
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
const terminals = [
  "employer_rejected",
  "candidate_withdrew",
  "offer_declined",
  "offer_expired_rescinded",
  "offer_accepted",
  "closed_archived",
  "employer_rejected",
  "candidate_withdrew",
  "offer_declined",
  "offer_expired_rescinded",
  "offer_accepted",
];

function setup() {
  const dom = new JSDOM(
    "<!doctype html><main><div data-view='diagram'></div></main>",
    {
      url: "https://example.test/tracker",
      pretendToBeVisual: true,
    },
  );
  global.document = dom.window.document;
  global.window = dom.window;
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
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: 1440,
  });
  return document.querySelector("[data-view='diagram']");
}

function largeBundle() {
  const applications = [];
  const lifecycleEvents = [];
  for (let i = 0; i < 1000; i += 1) {
    const id = `synthetic-app-${String(i).padStart(4, "0")}`;
    const origin = origins[i % origins.length];
    applications.push({
      id,
      company: `Synthetic ${i}`,
      role: "Role",
      status: "applied",
      origin,
    });
    const types = [
      origin,
      "employer_response_received",
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
      terminals[i % terminals.length],
    ];
    types.forEach((eventType, index) => {
      const day = String((index % 9) + 1).padStart(2, "0");
      const hour = String(i % 24).padStart(2, "0");
      lifecycleEvents.push({
        id: `event-${String(i).padStart(4, "0")}-${index}`,
        applicationId: id,
        eventType,
        occurredAt: `2026-02-${day}T${hour}:00:00.000Z`,
        occurredAtPrecision: "instant",
        inferred: false,
        createdAt: "2026-02-01T00:00:00.000Z",
      });
    });
  }
  return { applications, lifecycleEvents };
}

describe("lifecycle diagram large-data guard", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

  it("bounds DOM clutter and render time for 1,000 applications", () => {
    const bundle = largeBundle();
    const timeline = buildLifecycleTimeline(bundle);
    const snapshot = projectLifecycleAt(bundle, "current");
    const before = JSON.stringify(snapshot);
    const warmRoot = setup();
    createLifecycleDiagramView(warmRoot).update({
      timeline,
      snapshot,
      selectedBucketId: "current",
    });

    const root = setup();
    const start = performance.now();
    createLifecycleDiagramView(root).update({
      timeline,
      snapshot,
      selectedBucketId: "current",
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
    expect(
      root.querySelectorAll("[data-diagram-node]").length,
    ).toBeLessThanOrEqual(21);
    expect(root.textContent).not.toContain("Synthetic 1");
    expect(root.querySelectorAll("caption")).toHaveLength(5);
    expect(
      [...root.querySelectorAll("caption")]
        .find((c) => c.textContent === "Selected-boundary events")
        .closest("table")
        .querySelectorAll("tbody tr"),
    ).toHaveLength(50);
    root.querySelector("button[aria-label='Select Recruiter screen']").click();
    expect(root.querySelectorAll(".diagram-application-list li")).toHaveLength(
      50,
    );
    while (
      !root.querySelector("button[aria-label='Next application page']").disabled
    )
      root.querySelector("button[aria-label='Next application page']").click();
    expect(root.textContent).toContain("Applications 951–1000 of 1000");
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(root.querySelector("svg").outerHTML).not.toMatch(/NaN|Infinity/);
    expect(root.querySelector("svg").getAttribute("data-reduced-motion")).toBe(
      "true",
    );
  });
});
