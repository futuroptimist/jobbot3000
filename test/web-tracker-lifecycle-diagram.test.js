/* global document, window */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  calculateLifecycleDiagramLayout,
  createLifecycleDiagramView,
} from "../src/web/tracker/lifecycleDiagram.js";
import * as lifecycleLayout from "../src/web/tracker/lifecycleDiagramLayout.js";
import { buildLifecycleDisplayBranches } from "../src/web/tracker/lifecycleDiagramLayout.js";
import {
  buildLifecycleTimeline,
  LIFECYCLE_DIAGRAM_TAXONOMY,
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

const layoutProjection = (countsByRank) => ({
  nodes: [
    ...Array.from({ length: countsByRank.origin ?? 0 }, (_, index) => ({
      id: `origin:test_${index}`,
      total: 1,
    })),
    ...Array.from({ length: countsByRank.milestone ?? 0 }, (_, index) => ({
      id: `milestone:recruiter_screen_${index}`,
      total: 1,
    })),
    ...Array.from({ length: countsByRank.endpoint ?? 0 }, (_, index) => ({
      id: `endpoint:test_${index}`,
      total: 1,
    })),
  ],
});
const visibleNodeRects = (root) =>
  [...root.querySelectorAll("[data-diagram-node] rect")].filter(
    (rect) => !rect.hasAttribute("data-diagram-node-hit"),
  );
const rectBox = (rect) => ({
  x: Number(rect.getAttribute("x")),
  y: Number(rect.getAttribute("y")),
  width: Number(rect.getAttribute("width")),
  height: Number(rect.getAttribute("height")),
  bottom: Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")),
});
const byRank = (elements) =>
  elements.reduce((groups, element) => {
    const rank = Math.round(Number(element.getAttribute("x")));
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank).push(element);
    return groups;
  }, new Map());
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const EXPECTED_FIXTURE_TAXONOMY_TOTALS = {
  endpoints: {
    awaiting_response: 2,
    interviewing: 4,
    assessment_in_progress: 1,
    offer_negotiating: 2,
    employer_rejected: 1,
    candidate_withdrew: 1,
    offer_declined: 1,
    offer_expired_rescinded: 1,
    offer_accepted: 1,
    closed_archived: 1,
    unknown: 1,
  },
};

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

describe("calculateLifecycleDiagramLayout", () => {
  it("returns contractual heights for busiest-rank densities", () => {
    expect(
      calculateLifecycleDiagramLayout(layoutProjection({ endpoint: 1 })).height,
    ).toBe(360);
    expect(
      calculateLifecycleDiagramLayout(layoutProjection({ endpoint: 3 })).height,
    ).toBe(364);
    expect(
      calculateLifecycleDiagramLayout(layoutProjection({ endpoint: 5 })).height,
    ).toBe(580);
    expect(
      calculateLifecycleDiagramLayout(layoutProjection({ endpoint: 10 }))
        .height,
    ).toBe(1120);
    expect(
      calculateLifecycleDiagramLayout(layoutProjection({ endpoint: 11 }))
        .height,
    ).toBe(1228);
  });

  it("sanitizes invalid widths and preserves wider desktop widths", () => {
    for (const width of [undefined, 0, -1, NaN, Infinity])
      expect(
        calculateLifecycleDiagramLayout(
          layoutProjection({ endpoint: 1 }),
          width,
        ).width,
      ).toBe(1850);
    expect(
      calculateLifecycleDiagramLayout(layoutProjection({ endpoint: 1 }), 1200.9)
        .width,
    ).toBe(1850);
  });

  it("depends only on active node density by rank without mutating projections", () => {
    const projection = layoutProjection({
      origin: 2,
      milestone: 3,
      endpoint: 5,
    });
    const shuffled = { nodes: [...projection.nodes].reverse() };
    expect(calculateLifecycleDiagramLayout(shuffled, 900)).toEqual(
      calculateLifecycleDiagramLayout(projection, 900),
    );
    expect(
      calculateLifecycleDiagramLayout({
        nodes: [...projection.nodes, { id: "origin:extra", total: 1 }],
      }).height,
    ).toBe(calculateLifecycleDiagramLayout(projection).height);
    const grown = calculateLifecycleDiagramLayout({
      nodes: [...projection.nodes, { id: "endpoint:extra", total: 1 }],
    }).height;
    expect(grown - calculateLifecycleDiagramLayout(projection).height).toBe(
      108,
    );
    expect(
      calculateLifecycleDiagramLayout({
        nodes: [...projection.nodes, { id: "endpoint:zero", total: 0 }],
      }).height,
    ).toBe(calculateLifecycleDiagramLayout(projection).height);
    expect(
      calculateLifecycleDiagramLayout({
        nodes: [...projection.nodes, { id: 42, total: 1 }],
      }).height,
    ).toBe(calculateLifecycleDiagramLayout(projection).height);
    const frozen = deepFreeze(structuredClone(projection));
    expect(() => calculateLifecycleDiagramLayout(frozen, 760)).not.toThrow();
    expect(frozen).toEqual(projection);
  });
});

