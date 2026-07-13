/* global document, window */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { createLifecycleDiagramView } from "../src/web/tracker/lifecycleDiagram.js";
import {
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";

const now = "2026-01-01T00:00:00.000Z";
const eventTypes = [
  "application_submitted",
  "employer_response_received",
  "recruiter_screen",
  "assessment_take_home",
  "technical_interview",
  "onsite_final_loop",
  "offer_received",
  "offer_accepted",
];

function setup() {
  const dom = new JSDOM(
    "<!doctype html><main><div data-lifecycle-diagram></div></main>",
    { url: "https://example.test/tracker", pretendToBeVisual: true },
  );
  global.document = dom.window.document;
  global.window = dom.window;
  global.ResizeObserver = class {
    observe = vi.fn();
    disconnect = vi.fn();
  };
  window.ResizeObserver = global.ResizeObserver;
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Object.defineProperty(
    document.querySelector("[data-lifecycle-diagram]"),
    "clientWidth",
    {
      configurable: true,
      value: 1024,
    },
  );
  return document.querySelector("[data-lifecycle-diagram]");
}

function largeBundle() {
  const applications = [];
  const lifecycleEvents = [];
  for (let index = 0; index < 1000; index += 1) {
    const id = `perf-app-${String(index).padStart(4, "0")}`;
    applications.push({
      id,
      company: `Synthetic ${index}`,
      role: "Synthetic Role",
      status: "accepted",
      origin: "application_submitted",
      appliedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventTypes.forEach((eventType, eventIndex) => {
      lifecycleEvents.push({
        id: `perf-event-${String(index).padStart(4, "0")}-${eventIndex}`,
        applicationId: id,
        eventType,
        status:
          eventType === "offer_accepted"
            ? "accepted"
            : eventType === "offer_received"
              ? "offer"
              : eventType === "technical_interview"
                ? "technical_screen"
                : eventType === "onsite_final_loop"
                  ? "onsite_loop"
                  : eventType === "recruiter_screen"
                    ? "recruiter_screen"
                    : "applied",
        occurredAt: `2026-01-${String(eventIndex + 1).padStart(2, "0")}T00:00:00.000Z`,
        occurredAtPrecision: "instant",
        inferred: false,
        createdAt: now,
      });
    });
  }
  return { applications, lifecycleEvents };
}

function expectValidSvg(root) {
  expect(
    root.querySelectorAll("[data-diagram-node]").length,
  ).toBeLessThanOrEqual(21);
  expect(root.textContent).not.toMatch(/Synthetic \d/);
  for (const value of [
    ...[...root.querySelectorAll("svg rect")].flatMap((rect) => [
      rect.getAttribute("x"),
      rect.getAttribute("y"),
      rect.getAttribute("width"),
      rect.getAttribute("height"),
    ]),
    ...[...root.querySelectorAll("svg path")].map((path) =>
      path.getAttribute("d"),
    ),
  ]) {
    expect(String(value)).not.toMatch(/NaN|Infinity/);
  }
}

describe("lifecycle diagram large-data guard", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("bounds DOM growth and renders 1,000 applications with eight events each", () => {
    const root = setup();
    const bundle = largeBundle();
    const timeline = buildLifecycleTimeline(bundle);
    const snapshot = projectLifecycleAt(bundle, "current");
    const serializedBefore = JSON.stringify(snapshot);
    Object.freeze(snapshot);
    const warmup = createLifecycleDiagramView(root);
    warmup.update({ timeline, snapshot });
    warmup.destroy();

    const view = createLifecycleDiagramView(root);
    const start = performance.now();
    view.update({ timeline, snapshot });
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(5000);
    expect(root.querySelectorAll("caption").length).toBeGreaterThan(0);
    expect(root.querySelectorAll("table caption").length).toBeGreaterThan(0);
    expect(
      root.querySelectorAll("table").item(4).querySelectorAll("tbody tr"),
    ).toHaveLength(50);
    expect(root.querySelector('[data-reduced-motion="true"]')).toBeTruthy();
    expectValidSvg(root);

    root
      .querySelector('[data-diagram-node-hit="origin:application_submitted"]')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.textContent).toContain("Applications 1–50 of 1000");
    expect(root.textContent).not.toContain("perf-app-0050");
    root.getByText;
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent === "Next application page")
      .click();
    expect(root.textContent).toContain("Applications 51–100 of 1000");

    expect(JSON.stringify(snapshot)).toBe(serializedBefore);
    view.destroy();
    expect(root.textContent).toBe("");
  });
});
