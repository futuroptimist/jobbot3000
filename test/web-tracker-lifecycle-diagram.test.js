/* global document, window */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

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
    const { root } = render(b);

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
    expect(originCounts).toBe(5);
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
    const root = setup();
    const view = createLifecycleDiagramView(root);
    const timeline = buildLifecycleTimeline(b);
    const snapshot = projectLifecycleAt(b);
    const before = JSON.stringify(snapshot);
    view.update({ timeline, snapshot, selectedBucketId: "current" });
    expect(JSON.stringify(snapshot)).toBe(before);
    const row = [...root.querySelectorAll("tbody tr")].find(
      (tr) =>
        tr.textContent.includes("Application submitted") &&
        tr.textContent.includes("Technical interview"),
    );
    const button = row.querySelector("button[aria-label^='Select flow']");
    expect(button).toBeTruthy();
    button.click();
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "1 application",
    );
  });

  it("provides semantic button controls for flows and nodes", () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = render(b);
    expect(root.querySelector("[data-diagram-link]")).toBeTruthy();
    expect(root.querySelector("[data-diagram-node]")).toBeTruthy();
    const flowButton = root.querySelector("button[aria-label^='Select flow']");
    const nodeButton = root.querySelector(
      "button[aria-label='Select Application submitted']",
    );
    expect(flowButton).toBeTruthy();
    expect(nodeButton).toBeTruthy();
    flowButton.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    flowButton.click();
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "1 application",
    );
    nodeButton.click();
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Application submitted",
    );
  });

  it("summarizes warnings from P4 codes and treats absent keys as zero", () => {
    const root = setup();
    const view = createLifecycleDiagramView(root);
    const empty = projectLifecycleAt(bundle(), "current");
    const timeline = buildLifecycleTimeline(bundle());
    const snapshot = {
      ...empty,
      warningCounts: {
        inferred_event: 2,
        inferred_origin: 3,
        invalid_timestamp: 5,
        status_mismatch: 7,
        regressive_history: 11,
      },
      events: [
        {
          id: "unknown",
          applicationId: "a",
          eventType: "application_submitted",
          occurredAt: "unknown",
          occurredAtPrecision: "unknown",
        },
        {
          id: "legacy-dash",
          applicationId: "b",
          eventType: "application_submitted",
          occurredAt: "unknown",
          occurredAtPrecision: "legacy-placeholder",
        },
        {
          id: "legacy-underscore",
          applicationId: "c",
          eventType: "application_submitted",
          occurredAt: "unknown",
          occurredAtPrecision: "legacy_placeholder",
        },
      ],
    };

    view.update({ timeline, snapshot, selectedBucketId: "current" });
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Warnings: inferred history 2; unknown origin/time 11; status mismatch 7; regression 11.",
    );

    view.update({
      timeline,
      snapshot: { ...empty, warningCounts: {}, events: [] },
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Warnings: inferred history 0; unknown origin/time 0; status mismatch 0; regression 0.",
    );
  });

  it("clears selected flow details when the snapshot changes", () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = render(b);
    root
      .querySelector("[data-diagram-link]")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "1 application",
    );
    view.update({
      timeline,
      snapshot: projectLifecycleAt(bundle(), "current"),
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Select a node or flow row",
    );
  });

  it("preserves valid selections across unchanged snapshot instances", () => {
    const b = bundle(
      [app("a"), app("b")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
        ev("o2", "b", "application_submitted", "2026-01-01"),
        ev("t2", "b", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = render(b);
    const link = root.querySelector("[data-diagram-link]");
    const linkId = link.getAttribute("data-diagram-link");
    link.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const selectedDetails = root.querySelector(
      "[data-diagram-details]",
    ).textContent;
    expect(
      root
        .querySelector(`[data-diagram-link='${linkId}']`)
        .getAttribute("stroke"),
    ).toBe("#fbbf24");

    view.update({
      timeline,
      snapshot: projectLifecycleAt(b, "current"),
      selectedBucketId: "current",
    });

    expect(root.querySelector("[data-diagram-details]").textContent).toBe(
      selectedDetails,
    );
    expect(
      root
        .querySelector(`[data-diagram-link='${linkId}']`)
        .getAttribute("stroke"),
    ).toBe("#fbbf24");
  });

  it("keeps SVG and semantic selections equivalent and debounces live announcements", () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a"), app("b")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
        ev("o2", "b", "application_submitted", "2026-01-01"),
        ev("t2", "b", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline, snapshot } = render(b);
    const detailsText = () =>
      root.querySelector("[data-diagram-details]").textContent;
    const svgNode = root.querySelector(
      "[data-diagram-node='origin:application_submitted']",
    );
    const nodeButton = root.querySelector(
      "button[aria-label='Select Application submitted']",
    );
    svgNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const svgNodeDetails = detailsText();
    nodeButton.click();
    expect(detailsText()).toBe(svgNodeDetails);
    expect(detailsText()).toContain("2 applications (100%)");
    expect(detailsText()).toContain("a, b");

    const svgLink = root.querySelector("[data-diagram-link]");
    const linkId = svgLink.getAttribute("data-diagram-link");
    const link = snapshot.links.find((candidate) => candidate.id === linkId);
    const from = link.source.split(":").at(-1).replaceAll("_", " ");
    const to = link.target.split(":").at(-1).replaceAll("_", " ");
    const semanticFlow = [
      ...root.querySelectorAll("button[aria-label^='Select flow']"),
    ].find(
      (button) =>
        button.getAttribute("aria-label").toLowerCase().includes(from) &&
        button.getAttribute("aria-label").toLowerCase().includes(to),
    );
    svgLink.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const svgLinkDetails = detailsText();
    semanticFlow.click();
    expect(detailsText()).toBe(svgLinkDetails);
    expect(detailsText()).toContain(
      `${link.applicationIds.length} applications`,
    );

    view.update({ timeline, snapshot, selectedBucketId: "current" });
    view.announce("Missing historical point; returned to Current.");
    root.dispatchEvent(new window.Event("resize"));
    vi.advanceTimersByTime(80);
    expect(root.querySelector("#lifecycle-diagram-live").textContent).toBe(
      "Missing historical point; returned to Current.",
    );
    view.destroy();
  });

  it("renders warning summary from supplied P4 warning codes", () => {
    const root = setup();
    const view = createLifecycleDiagramView(root);
    const baseSnapshot = {
      bucket: { id: "current", kind: "current", label: "Current" },
      totalApplications: 0,
      includedApplications: 0,
      nodes: [],
      links: [],
      paths: [],
      totals: { origins: {}, milestones: {}, endpoints: {} },
      warnings: [],
      events: [],
      warningCounts: {},
    };

    view.update({
      timeline: {
        buckets: [{ id: "current", kind: "current", label: "Current" }],
      },
      snapshot: {
        ...baseSnapshot,
        warningCounts: {
          inferred_event: 2,
          inferred_origin: 3,
          invalid_timestamp: 5,
          status_mismatch: 7,
          regressive_history: 11,
        },
        events: [
          { id: "unknown", occurredAtPrecision: "unknown" },
          { id: "legacy-dash", occurredAtPrecision: "legacy-placeholder" },
          {
            id: "legacy-underscore",
            occurredAtPrecision: "legacy_placeholder",
          },
          { id: "date", occurredAtPrecision: "date" },
        ],
      },
      selectedBucketId: "current",
    });

    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Warnings: inferred history 2; unknown origin/time 11; status mismatch 7; regression 11.",
    );

    view.update({
      timeline: {
        buckets: [{ id: "current", kind: "current", label: "Current" }],
      },
      snapshot: baseSnapshot,
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Warnings: inferred history 0; unknown origin/time 0; status mismatch 0; regression 0.",
    );
  });
});

