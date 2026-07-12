/* global document, window */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { createLifecycleDiagramView } from "../src/web/tracker/lifecycleDiagram.js";
import {
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";

const app = (id, extra = {}) => ({
  id,
  company: `<img src=x onerror=alert(1)> ${id}`,
  role: "Engineer",
  status: "applied",
  origin: "application_submitted",
  appliedAt: "2026-01-01",
  ...extra,
});
const ev = (id, applicationId, eventType, occurredAt, extra = {}) => ({
  id,
  applicationId,
  eventType,
  occurredAt,
  occurredAtPrecision:
    occurredAt === "unknown"
      ? "unknown"
      : occurredAt.includes("T")
        ? "instant"
        : "date",
  inferred: false,
  createdAt: occurredAt,
  ...extra,
});
const bundle = (applications = [], lifecycleEvents = []) => ({
  applications,
  lifecycleEvents,
});

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
function render(b, selectedBucketId = "current", onBucketChange = vi.fn()) {
  const root = setup();
  const view = createLifecycleDiagramView(root, { onBucketChange });
  const timeline = buildLifecycleTimeline(b);
  const snapshot = projectLifecycleAt(b, selectedBucketId);
  view.update({
    timeline,
    snapshot,
    selectedBucketId,
    newerAvailable: selectedBucketId !== "current",
  });
  return { root, view, timeline, snapshot, onBucketChange };
}

describe("lifecycle diagram view", () => {
  beforeEach(() => vi.useRealTimers());

  it("renders current default controls, accessible svg, and semantic totals", () => {
    const b = bundle(
      [app("a1"), app("a2", { origin: "referral", status: "offer" })],
      [
        ev("o1", "a1", "application_submitted", "2026-01-01"),
        ev("o2", "a2", "referral", "2026-01-01"),
        ev("t2", "a2", "technical_interview", "2026-01-02T10:00:00.000Z"),
        ev("offer", "a2", "offer_received", "2026-01-03"),
      ],
    );
    const { root, snapshot } = render(b);

    expect(
      root.querySelector("input[type='range']").getAttribute("aria-valuetext"),
    ).toContain("Current");
    expect(
      [...root.querySelectorAll("button")].find(
        (button) => button.textContent === "Next event",
      ).disabled,
    ).toBe(true);
    const svg = root.querySelector("svg[role='img']");
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("aria-labelledby")).toContain(
      "lifecycle-diagram-title",
    );
    expect(
      [...svg.querySelectorAll("rect")].every((rect) =>
        Number.isFinite(Number(rect.getAttribute("x"))),
      ),
    ).toBe(true);
    expect(root.textContent).toContain("2/2 applications included");
    expect(root.textContent).toContain("Origins");
    const originCounts = [...root.querySelectorAll("caption")]
      .find((caption) => caption.textContent === "Origins")
      .closest("table")
      .querySelectorAll("tbody tr").length;
    expect(originCounts).toBe(Object.keys(snapshot.totals.origins).length);
  });

  it("handles empty, unknown-only, date, and simultaneous boundary timestamps", () => {
    expect(render(bundle()).root.textContent).toContain(
      "No lifecycle data yet",
    );
    const b = bundle(
      [app("u")],
      [ev("u1", "u", "application_submitted", "unknown")],
    );
    const unknown = render(b, "unknown-date");
    expect(unknown.root.textContent).toContain(
      "Unknown date — off chronological scale",
    );
    expect(unknown.root.textContent).toContain("u1: application_submitted");

    const dated = bundle(
      [app("d")],
      [
        ev("d1", "d", "application_submitted", "2026-01-01"),
        ev("d2", "d", "technical_interview", "2026-01-01"),
      ],
    );
    const bucket = buildLifecycleTimeline(dated).buckets.find(
      (item) => item.kind === "date",
    );
    const rendered = render(dated, bucket.id);
    expect(rendered.root.textContent).toContain("time not recorded");
    expect(rendered.root.textContent).toContain(
      "d1: application_submitted; d2: technical_interview",
    );
  });

  it("synchronizes range controls and keeps user text inert", () => {
    const b = bundle(
      [app("bad")],
      [ev("x", "bad", "application_submitted", "2026-01-01")],
    );
    const onBucketChange = vi.fn();
    const { root, timeline } = render(b, "current", onBucketChange);
    const range = root.querySelector("input[type='range']");
    range.value = "0";
    range.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(onBucketChange).toHaveBeenCalledWith(timeline.buckets[0].id);
    expect(root.querySelector("img")).toBeNull();
    expect([
      ...root.querySelectorAll("svg a, foreignObject, script"),
    ]).toHaveLength(0);
  });

  it("does not mutate P4 projection and has equivalent selectable rows", () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const snapshot = projectLifecycleAt(b);
    const before = JSON.stringify(snapshot);
    const { root } = render(b);
    expect(JSON.stringify(snapshot)).toBe(before);
    const row = [...root.querySelectorAll("tbody tr")].find(
      (tr) =>
        tr.textContent.includes("Application submitted") &&
        tr.textContent.includes("Technical interview"),
    );
    row.click();
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "1 application",
    );
  });
});