describe("lifecycle diagram view", () => {
  beforeEach(() => vi.useRealTimers());
  it("parses and validates PNG dimensions for visual artifacts", async () => {
    const { readPngDimensions } = await import(
      "../scripts/capture-diagram-visual-review.js"
    );
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(375, 16);
    png.writeUInt32BE(812, 20);
    expect(readPngDimensions(png)).toEqual({ width: 375, height: 812 });
    expect(() => readPngDimensions(Buffer.from("not a png"))).toThrow(
      /valid PNG/u,
    );
  });

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
    expect(snapshot.totals.origins).toEqual({
      application_submitted: 1,
      referral: 1,
    });
    const originRows = [...root.querySelectorAll("caption")]
      .find((caption) => caption.textContent === "Origins")
      .closest("table")
      .querySelectorAll("tbody tr");
    expect(originRows).toHaveLength(LIFECYCLE_DIAGRAM_TAXONOMY.origins.length);
    const outreachRow = [...originRows].find((row) =>
      row.textContent.includes("Candidate outreach"),
    );
    expect(outreachRow.textContent).toContain("0");
  });

  it("keeps semantic tables aggregate-first and preserves semantic button focus", () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = render(b);
    const disclosure = root.querySelector("details.diagram-tables");
    expect(disclosure.querySelector("summary").textContent).toBe(
      "Lifecycle data tables",
    );
    expect(disclosure.open).toBe(false);
    disclosure.open = true;
    disclosure.dispatchEvent(new window.Event("toggle"));
    const button = root.querySelector(
      "button[aria-label='Select Application submitted']",
    );
    button.focus();
    button.click();
    const pressed = root.querySelectorAll(
      ".diagram-select-button[aria-pressed='true']",
    );
    expect(pressed).toHaveLength(1);
    expect(document.activeElement.getAttribute("aria-label")).toBe(
      "Select Application submitted",
    );
    view.update({
      timeline,
      snapshot: projectLifecycleAt(b, timeline.buckets[0].id),
      selectedBucketId: timeline.buckets[0].id,
    });
  });

  it("keeps semantic table disclosure open across immediate node and flow selection", () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = render(b);
    const disclosure = root.querySelector("details.diagram-tables");
    disclosure.open = true;

    root
      .querySelector("button[aria-label='Select Application submitted']")
      .click();
    expect(disclosure.open).toBe(true);

    const flowButton = root.querySelector(
      "button[aria-label^='Select flow Application submitted to Technical interview']",
    );
    expect(flowButton).toBeTruthy();
    const flowId = flowButton.getAttribute("data-diagram-select-id");
    flowButton.click();

    expect(disclosure.open).toBe(true);
    expect(flowButton.isConnected).toBe(false);

    const selectedFlowButton = [
      ...root.querySelectorAll("button[data-diagram-select-id]"),
    ].find(
      (button) => button.getAttribute("data-diagram-select-id") === flowId,
    );

    expect(selectedFlowButton).toBeTruthy();
    expect(selectedFlowButton).not.toBe(flowButton);
    expect(selectedFlowButton.getAttribute("aria-pressed")).toBe("true");
    expect(
      root.querySelectorAll(".diagram-select-button[aria-pressed='true']"),
    ).toHaveLength(1);
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
        .getAttribute("data-selected"),
    ).toBe("true");

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
        .getAttribute("data-selected"),
    ).toBe("true");
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
      "[data-diagram-node='origin:application_submitted'] rect:not([data-diagram-node-hit])",
    );
    const nodeButton = root.querySelector(
      "button[aria-label='Select Application submitted']",
    );
    svgNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const svgNodeDetails = detailsText();
    nodeButton.click();
    expect(detailsText()).toBe(svgNodeDetails);
    expect(detailsText()).toContain("2 applications (100%)");
    expect(
      [...root.querySelectorAll("[data-affected-applications] li")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["a", "b"]);

    const svgLink = root.querySelector("[data-diagram-link]");
    const linkId = svgLink.getAttribute("data-diagram-link");
    const link = buildLifecycleDisplayBranches(snapshot).find(
      (candidate) => candidate.id === linkId,
    );
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

  it("uses density-aware SVG height and spacing on rerender", async () => {
    const sparse = render(
      bundle(
        [app("s")],
        [ev("so", "s", "application_submitted", "2026-01-01")],
      ),
    );
    expect(sparse.root.querySelector("svg").getAttribute("height")).toBe("360");

    const fixture = await import(
      "./fixtures/tracker-lifecycle-diagram-v2.json",
      {
        with: { type: "json" },
      }
    );
    const expectedHeight = 1660;
    const dense = render(fixture.default);
    const svg = dense.root.querySelector("svg");
    const denseLayout = calculateLifecycleDiagramLayout(dense.snapshot);
    expect(denseLayout.height).toBe(expectedHeight);
    if (svg) {
      expect(svg.getAttribute("height")).toBe(String(expectedHeight));
      expect(svg.getAttribute("viewBox")).toBe(
        `0 0 ${denseLayout.width} ${denseLayout.height}`,
      );
    }
    const nodesById = new Map(
      visibleNodeRects(dense.root).map((rect) => [
        rect.closest("[data-diagram-node]").getAttribute("data-diagram-node"),
        rectBox(rect),
      ]),
    );
    if (!nodesById.has("origin:application_submitted")) return;
    expect(nodesById.get("origin:application_submitted").x).toBeCloseTo(100);
    const awaitingResponse = nodesById.get("endpoint:awaiting_response");
    expect(awaitingResponse.x + awaitingResponse.width).toBeCloseTo(1750);

    for (const rects of byRank(visibleNodeRects(dense.root)).values()) {
      const sorted = rects.map(rectBox).sort((a, b) => a.y - b.y);
      expect(sorted[0].y).toBeGreaterThanOrEqual(64 - 0.5);
      expect(sorted.at(-1).bottom).toBeLessThanOrEqual(
        expectedHeight - 48 + 0.5,
      );
      for (let index = 1; index < sorted.length; index += 1)
        expect(
          sorted[index].y - sorted[index - 1].bottom,
        ).toBeGreaterThanOrEqual(72 - 0.5);
    }

    for (const hits of byRank([
      ...dense.root.querySelectorAll("[data-diagram-node-hit]"),
    ]).values()) {
      const sorted = hits.map(rectBox).sort((a, b) => a.y - b.y);
      for (let index = 1; index < sorted.length; index += 1)
        expect(sorted[index].y).toBeGreaterThanOrEqual(
          sorted[index - 1].bottom - 0.5,
        );
    }

    dense.root
      .querySelector("[data-diagram-node-hit]")
      ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    if (dense.root.querySelector("svg"))
      expect(dense.root.querySelector("svg").getAttribute("height")).toBe(
        String(expectedHeight),
      );
  });
});

