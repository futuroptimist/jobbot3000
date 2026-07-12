/* global document */
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  occurredAtPrecision: occurredAt?.includes?.("T") ? "instant" : "date",
  inferred: false,
  createdAt: occurredAt,
  ...extra,
});
const bundle = {
  applications: [
    app("a1"),
    app("a2", { origin: "referral" }),
    app("a3", { status: "rejected" }),
  ],
  lifecycleEvents: [
    ev("e1", "a1", "application_submitted", "2026-01-01"),
    ev("e2", "a1", "recruiter_screen", "2026-01-02T10:00:00Z"),
    ev("e3", "a2", "referral", "2026-01-02T10:00:00Z"),
    ev("e4", "a3", "employer_rejected", "", {
      occurredAtPrecision: "unknown",
      inferred: true,
    }),
  ],
};

function setup(input = bundle, selectedBucketId = "current") {
  const dom = new JSDOM("<!doctype html><div data-lifecycle-diagram></div>", {
    pretendToBeVisual: true,
  });
  global.document = dom.window.document;
  global.window = dom.window;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const root = document.querySelector("[data-lifecycle-diagram]");
  Object.defineProperty(root, "clientWidth", {
    value: 900,
    configurable: true,
  });
  const onSelectBucket = vi.fn();
  const view = createLifecycleDiagramView(root, { onSelectBucket });
  const timeline = buildLifecycleTimeline(input);
  const snapshot = projectLifecycleAt(input, selectedBucketId);
  view.update({
    timeline,
    snapshot,
    selectedBucketId,
    newerAvailable: selectedBucketId !== "current",
  });
  return { dom, root, view, onSelectBucket, timeline, snapshot, input };
}

afterEach(() => {
  delete global.document;
  delete global.window;
  delete global.ResizeObserver;
});

describe("lifecycle diagram view", () => {
  it("renders current by default with accessible SVG and tables", () => {
    const { root, snapshot } = setup();
    expect(root.querySelector("[data-diagram-badge]").textContent).toBe(
      "Current",
    );
    expect(root.querySelector('svg[role="img"] title').textContent).toContain(
      "Application lifecycle",
    );
    expect(root.querySelector("svg desc").textContent).toContain(
      "Equivalent data tables",
    );
    expect(
      root.querySelector('input[type="range"]').getAttribute("aria-valuetext"),
    ).toContain("Current");
    expect(
      [...root.querySelectorAll("path")].every(
        (path) => !path.getAttribute("d").includes("NaN"),
      ),
    ).toBe(true);
    const originTotal = [...root.querySelectorAll("table")][0].textContent;
    const endpointTotal = [...root.querySelectorAll("table")][1].textContent;
    expect(originTotal).toContain(String(snapshot.includedApplications));
    expect(endpointTotal).toContain(String(snapshot.includedApplications));
  });

  it("supports unknown, date, instant, simultaneous, and scrubber synchronization", () => {
    const { root, timeline, onSelectBucket } = setup(bundle, "unknown-date");
    expect(root.querySelector("[data-diagram-time]").textContent).toContain(
      "Unknown date",
    );
    const instant = timeline.buckets.find((b) => b.kind === "instant");
    const view = createLifecycleDiagramView(root, { onSelectBucket });
    view.update({
      timeline,
      snapshot: projectLifecycleAt(bundle, instant.id),
      selectedBucketId: instant.id,
      newerAvailable: true,
    });
    expect(root.querySelector("[data-diagram-badge]").textContent).toContain(
      "Newer activity available",
    );
    expect(root.querySelector("[data-diagram-simultaneous]").hidden).toBe(
      false,
    );
    root.querySelector("[data-diagram-next]").click();
    expect(onSelectBucket).toHaveBeenCalled();
  });

  it("keeps malicious text inert, preserves P4 input, and destroys observers", () => {
    const before = structuredClone(bundle);
    const { root, view } = setup();
    expect(bundle).toEqual(before);
    expect(root.innerHTML).not.toContain("onerror=alert");
    expect(root.textContent).toContain("Warnings:");
    view.destroy();
    expect(root.textContent).toBe("");
  });

  it("renders empty state and no external references", () => {
    const { root } = setup({ applications: [], lifecycleEvents: [] });
    expect(root.textContent).toContain("No diagram applications yet");
    expect(
      root.querySelectorAll(
        'script,link,foreignObject,[href^="http"],[src^="http"]',
      ).length,
    ).toBe(0);
  });
});
