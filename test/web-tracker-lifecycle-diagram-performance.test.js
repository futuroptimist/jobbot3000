/* global document, window */
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { performance } from "node:perf_hooks";

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
const milestones = [
  "recruiter_screen",
  "assessment_take_home",
  "technical_interview",
  "onsite_final_loop",
  "offer_received",
];
const endpoints = [
  "awaiting_response",
  "interviewing",
  "assessment_in_progress",
  "offer_negotiating",
  "employer_rejected",
  "candidate_withdrew",
  "offer_declined",
  "offer_expired_rescinded",
  "offer_accepted",
  "closed_archived",
  "unknown",
];

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
  global.ResizeObserver = class {
    observe = vi.fn();
    disconnect = vi.fn();
  };
  window.ResizeObserver = global.ResizeObserver;
  window.matchMedia = () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return document.querySelector("[data-lifecycle-diagram]");
}

function largeBundle() {
  const applications = [];
  const lifecycleEvents = [];
  for (let i = 0; i < 1000; i += 1) {
    const id = `perf_app_${String(i).padStart(4, "0")}`;
    const origin = origins[i % origins.length];
    applications.push({
      id,
      company: `Synthetic ${i}`,
      role: "Role",
      status: "applied",
      origin,
      appliedAt: "2026-01-01",
    });
    const types = [
      origin,
      ...milestones,
      endpoints[i % endpoints.length],
      "status_changed",
    ];
    types.forEach((eventType, j) =>
      lifecycleEvents.push({
        id: `perf_ev_${i}_${j}`,
        applicationId: id,
        eventType,
        occurredAt: `2026-01-${String((j % 8) + 1).padStart(2, "0")}T00:00:00.000Z`,
        occurredAtPrecision: "instant",
        createdAt: "2026-01-01T00:00:00.000Z",
        inferred: false,
      }),
    );
  }
  return { applications, lifecycleEvents };
}

describe("lifecycle diagram large render guard", () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

  it("bounds DOM growth and avoids invalid SVG geometry for 1,000 applications", () => {
    const bundle = largeBundle();
    const timeline = buildLifecycleTimeline(bundle);
    const snapshot = projectLifecycleAt(bundle, "current");
    const serialized = JSON.stringify(snapshot);
    let root = setup();
    let view = createLifecycleDiagramView(root);
    view.update({ timeline, snapshot, selectedBucketId: "current" });
    view.destroy();

    root = setup();
    view = createLifecycleDiagramView(root);
    const started = performance.now();
    view.update({ timeline, snapshot, selectedBucketId: "current" });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(5000);
    expect(
      root.querySelectorAll("[data-diagram-node]").length,
    ).toBeLessThanOrEqual(21);
    expect(
      [...root.querySelectorAll("[data-diagram-node]")].some((n) =>
        n.getAttribute("data-diagram-node").includes("perf_app"),
      ),
    ).toBe(false);
    expect(root.querySelectorAll("caption").length).toBeGreaterThan(0);
    const eventRows = [...root.querySelectorAll("caption")]
      .find((c) => c.textContent === "Selected-boundary events")
      .closest("table")
      .querySelectorAll("tbody tr");
    expect(eventRows.length).toBeLessThanOrEqual(50);
    root
      .querySelector("[data-diagram-node]")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-application-range]").textContent).toMatch(
      /Applications 1–50 of/,
    );
    expect(
      root.querySelector("[data-affected-applications]").textContent.split(", ")
        .length,
    ).toBeLessThanOrEqual(50);
    for (const element of root.querySelectorAll("path"))
      expect(element.getAttribute("d") ?? "").not.toMatch(/NaN|Infinity/);
    expect(JSON.stringify(snapshot)).toBe(serialized);
    view.destroy();
  });
});