describe("lifecycle diagram P6 pagination and hardening", () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

  it("paginates event rows and resets event pages when snapshots or buckets change", () => {
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
    const updated = bundle(applications, lifecycleEvents.slice(0, 124));
    view.update({
      timeline,
      snapshot: projectLifecycleAt(updated, "current"),
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 1–50 of 124",
    );
    root.querySelector("[aria-label='Next event page']").click();
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 51–100 of 124",
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

  it("paginates more than 50 endpoint-conditioned flow rows without losing reachability", () => {
    const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map(({ id }) => id);
    const milestones = LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map(
      ({ id }) => id,
    );
    const endpoints = LIFECYCLE_DIAGRAM_TAXONOMY.endpoints
      .filter(({ id }) => id !== "unknown")
      .map(({ id }) => id);
    const applications = [];
    const lifecycleEvents = [];
    for (let index = 0; index < 60; index += 1) {
      const id = `flow-app-${String(index).padStart(2, "0")}`;
      const origin = origins[index % origins.length];
      const milestone =
        milestones[Math.floor(index / origins.length) % milestones.length];
      const endpoint = endpoints[index % endpoints.length];
      applications.push(app(id, { origin }));
      [origin, milestone, endpoint].forEach((eventType, eventIndex) => {
        lifecycleEvents.push(
          ev(
            `flow-event-${index}-${eventIndex}`,
            id,
            eventType,
            `2026-05-${String(eventIndex + 1).padStart(2, "0")}`,
          ),
        );
      });
    }
    const { root, view, timeline } = render(
      bundle(applications, lifecycleEvents),
    );
    const flowRows = () =>
      [...root.querySelectorAll("caption")]
        .find((caption) => caption.textContent === "Flows")
        .closest("table")
        .querySelectorAll("tbody tr");
    const flowIds = () =>
      [...flowRows()].map((row) =>
        row.querySelector("button").getAttribute("aria-label"),
      );
    const firstPage = flowIds();
    expect(firstPage).toHaveLength(50);
    const totalFlows = Number(
      root.querySelector("[data-flow-range]").textContent.match(/of (\d+)/u)[1],
    );
    expect(totalFlows).toBeGreaterThan(50);
    root.querySelector("[aria-label='Next flow page']").click();
    const secondPage = flowIds();
    expect(secondPage.length).toBeGreaterThan(0);
    expect(root.querySelector("[data-flow-range]").textContent).toBe(
      `Flows 51–${Math.min(100, totalFlows)} of ${totalFlows}`,
    );
    while (!root.querySelector("[aria-label='Next flow page']").disabled)
      root.querySelector("[aria-label='Next flow page']").click();
    const lastPage = flowIds();
    expect(
      new Set([...firstPage, ...secondPage, ...lastPage]).size,
    ).toBeGreaterThan(50);
    if (!root.querySelector("details.diagram-tables").open)
      root.querySelector("details.diagram-tables summary").click();
    secondPage.at(-1);
    view.update({
      timeline,
      snapshot: projectLifecycleAt(
        bundle(applications.slice(0, 49), lifecycleEvents),
        "current",
      ),
      selectedBucketId: "current",
    });
    expect(flowRows().length).toBeLessThanOrEqual(50);
    expect(root.querySelector("[data-flow-range]").textContent).toMatch(
      /^Flows 1–\d+ of \d+$/u,
    );
    expect(
      root.querySelector("[aria-label='Previous flow page']").disabled,
    ).toBe(true);
  });

  it("paginates affected applications with bounded ranges", () => {
    const applications = Array.from({ length: 125 }, (_, index) =>
      app(`app-${String(index).padStart(3, "0")}`),
    );
    const lifecycleEvents = applications.map((application, index) =>
      ev(
        `evt-${String(index).padStart(3, "0")}`,
        application.id,
        "application_submitted",
        "2026-01-01",
      ),
    );
    const { root } = render(bundle(applications, lifecycleEvents));
    root
      .querySelector("[data-diagram-node='origin:application_submitted'] rect")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const pageIds = () =>
      [...root.querySelectorAll("[data-affected-applications] li")].map(
        (item) => item.textContent,
      );
    const affected = root.querySelector("[data-diagram-details] details");
    expect(affected.open).toBe(false);
    expect(affected.querySelector("summary").textContent).toBe(
      "Affected applications (125)",
    );
    expect(pageIds()).toHaveLength(50);
    expect(root.querySelector("[data-application-range]").textContent).toBe(
      "Applications 1–50 of 125",
    );
    expect(
      root.querySelector("[aria-label='Previous application page']").disabled,
    ).toBe(true);
    root.querySelector("[aria-label='Next application page']").click();
    expect(root.querySelector("[data-application-range]").textContent).toBe(
      "Applications 51–100 of 125",
    );
    root.querySelector("[aria-label='Next application page']").click();
    expect(pageIds()).toHaveLength(25);
    expect(root.querySelector("[data-application-range]").textContent).toBe(
      "Applications 101–125 of 125",
    );
    expect(
      root.querySelector("[aria-label='Next application page']").disabled,
    ).toBe(true);
    root
      .querySelector("[data-diagram-node='endpoint:awaiting_response'] rect")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-application-range]").textContent).toBe(
      "Applications 1–50 of 125",
    );
    expect(
      root.querySelector("[data-diagram-details]").textContent,
    ).not.toContain(
      applications.map((application) => application.id).join(", "),
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
    expect(
      root.querySelectorAll("[data-diagram-link-hit][tabindex]"),
    ).toHaveLength(0);
    expect(root.querySelectorAll("[data-diagram-link-hit] title")).toHaveLength(
      0,
    );
  });

  it("renders the layout fallback when branch handle placement fails", () => {
    const spy = vi
      .spyOn(lifecycleLayout, "assignBranchHandles")
      .mockImplementation(() => {
        throw new Error("forced handle placement failure");
      });
    try {
      const b = bundle(
        [app("a")],
        [
          ev("o", "a", "application_submitted", "2026-01-01"),
          ev("t", "a", "technical_interview", "2026-01-02"),
        ],
      );
      const { root } = render(b);
      expect(root.textContent).toContain(
        "Unable to lay out lifecycle diagram.",
      );
      expect(root.querySelector("svg")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("renders the layout fallback when node label wrapping fails", () => {
    const spy = vi
      .spyOn(lifecycleLayout, "wrapLifecycleLabel")
      .mockImplementation(() => {
        throw new Error("forced label wrapping failure");
      });
    try {
      const b = bundle(
        [app("a")],
        [
          ev("o", "a", "application_submitted", "2026-01-01"),
          ev("t", "a", "technical_interview", "2026-01-02"),
        ],
      );
      const { root } = render(b);
      expect(root.textContent).toContain(
        "Unable to lay out lifecycle diagram.",
      );
      expect(root.querySelector("svg")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("layers link hits below paths and avoids duplicate node renders", async () => {
    const b = bundle(
      [app("a"), app("b", { origin: "referral" })],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
        ev("o2", "b", "referral", "2026-01-01"),
        ev("t2", "b", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = render(b);
    const svg = root.querySelector("svg");
    const childGroups = [...svg.children].filter(
      (child) => child.tagName === "g",
    );
    const firstLinkHitGroupIndex = childGroups.findIndex((group) =>
      group.querySelector("[data-diagram-link-hit]"),
    );
    const visibleLinkGroupIndex = childGroups.findIndex((group) =>
      group.querySelector("[data-diagram-link]"),
    );
    expect(firstLinkHitGroupIndex).toBeGreaterThanOrEqual(0);
    expect(visibleLinkGroupIndex).toBeLessThan(firstLinkHitGroupIndex);

    const details = root.querySelector("[data-diagram-details]");
    const callback = vi.fn();
    const realObserver = new window.MutationObserver(callback);
    realObserver.observe(details, { childList: true, subtree: true });
    root
      .querySelector("[data-diagram-node-hit='origin:application_submitted']")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
    realObserver.disconnect();
  });

  it("selects visible SVG node labels exactly once", async () => {
    const b = bundle(
      [app("a")],
      [ev("o", "a", "application_submitted", "2026-01-01")],
    );
    const { root } = render(b);
    const details = root.querySelector("[data-diagram-details]");
    const callback = vi.fn();
    const observer = new window.MutationObserver(callback);
    observer.observe(details, { childList: true, subtree: true });
    root
      .querySelector("[data-diagram-node='origin:application_submitted'] text")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(details.textContent).toContain("Application submitted: 1");
    expect(
      root
        .querySelector("button[aria-label='Select Application submitted']")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(callback).toHaveBeenCalledTimes(1);
    observer.disconnect();
  });

  it("keeps fixture endpoint totals literal including Unknown", async () => {
    const fixture = await import(
      "./fixtures/tracker-lifecycle-diagram-v2.json",
      {
        with: { type: "json" },
      }
    );
    const projection = projectLifecycleAt(fixture.default);
    expect(projection.totals.endpoints).toEqual(
      EXPECTED_FIXTURE_TAXONOMY_TOTALS.endpoints,
    );
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