describe("lifecycle diagram P6 pagination and hardening", () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

  it("paginates event rows and resets event pages when bucket changes", () => {
    const applications = [app("many")];
    const lifecycleEvents = Array.from({ length: 125 }, (_, index) =>
      ev(
        `many-${String(index).padStart(3, "0")}`,
        "many",
        index ? "employer_response_received" : "application_submitted",
        `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      ),
    );
    const b = bundle(applications, lifecycleEvents);
    const { root, view, timeline } = render(b);
    const eventRows = () =>
      [...root.querySelectorAll("caption")]
        .find((caption) => caption.textContent === "Selected-boundary events")
        .closest("table")
        .querySelectorAll("tbody tr");
    expect(eventRows()).toHaveLength(50);
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 1–50 of 125",
    );
    root.querySelector("[aria-label='Next event page']").click();
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 51–100 of 125",
    );
    root.querySelector("[aria-label='Next event page']").click();
    expect(eventRows()).toHaveLength(25);
    expect(root.querySelector("[aria-label='Next event page']").disabled).toBe(
      true,
    );
    view.update({
      timeline,
      snapshot: projectLifecycleAt(b, timeline.buckets[0].id),
      selectedBucketId: timeline.buckets[0].id,
    });
    expect(root.querySelector("[data-event-range]").textContent).toMatch(
      /^Events (0–0|1–)/u,
    );
  });

  it("exposes aria-pressed selection and transparent hit targets", () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = render(b);
    const nodeButton = root.querySelector(
      "button[aria-label='Select Application submitted']",
    );
    expect(nodeButton.getAttribute("aria-pressed")).toBe("false");
    nodeButton.click();
    expect(
      root
        .querySelector("button[aria-label='Select Application submitted']")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      root.querySelector("[data-diagram-node-hit][aria-hidden='true']"),
    ).toBeTruthy();
    expect(
      root.querySelector("[data-diagram-link-hit][aria-hidden='true']"),
    ).toBeTruthy();
    expect(
      root.querySelectorAll("[data-diagram-node-hit][tabindex]"),
    ).toHaveLength(0);
  });

  it("uses time elements for exact and date-only event timestamps", () => {
    const b = bundle(
      [app("a")],
      [
        ev("date", "a", "application_submitted", "2026-01-01"),
        ev("exact", "a", "technical_interview", "2026-01-02T10:00:00.000Z"),
        ev("unknown", "a", "employer_response_received", "unknown"),
      ],
    );
    const { root } = render(b);
    expect(root.querySelector("time[datetime='2026-01-01']")).toBeTruthy();
    expect(
      root.querySelector("time[datetime='2026-01-02T10:00:00.000Z']"),
    ).toBeTruthy();
    expect(root.textContent).toContain(
      "Unknown date — off chronological scale",
    );
  });
});
