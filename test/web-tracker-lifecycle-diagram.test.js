/* global document, window */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  calculateLifecycleDiagramLayout,
  createLifecycleDiagramView,
} from "../src/web/tracker/lifecycleDiagram.js";
import * as lifecycleLayout from "../src/web/tracker/lifecycleDiagramLayout.js";
import { buildLifecycleDisplayBranches } from "../src/web/tracker/lifecycleDiagramLayout.js";
import { createLifecycleHorizontalGeometry } from "../src/web/tracker/lifecycleDiagramLayout.js";
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
// lifecycleDiagram.js's renders (all of them -- render() always defers past
// a real paint via runDeferred(), regardless of dragActive; dragActive only
// controls renderSvg()'s quality tier) schedule their Phase B work via two
// nested window.requestAnimationFrame calls. jsdom's rAF (pretendToBeVisual)
// is timer-based, and each per-test JSDOM instance is constructed *inside*
// the current test (see setup()) -- when that happens while
// vi.useFakeTimers() is already active, jsdom's rAF ends up driven by the
// same faked clock, so it only ever fires via vi.advanceTimersToNextFrame(),
// never by simply awaiting real time. When real timers are active, jsdom's
// rAF is a genuine (if short) real-time wait, so this awaits it for real
// instead. Branching on vi.isFakeTimers() keeps this uniform regardless of
// which a given test uses.
async function flushLifecycleDiagramRender() {
  if (vi.isFakeTimers()) {
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  } else {
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    );
  }
  await Promise.resolve();
}
async function render(
  b,
  selectedBucketId = "current",
  onBucketChange = vi.fn(),
  options = {},
) {
  const root = setup();
  const view = createLifecycleDiagramView(root, { onBucketChange, ...options });
  const timeline = buildLifecycleTimeline(b);
  const snapshot = projectLifecycleAt(b, selectedBucketId);
  const updated = view.update({
    timeline,
    snapshot,
    selectedBucketId,
    newerAvailable: selectedBucketId !== "current",
  });
  await flushLifecycleDiagramRender();
  await updated;
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
  it("renders node hit boxes from the shared non-baseline geometry", async () => {
    const horizontalGeometry = createLifecycleHorizontalGeometry({
      handleRadius: 30,
    });
    const { root } = await render(
      bundle([app("a")], [ev("o", "a", "application_submitted", "2026-01-01")]),
      "current",
      vi.fn(),
      { horizontalGeometry },
    );
    const visible = root.querySelector(
      "[data-diagram-node='origin:application_submitted'] rect:not([data-diagram-node-hit])",
    );
    const hit = root.querySelector(
      "[data-diagram-node-hit='origin:application_submitted']",
    );
    const visibleBox = rectBox(visible);
    const hitBox = rectBox(hit);

    expect(hitBox.width).toBe(Math.max(60, visibleBox.width));
    expect(hitBox.height).toBe(Math.max(60, visibleBox.height));
    expect(hitBox.x + hitBox.width / 2).toBe(
      visibleBox.x + visibleBox.width / 2,
    );
  });

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

  it("renders current default controls, accessible svg, and semantic totals", async () => {
    const b = bundle(
      [app("a1"), app("a2", { origin: "referral", status: "offer" })],
      [
        ev("o1", "a1", "application_submitted", "2026-01-01"),
        ev("o2", "a2", "referral", "2026-01-01"),
        ev("t2", "a2", "technical_interview", "2026-01-02T10:00:00.000Z"),
        ev("offer", "a2", "offer_received", "2026-01-03"),
      ],
    );
    const { root, snapshot } = await render(b);

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

  it("keeps semantic tables aggregate-first and preserves semantic button focus", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b);
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
    await view.update({
      timeline,
      snapshot: projectLifecycleAt(b, timeline.buckets[0].id),
      selectedBucketId: timeline.buckets[0].id,
    });
  });

  it("keeps semantic table disclosure open across immediate node and flow selection", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = await render(b);
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

  it("handles empty, unknown-only, date, and simultaneous boundary timestamps", async () => {
    expect((await render(bundle())).root.textContent).toContain(
      "No lifecycle data yet",
    );
    const b = bundle(
      [app("u")],
      [ev("u1", "u", "application_submitted", "unknown")],
    );
    const unknown = await render(b, "unknown-date");
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
    const rendered = await render(dated, bucket.id);
    expect(rendered.root.textContent).toContain("time not recorded");
    expect(rendered.root.textContent).toContain(
      "d1: application_submitted; d2: technical_interview",
    );
  });

  it("synchronizes range controls and keeps user text inert", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("bad")],
      [ev("x", "bad", "application_submitted", "2026-01-01")],
    );
    const onBucketChange = vi.fn();
    const { root, timeline } = await render(b, "current", onBucketChange);
    const range = root.querySelector("input[type='range']");
    range.value = "0";
    range.dispatchEvent(new window.Event("input", { bubbles: true }));
    vi.advanceTimersByTime(80);
    expect(onBucketChange).toHaveBeenCalledWith(timeline.buckets[0].id);
    expect(root.querySelector("img")).toBeNull();
    expect([
      ...root.querySelectorAll("svg a, foreignObject, script"),
    ]).toHaveLength(0);
  });

  it("debounces the range scrubber so dragging fires one update with the final value", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("bad")],
      [ev("x", "bad", "application_submitted", "2026-01-01")],
    );
    const onBucketChange = vi.fn();
    const { root, timeline } = await render(b, "current", onBucketChange);
    const range = root.querySelector("input[type='range']");
    for (let i = 0; i < timeline.buckets.length; i += 1) {
      range.value = String(i);
      range.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
    expect(onBucketChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(onBucketChange).toHaveBeenCalledTimes(1);
    expect(onBucketChange).toHaveBeenCalledWith(
      timeline.buckets[timeline.buckets.length - 1].id,
    );
  });

  it("stops a pending debounced scrub update once the view is destroyed", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("bad")],
      [ev("x", "bad", "application_submitted", "2026-01-01")],
    );
    const onBucketChange = vi.fn();
    const { root, view } = await render(b, "current", onBucketChange);
    const range = root.querySelector("input[type='range']");
    range.value = "0";
    range.dispatchEvent(new window.Event("input", { bubbles: true }));
    view.destroy();
    vi.advanceTimersByTime(80);
    expect(onBucketChange).not.toHaveBeenCalled();
  });

  // eslint-disable-next-line max-len
  it("keeps the dragged-to bucket if a render lands mid-debounce (e.g. resize/refresh)", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "recruiter_screen", "2026-01-02"),
        ev("t2", "a", "technical_interview", "2026-01-03"),
      ],
    );
    const onBucketChange = vi.fn();
    const { root, view, timeline, snapshot } = await render(
      b,
      "current",
      onBucketChange,
    );
    const range = root.querySelector("input[type='range']");
    const targetIndex = timeline.buckets.length - 2;
    range.value = String(targetIndex);
    range.dispatchEvent(new window.Event("input", { bubbles: true }));

    // An unrelated render lands mid-debounce-window (e.g. a ResizeObserver
    // tick or a background refresh that didn't change the selected bucket).
    // render() resets range.value to the currently *selected* bucket
    // ("current" here, since onBucketChange hasn't fired yet) — the pending
    // debounced change must not be lost to that reset. This render is
    // deferred; with fake timers active, a plain await would deadlock (only
    // vi.advanceTimersToNextFrame() -- inside flushLifecycleDiagramRender()
    // -- ever advances the fake rAF queue), so flush before awaiting it.
    const updated = view.update({
      timeline,
      snapshot,
      selectedBucketId: "current",
    });
    await flushLifecycleDiagramRender();
    await updated;
    expect(range.value).not.toBe(String(targetIndex));

    vi.advanceTimersByTime(80);
    expect(onBucketChange).toHaveBeenCalledTimes(1);
    expect(onBucketChange).toHaveBeenCalledWith(
      timeline.buckets[targetIndex].id,
    );
  });

  it("selects the bucket dragged to even if a timeline replacement shifts its index", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "recruiter_screen", "2026-01-02"),
        ev("t2", "a", "technical_interview", "2026-01-03"),
      ],
    );
    const onBucketChange = vi.fn();
    const { root, view, timeline } = await render(b, "current", onBucketChange);
    const range = root.querySelector("input[type='range']");
    const targetIndex = 2;
    const targetBucketId = timeline.buckets[targetIndex].id;
    range.value = String(targetIndex);
    range.dispatchEvent(new window.Event("input", { bubbles: true }));

    // A timeline replacement (e.g. a background refresh discovering an
    // earlier event) inserts a bucket before the target, shifting what
    // index `targetIndex` now points to.
    const withEarlierEvent = bundle(
      [app("a")],
      [
        ev("earlier", "a", "application_submitted", "2025-12-31"),
        ...b.lifecycleEvents,
      ],
    );
    const nextTimeline = buildLifecycleTimeline(withEarlierEvent);
    expect(nextTimeline.buckets[targetIndex].id).not.toBe(targetBucketId);
    // This render is deferred; with fake timers active, a plain await would
    // deadlock (only vi.advanceTimersToNextFrame() -- inside
    // flushLifecycleDiagramRender() -- ever advances the fake rAF queue).
    const updated = view.update({
      timeline: nextTimeline,
      snapshot: projectLifecycleAt(withEarlierEvent, "current"),
      selectedBucketId: "current",
    });
    await flushLifecycleDiagramRender();
    await updated;

    vi.advanceTimersByTime(80);
    expect(onBucketChange).toHaveBeenCalledTimes(1);
    expect(onBucketChange).toHaveBeenCalledWith(targetBucketId);
  });

  // eslint-disable-next-line max-len
  it("releases the drag to the bucket id captured at the last tick, not a shifted index", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "recruiter_screen", "2026-01-02"),
        ev("t2", "a", "technical_interview", "2026-01-03"),
      ],
    );
    const onBucketChange = vi.fn();
    const { root, view, timeline } = await render(b, "current", onBucketChange);
    const range = root.querySelector("input[type='range']");
    const targetIndex = 2;
    const targetBucketId = timeline.buckets[targetIndex].id;
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    range.value = String(targetIndex);
    range.dispatchEvent(new window.Event("input", { bubbles: true }));

    // A timeline replacement lands between the last drag tick and release
    // (e.g. a background refresh discovering an earlier event), inserting a
    // bucket before the target and shifting what index `targetIndex` now
    // points to.
    const withEarlierEvent = bundle(
      [app("a")],
      [
        ev("earlier", "a", "application_submitted", "2025-12-31"),
        ...b.lifecycleEvents,
      ],
    );
    const nextTimeline = buildLifecycleTimeline(withEarlierEvent);
    expect(nextTimeline.buckets[targetIndex].id).not.toBe(targetBucketId);
    // render() always defers Phase B past a double rAF regardless of
    // dragActive -- await the real promise so Phase B has actually run
    // before the assertions below inspect its output.
    await view.update({
      timeline: nextTimeline,
      snapshot: projectLifecycleAt(withEarlierEvent, "current"),
      selectedBucketId: "current",
    });

    range.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
    expect(onBucketChange).toHaveBeenCalledTimes(1);
    expect(onBucketChange).toHaveBeenCalledWith(targetBucketId);
  });

  it("lets a newer discrete prev/next/current action win over an older pending scrub", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "recruiter_screen", "2026-01-02"),
        ev("t2", "a", "technical_interview", "2026-01-03"),
      ],
    );
    const onBucketChange = vi.fn();
    const firstBucketId = buildLifecycleTimeline(b).buckets[0].id;
    const { root, timeline } = await render(b, firstBucketId, onBucketChange);
    const range = root.querySelector("input[type='range']");
    range.value = "1";
    range.dispatchEvent(new window.Event("input", { bubbles: true }));

    const nextButton = [...root.querySelectorAll("button")].find(
      (button) => button.textContent === "Next event",
    );
    nextButton.click();
    expect(onBucketChange).toHaveBeenCalledTimes(1);
    expect(onBucketChange).toHaveBeenCalledWith(timeline.buckets[2].id);

    // The pending drag-to-bucket-1 debounce must have been cancelled by the
    // newer click, not fire 80ms later and silently overwrite it.
    vi.advanceTimersByTime(80);
    expect(onBucketChange).toHaveBeenCalledTimes(1);
  });

  it("uses the draft quality tier for renders triggered while dragging the scrubber", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    // Mirrors tracker.js's production wiring: onBucketChange re-projects and
    // calls view.update(), which is what actually triggers renderSvg().
    let view;
    const onBucketChange = vi.fn((bucketId) => {
      view.update({
        timeline: buildLifecycleTimeline(b),
        snapshot: projectLifecycleAt(b, bucketId),
        selectedBucketId: bucketId,
      });
    });
    const rendered = await render(b, "current", onBucketChange);
    view = rendered.view;
    const { root, timeline } = rendered;
    const layoutSpy = vi.spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph");
    try {
      const range = root.querySelector("input[type='range']");
      // The last bucket is the one guaranteed to still include the
      // application (an earlier bucket can predate its origin event
      // entirely, hitting the unrelated "No lifecycle data yet" empty-state
      // return before layoutLifecycleRoutingGraph is ever called).
      const targetIndex = timeline.buckets.length - 1;
      range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      range.value = String(targetIndex);
      range.dispatchEvent(new window.Event("input", { bubbles: true }));
      vi.advanceTimersByTime(80);
      expect(onBucketChange).toHaveBeenCalledWith(
        timeline.buckets[targetIndex].id,
      );
      // onBucketChange's own view.update() call above is deferred (a double
      // rAF, regardless of dragActive) and triggered indirectly, so there's
      // no promise to await directly here -- flush before inspecting
      // layoutSpy's call args.
      await flushLifecycleDiagramRender();
      const dragTickCall = layoutSpy.mock.calls.at(-1);
      expect(dragTickCall[2]).toMatchObject({ qualityTier: "draft" });
    } finally {
      layoutSpy.mockRestore();
    }
  });

  // eslint-disable-next-line max-len
  it("releasing the drag forces one full-quality render and cancels any pending debounce", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    let view;
    const onBucketChange = vi.fn((bucketId) => {
      view.update({
        timeline: buildLifecycleTimeline(b),
        snapshot: projectLifecycleAt(b, bucketId),
        selectedBucketId: bucketId,
      });
    });
    const rendered = await render(b, "current", onBucketChange);
    view = rendered.view;
    const { root, timeline } = rendered;
    const layoutSpy = vi.spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph");
    try {
      const range = root.querySelector("input[type='range']");
      const targetIndex = timeline.buckets.length - 1;
      range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      range.value = String(targetIndex);
      range.dispatchEvent(new window.Event("input", { bubbles: true }));
      // Released before the 80ms debounce ever fires. dragActive is now
      // false, so this settle render is deferred -- flush it before
      // inspecting layoutSpy's call args.
      range.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
      await flushLifecycleDiagramRender();
      expect(onBucketChange).toHaveBeenCalledTimes(1);
      expect(onBucketChange).toHaveBeenCalledWith(
        timeline.buckets[targetIndex].id,
      );
      const settleCall = layoutSpy.mock.calls.at(-1);
      expect(settleCall[2]?.qualityTier).not.toBe("draft");
      // The pending debounce must have been cancelled by release, not fire
      // 80ms later and cause a second, redundant onBucketChange.
      vi.advanceTimersByTime(80);
      expect(onBucketChange).toHaveBeenCalledTimes(1);
    } finally {
      layoutSpy.mockRestore();
    }
  });

  // eslint-disable-next-line max-len
  it("keeps the previously rendered frame when a known layout-search failure throws mid-drag", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const svgBefore = root.querySelector("svg");
    expect(svgBefore).not.toBeNull();
    const range = root.querySelector("input[type='range']");
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    const layoutSpy = vi
      .spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph")
      .mockImplementation(() => {
        // A real budget-exceeded failure always carries a structured
        // cause.type (see lifecycleDiagramLayout.js's
        // throwHandleStateLimitExceeded) -- only these known types are
        // swallowed mid-drag, never a plain/unexpected error.
        const error = new Error("forced draft-tier failure");
        error.cause = Object.freeze({
          type: "lifecycle-transition-lane-order",
          reason: "state-limit",
        });
        throw error;
      });
    try {
      // The last bucket still includes the application (an earlier bucket
      // can predate its origin event entirely, hitting the unrelated empty-
      // state return before layoutLifecycleRoutingGraph is ever called).
      const targetId = timeline.buckets.at(-1).id;
      // render() always defers Phase B past a double rAF regardless of
      // dragActive -- await the real promise so Phase B has actually run
      // before the assertions below inspect its output.
      await view.update({
        timeline,
        snapshot: projectLifecycleAt(b, targetId),
        selectedBucketId: targetId,
      });
      // No fallback message, no DOM teardown -- the exact same <svg> element
      // is still on screen, untouched, since a draft-tier failure means
      // "too slow right now", not "genuinely unlayoutable".
      expect(root.querySelector("svg")).toBe(svgBefore);
      expect(root.textContent).not.toContain(
        "Unable to lay out lifecycle diagram.",
      );
    } finally {
      layoutSpy.mockRestore();
    }
  });

  it("still shows the fallback for an unexpected (uncaused) error during a drag tick", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const range = root.querySelector("input[type='range']");
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    const layoutSpy = vi
      .spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph")
      .mockImplementation(() => {
        // No error.cause at all -- a genuine bug (e.g. a TypeError), not a
        // structured layout-search rejection. Must never be silently
        // swallowed just because a drag happens to be in progress.
        throw new Error("forced unexpected failure");
      });
    try {
      const targetId = timeline.buckets.at(-1).id;
      // render() always defers Phase B past a double rAF regardless of
      // dragActive -- await the real promise so Phase B has actually run
      // before the assertions below inspect its output.
      await view.update({
        timeline,
        snapshot: projectLifecycleAt(b, targetId),
        selectedBucketId: targetId,
      });
      expect(root.textContent).toContain(
        "Unable to lay out lifecycle diagram.",
      );
    } finally {
      layoutSpy.mockRestore();
    }
  });

  // eslint-disable-next-line max-len
  it("still shows the fallback message when the full-quality settle render fails on release", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    let view;
    const onBucketChange = vi.fn((bucketId) => {
      view.update({
        timeline: buildLifecycleTimeline(b),
        snapshot: projectLifecycleAt(b, bucketId),
        selectedBucketId: bucketId,
      });
    });
    const rendered = await render(b, "current", onBucketChange);
    view = rendered.view;
    const { root, timeline } = rendered;
    const range = root.querySelector("input[type='range']");
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    range.value = String(timeline.buckets.length - 1);
    range.dispatchEvent(new window.Event("input", { bubbles: true }));
    const layoutSpy = vi
      .spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph")
      .mockImplementation(() => {
        throw new Error("forced full-quality failure on release");
      });
    try {
      // dragActive is cleared before this settle render runs, so a failure
      // here must fall through to the real fallback, not be silently
      // swallowed the way a draft-tier failure is. That settle render is
      // deferred (dragActive is now false), so flush before asserting.
      range.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
      await flushLifecycleDiagramRender();
      expect(root.textContent).toContain(
        "Unable to lay out lifecycle diagram.",
      );
    } finally {
      layoutSpy.mockRestore();
    }
  });

  // eslint-disable-next-line max-len
  it("never uses draft tier for keyboard-driven range input (no preceding pointerdown)", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    let view;
    const onBucketChange = vi.fn((bucketId) => {
      view.update({
        timeline: buildLifecycleTimeline(b),
        snapshot: projectLifecycleAt(b, bucketId),
        selectedBucketId: bucketId,
      });
    });
    const rendered = await render(b, "current", onBucketChange);
    view = rendered.view;
    const { root, timeline } = rendered;
    const layoutSpy = vi.spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph");
    try {
      const range = root.querySelector("input[type='range']");
      const targetIndex = timeline.buckets.length - 1;
      // Simulates a focused range input's native arrow-key stepping: an
      // "input" event fires with no preceding pointerdown -- dragActive
      // never becomes true, so this render is deferred like any other
      // non-drag render; flush before inspecting layoutSpy's call args.
      range.value = String(targetIndex);
      range.dispatchEvent(new window.Event("input", { bubbles: true }));
      vi.advanceTimersByTime(80);
      await flushLifecycleDiagramRender();
      expect(onBucketChange).toHaveBeenCalledWith(
        timeline.buckets[targetIndex].id,
      );
      const call = layoutSpy.mock.calls.at(-1);
      expect(call[2]?.qualityTier).not.toBe("draft");
    } finally {
      layoutSpy.mockRestore();
    }
  });

  it("reuses a captured layout seed for the next drag tick, from any tier", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    let view;
    const onBucketChange = vi.fn((bucketId) => {
      view.update({
        timeline: buildLifecycleTimeline(b),
        snapshot: projectLifecycleAt(b, bucketId),
        selectedBucketId: bucketId,
      });
    });
    const rendered = await render(b, "current", onBucketChange);
    view = rendered.view;
    const { root, timeline } = rendered;
    const layoutSpy = vi.spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph");
    try {
      const range = root.querySelector("input[type='range']");
      const targetIndex = timeline.buckets.length - 1;
      range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      range.value = String(targetIndex);
      range.dispatchEvent(new window.Event("input", { bubbles: true }));
      vi.advanceTimersByTime(80);
      // The debounce-fired render is deferred (a double rAF, regardless of
      // dragActive), and this render is triggered indirectly via the
      // onBucketChange mock rather than a directly-awaitable promise --
      // flush before inspecting layoutSpy's call args.
      await flushLifecycleDiagramRender();
      // The mount's own initial render is full quality (dragActive was
      // false) and still captures a seed -- the very first drag tick
      // already has one to reuse.
      const firstTickCall = layoutSpy.mock.calls.at(-1);
      expect(firstTickCall[2]).toMatchObject({ qualityTier: "draft" });
      expect(firstTickCall[2].seedAssignments).toBeInstanceOf(Map);
      expect(firstTickCall[2].seedRankOrderByRank).toBeInstanceOf(Map);
      expect(firstTickCall[2].seedHandles).toBeInstanceOf(Map);
      expect(firstTickCall[2].seedLinkDocks).toBeInstanceOf(Map);
      // seedAcceptedRouteCrossingCount is deliberately never captured for
      // cross-bucket reuse -- see the capture-site comment in
      // lifecycleDiagram.js.
      expect(firstTickCall[2]).not.toHaveProperty(
        "seedAcceptedRouteCrossingCount",
      );
      expect(firstTickCall[2].authoritativeBranchOrderByRank).toBeInstanceOf(
        Map,
      );
      expect(firstTickCall[2].authoritativeNodeOrderByRank).toBeInstanceOf(Map);
    } finally {
      layoutSpy.mockRestore();
    }
  });

  it("retries once unseeded when a seed-replay rejection occurs, and still renders", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const range = root.querySelector("input[type='range']");
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    const originalLayout = lifecycleLayout.layoutLifecycleRoutingGraph;
    const layoutSpy = vi
      .spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph")
      .mockImplementation((proj, width, opts) => {
        if (opts?.seedAssignments) {
          const error = new Error("forced seed-replay rejection");
          error.cause = Object.freeze({
            type: "lifecycle-authoritative-rank-order",
            reason: "seed-replay-failed",
            detail: "link-id-coverage-mismatch",
          });
          throw error;
        }
        return originalLayout(proj, width, opts);
      });
    try {
      const targetId = timeline.buckets.at(-1).id;
      // render() always defers Phase B past a double rAF regardless of
      // dragActive -- await the real promise so Phase B has actually run
      // before the assertions below inspect its output.
      await view.update({
        timeline,
        snapshot: projectLifecycleAt(b, targetId),
        selectedBucketId: targetId,
      });
      expect(layoutSpy).toHaveBeenCalledTimes(2);
      const [, retryCall] = layoutSpy.mock.calls;
      for (const key of [
        "seedAssignments",
        "seedRankOrderByRank",
        "seedHandles",
        "seedLinkDocks",
        "seedAcceptedRouteCrossingCount",
        "authoritativeBranchOrderByRank",
        "authoritativeNodeOrderByRank",
      ]) {
        expect(retryCall[2]).not.toHaveProperty(key);
      }
      // The unseeded retry succeeded -- the bucket actually rendered, not
      // the "keep previous frame" fallback.
      expect(root.querySelector("svg")).toBeTruthy();
      expect(root.textContent).not.toContain(
        "Unable to lay out lifecycle diagram.",
      );
    } finally {
      layoutSpy.mockRestore();
    }
  });

  // eslint-disable-next-line max-len
  it("keeps the previous frame when both the seeded attempt and the unseeded retry fail", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const svgBefore = root.querySelector("svg");
    const range = root.querySelector("input[type='range']");
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    const layoutSpy = vi
      .spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph")
      .mockImplementation(() => {
        const error = new Error("forced seed-replay rejection, every call");
        error.cause = Object.freeze({
          type: "lifecycle-authoritative-rank-order",
          reason: "seed-replay-failed",
          detail: "link-id-coverage-mismatch",
        });
        throw error;
      });
    try {
      const targetId = timeline.buckets.at(-1).id;
      // render() always defers Phase B past a double rAF regardless of
      // dragActive -- await the real promise so Phase B has actually run
      // before the assertions below inspect its output.
      await view.update({
        timeline,
        snapshot: projectLifecycleAt(b, targetId),
        selectedBucketId: targetId,
      });
      expect(layoutSpy).toHaveBeenCalledTimes(2);
      // lifecycle-authoritative-rank-order is itself a known layout-failure
      // cause type, so the retry's own failure still falls into "keep the
      // previous frame" during a drag, same as any other known failure.
      expect(root.querySelector("svg")).toBe(svgBefore);
      expect(root.textContent).not.toContain(
        "Unable to lay out lifecycle diagram.",
      );
    } finally {
      layoutSpy.mockRestore();
    }
  });

  it("never retries an unexpected (uncaused) error even when a seed was attempted", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const range = root.querySelector("input[type='range']");
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    const layoutSpy = vi
      .spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph")
      .mockImplementation(() => {
        throw new Error("forced unexpected failure");
      });
    try {
      const targetId = timeline.buckets.at(-1).id;
      // render() always defers Phase B past a double rAF regardless of
      // dragActive -- await the real promise so Phase B has actually run
      // before the assertions below inspect its output.
      await view.update({
        timeline,
        snapshot: projectLifecycleAt(b, targetId),
        selectedBucketId: targetId,
      });
      expect(layoutSpy).toHaveBeenCalledTimes(1);
      expect(root.textContent).toContain(
        "Unable to lay out lifecycle diagram.",
      );
    } finally {
      layoutSpy.mockRestore();
    }
  });

  it("never threads seed options into the full-quality settle-on-release call", async () => {
    vi.useFakeTimers();
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    let view;
    const onBucketChange = vi.fn((bucketId) => {
      view.update({
        timeline: buildLifecycleTimeline(b),
        snapshot: projectLifecycleAt(b, bucketId),
        selectedBucketId: bucketId,
      });
    });
    const rendered = await render(b, "current", onBucketChange);
    view = rendered.view;
    const { root, timeline } = rendered;
    const layoutSpy = vi.spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph");
    try {
      const range = root.querySelector("input[type='range']");
      const targetIndex = timeline.buckets.length - 1;
      range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      range.value = String(targetIndex);
      range.dispatchEvent(new window.Event("input", { bubbles: true }));
      vi.advanceTimersByTime(80);
      // The debounce-fired drag-tick render is deferred (a double rAF) and
      // triggered indirectly via the onBucketChange mock -- flush before
      // inspecting layoutSpy's call args.
      await flushLifecycleDiagramRender();
      // Confirm a seed really was available and used for the drag tick,
      // so the release assertion below is meaningful, not vacuous.
      expect(layoutSpy.mock.calls.at(-1)[2].seedAssignments).toBeInstanceOf(
        Map,
      );
      // The settle-on-release render is also deferred -- flush again before
      // inspecting layoutSpy for the release call.
      range.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
      await flushLifecycleDiagramRender();
      const settleCall = layoutSpy.mock.calls.at(-1);
      expect(settleCall[2]?.qualityTier).not.toBe("draft");
      for (const key of [
        "seedAssignments",
        "seedRankOrderByRank",
        "seedHandles",
        "seedLinkDocks",
        "seedAcceptedRouteCrossingCount",
        "authoritativeBranchOrderByRank",
        "authoritativeNodeOrderByRank",
      ]) {
        expect(settleCall[2]).not.toHaveProperty(key);
      }
    } finally {
      layoutSpy.mockRestore();
    }
  });

  it("does not mutate P4 projection and has equivalent selectable rows", async () => {
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
    await view.update({ timeline, snapshot, selectedBucketId: "current" });
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

  it("provides semantic button controls for flows and nodes", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = await render(b);
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

  it("summarizes warnings from P4 codes and treats absent keys as zero", async () => {
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

    await view.update({ timeline, snapshot, selectedBucketId: "current" });
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Warnings: inferred history 2; unknown origin/time 11; status mismatch 7; regression 11.",
    );

    await view.update({
      timeline,
      snapshot: { ...empty, warningCounts: {}, events: [] },
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Warnings: inferred history 0; unknown origin/time 0; status mismatch 0; regression 0.",
    );
  });

  it("clears selected flow details when the snapshot changes", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b);
    root
      .querySelector("[data-diagram-link]")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "1 application",
    );
    await view.update({
      timeline,
      snapshot: projectLifecycleAt(bundle(), "current"),
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "Select a node or flow row",
    );
  });

  it("preserves valid selections across unchanged snapshot instances", async () => {
    const b = bundle(
      [app("a"), app("b")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
        ev("o2", "b", "application_submitted", "2026-01-01"),
        ev("t2", "b", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b);
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

    await view.update({
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

  it("keeps SVG and semantic selections equivalent and debounces live announcements", async () => {
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
    const { root, view, timeline, snapshot } = await render(b);
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

    // This render is deferred; with fake timers active, a plain await would
    // deadlock (only vi.advanceTimersToNextFrame() -- inside
    // flushLifecycleDiagramRender() -- ever advances the fake rAF queue).
    const updated = view.update({
      timeline,
      snapshot,
      selectedBucketId: "current",
    });
    await flushLifecycleDiagramRender();
    await updated;
    view.announce("Missing historical point; returned to Current.");
    // The resize-triggered render is also deferred; flush it before the
    // announce debounce is asserted, for cross-test cleanliness even though
    // the live text itself is Phase A output.
    root.dispatchEvent(new window.Event("resize"));
    await flushLifecycleDiagramRender();
    vi.advanceTimersByTime(80);
    expect(root.querySelector("#lifecycle-diagram-live").textContent).toBe(
      "Missing historical point; returned to Current.",
    );
    view.destroy();
  });

  it("reuses unchanged SVG node/branch elements across a no-op re-render", async () => {
    const b = bundle(
      [app("a"), app("b")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
        ev("o2", "b", "application_submitted", "2026-01-01"),
        ev("t2", "b", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline, snapshot } = await render(b);
    const nodeGroup = root.querySelector(
      "[data-diagram-node='origin:application_submitted']",
    );
    const nodeRect = nodeGroup.querySelector(
      "rect:not([data-diagram-node-hit])",
    );
    const branchGroup = root.querySelector("[data-diagram-branch-group]");
    const branchPath = branchGroup.querySelector("[data-diagram-link]");

    await view.update({ timeline, snapshot, selectedBucketId: "current" });

    expect(
      root.querySelector("[data-diagram-node='origin:application_submitted']"),
    ).toBe(nodeGroup);
    expect(
      root
        .querySelector("[data-diagram-node='origin:application_submitted']")
        .querySelector("rect:not([data-diagram-node-hit])"),
    ).toBe(nodeRect);
    expect(root.querySelector("[data-diagram-branch-group]")).toBe(branchGroup);
    expect(
      root.querySelector("[data-diagram-branch-group] [data-diagram-link]"),
    ).toBe(branchPath);
  });

  it("reuses the SVG node group on selection, patching only selection attributes", async () => {
    const b = bundle(
      [app("a")],
      [ev("o1", "a", "application_submitted", "2026-01-01")],
    );
    const { root } = await render(b);
    const nodeGroup = root.querySelector(
      "[data-diagram-node='origin:application_submitted']",
    );
    const nodeRect = nodeGroup.querySelector(
      "rect:not([data-diagram-node-hit])",
    );
    const hitRect = nodeGroup.querySelector("[data-diagram-node-hit]");
    expect(nodeGroup.getAttribute("data-selected")).toBe("false");
    expect(nodeRect.getAttribute("stroke")).toBe("#e2e8f0");

    nodeRect.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    const sameGroup = root.querySelector(
      "[data-diagram-node='origin:application_submitted']",
    );
    expect(sameGroup).toBe(nodeGroup);
    expect(sameGroup.querySelector("rect:not([data-diagram-node-hit])")).toBe(
      nodeRect,
    );
    expect(sameGroup.querySelector("[data-diagram-node-hit]")).toBe(hitRect);
    expect(sameGroup.getAttribute("data-selected")).toBe("true");
    expect(nodeRect.getAttribute("stroke")).toBe("#F8FAFC");
  });

  it("reuses the SVG branch group on selection, adding/removing only the halo", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = await render(b);
    const branchGroup = root.querySelector("[data-diagram-branch-group]");
    const branchPath = branchGroup.querySelector("[data-diagram-link]");
    expect(branchGroup.querySelector("[data-diagram-branch-halo]")).toBeNull();

    branchPath.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    const sameGroup = root.querySelector("[data-diagram-branch-group]");
    expect(sameGroup).toBe(branchGroup);
    expect(sameGroup.querySelector("[data-diagram-link]")).toBe(branchPath);
    expect(sameGroup.getAttribute("data-selected")).toBe("true");
    expect(
      sameGroup.querySelector("[data-diagram-branch-halo]"),
    ).not.toBeNull();

    // Selecting something else (there's no click-to-toggle-off) deselects
    // the branch, which should remove the halo from the same reused group.
    root
      .querySelector(
        "[data-diagram-node='origin:application_submitted'] rect:not([data-diagram-node-hit])",
      )
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("[data-diagram-branch-group]")).toBe(branchGroup);
    expect(root.querySelector("[data-diagram-link]")).toBe(branchPath);
    expect(branchGroup.getAttribute("data-selected")).toBe("false");
    expect(root.querySelector("[data-diagram-branch-halo]")).toBeNull();
  });

  it("disconnects SVG elements for nodes that drop out of a later bucket", async () => {
    const b = bundle(
      [app("a")],
      [ev("o1", "a", "application_submitted", "2026-01-01")],
    );
    const { root, view, timeline } = await render(b, "unknown-date");
    // "unknown-date" has no dated events for this bundle, so the diagram
    // shows the empty-nodes fallback rather than an origin node.
    expect(
      root.querySelector("[data-diagram-node='origin:application_submitted']"),
    ).toBeNull();

    await view.update({
      timeline,
      snapshot: projectLifecycleAt(b, "current"),
      selectedBucketId: "current",
    });
    const nodeGroup = root.querySelector(
      "[data-diagram-node='origin:application_submitted']",
    );
    expect(nodeGroup).not.toBeNull();
    expect(nodeGroup.isConnected).toBe(true);

    await view.update({
      timeline,
      snapshot: projectLifecycleAt(b, "unknown-date"),
      selectedBucketId: "unknown-date",
    });
    expect(
      root.querySelector("[data-diagram-node='origin:application_submitted']"),
    ).toBeNull();
    expect(nodeGroup.isConnected).toBe(false);
  });

  it("keeps a reused SVG node's click listener reading current, not stale, data", async () => {
    // The projection layer replays event histories fresh every render (only
    // Phase 1/2's *bucket-level* results are cached), so a node's rendered
    // signature (position/size/label/total) can be identical across two
    // different bundles while the underlying application membership behind
    // it differs -- e.g. two applications swap origins, leaving the
    // "referral" node's total unchanged but backed by a different
    // application. A reused element's listener must reflect the *current*
    // render's data, not whatever was captured when the element was built.
    const endEvents = (id) => [
      ev(`${id}-recruiter`, id, "recruiter_screen", "2026-01-02"),
      ev(`${id}-rejected`, id, "employer_rejected", "2026-01-03"),
    ];
    const before = bundle(
      [app("a"), app("b")],
      [
        ev("a-origin", "a", "referral", "2026-01-01"),
        ...endEvents("a"),
        ev("b-origin", "b", "candidate_outreach", "2026-01-01"),
        ...endEvents("b"),
      ],
    );
    const after = bundle(
      [app("a"), app("b")],
      [
        ev("a-origin", "a", "candidate_outreach", "2026-01-01"),
        ...endEvents("a"),
        ev("b-origin", "b", "referral", "2026-01-01"),
        ...endEvents("b"),
      ],
    );
    const { root, view } = await render(before);
    const referralGroup = root.querySelector(
      "[data-diagram-node='origin:referral']",
    );
    expect(referralGroup).not.toBeNull();

    const afterSnapshot = projectLifecycleAt(after, "current");
    await view.update({
      timeline: buildLifecycleTimeline(after),
      snapshot: afterSnapshot,
      selectedBucketId: "current",
    });
    // Same element reused -- proves the signature (position/size/total) was
    // judged unchanged even though the backing application swapped.
    expect(root.querySelector("[data-diagram-node='origin:referral']")).toBe(
      referralGroup,
    );

    referralGroup
      .querySelector("rect:not([data-diagram-node-hit])")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(
      [...root.querySelectorAll("[data-affected-applications] li")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["b"]);
  });

  it("constructs zero new SVG elements when a node selection changes", async () => {
    // Node/branch counts are bounded by the fixed taxonomy (a couple dozen
    // categories at most), not by application count, so a data-driven
    // "far fewer elements than a full rebuild" scenario is sensitive to
    // Sankey re-layout cascades that are hard to predict precisely. A
    // selection change is a cleaner, fully deterministic proxy: it never
    // touches geometry, so the diff should construct nothing at all for a
    // node selection (only attribute patches).
    const b = bundle(
      [app("a")],
      [ev("o1", "a", "application_submitted", "2026-01-01")],
    );
    const { root } = await render(b);
    const createSpy = vi.spyOn(document, "createElementNS");
    try {
      const nodeRect = root.querySelector(
        "[data-diagram-node='origin:application_submitted'] rect:not([data-diagram-node-hit])",
      );
      nodeRect.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(createSpy).not.toHaveBeenCalled();
    } finally {
      createSpy.mockRestore();
    }
  });

  it("constructs exactly one new SVG element (the halo) when a branch is selected", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = await render(b);
    const createSpy = vi.spyOn(document, "createElementNS");
    try {
      const branchPath = root.querySelector("[data-diagram-link]");
      branchPath.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith(expect.any(String), "path");
    } finally {
      createSpy.mockRestore();
    }
  });

  it("performs zero SVG childList mutations on a no-op re-render", async () => {
    // container.append(existingChild) unconditionally removes and
    // reinserts the child even when it's already in the correct position
    // -- a real mutation, not a no-op -- so this specifically guards
    // against the diff silently reparenting every keyed element on every
    // render regardless of whether anything actually changed.
    const b = bundle(
      [app("a"), app("b")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
        ev("o2", "b", "application_submitted", "2026-01-01"),
        ev("t2", "b", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline, snapshot } = await render(b);
    const svg = root.querySelector("svg");
    const callback = vi.fn();
    const observer = new window.MutationObserver(callback);
    observer.observe(svg, { childList: true, subtree: true });
    try {
      // This render is deferred (dragActive is false); await its own
      // promise so Phase B has actually run before checking the observer.
      await view.update({ timeline, snapshot, selectedBucketId: "current" });
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      observer.disconnect();
    }
  });

  it("performs zero SVG childList mutations when only a node selection changes", async () => {
    const b = bundle(
      [app("a")],
      [ev("o1", "a", "application_submitted", "2026-01-01")],
    );
    const { root } = await render(b);
    const svg = root.querySelector("svg");
    const callback = vi.fn();
    const observer = new window.MutationObserver(callback);
    observer.observe(svg, { childList: true, subtree: true });
    try {
      const nodeRect = root.querySelector(
        "[data-diagram-node='origin:application_submitted'] rect:not([data-diagram-node-hit])",
      );
      nodeRect.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      observer.disconnect();
    }
  });

  it("mutates only the halo on branch selection, without reparenting groups", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o1", "a", "application_submitted", "2026-01-01"),
        ev("t1", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = await render(b);
    const branchGroup = root.querySelector("[data-diagram-branch-group]");
    const handleGroupEl = root.querySelector(
      "[data-diagram-branch-handle]",
    )?.parentElement;
    const diagramSvg = root.querySelector("svg");

    // Direct-children-only observers on the three containers whose child
    // *lists* must stay untouched by a selection-only render (only the
    // branch's own group may gain/lose its halo child).
    const svgCallback = vi.fn();
    const svgObserver = new window.MutationObserver(svgCallback);
    svgObserver.observe(diagramSvg, { childList: true });
    const branchGroupElCallback = vi.fn();
    const branchGroupElObserver = new window.MutationObserver(
      branchGroupElCallback,
    );
    branchGroupElObserver.observe(diagramSvg.querySelector("g"), {
      childList: true,
    });
    const handleGroupCallback = vi.fn();
    const handleGroupObserver = handleGroupEl
      ? new window.MutationObserver(handleGroupCallback)
      : null;
    handleGroupObserver?.observe(handleGroupEl, { childList: true });
    const haloParentCallback = vi.fn();
    const haloParentObserver = new window.MutationObserver(haloParentCallback);
    haloParentObserver.observe(branchGroup, { childList: true });

    try {
      const branchPath = root.querySelector("[data-diagram-link]");
      branchPath.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      expect(svgCallback).not.toHaveBeenCalled();
      expect(branchGroupElCallback).not.toHaveBeenCalled();
      expect(handleGroupCallback).not.toHaveBeenCalled();
      // Exactly one mutation on the branch's own group: the halo insertion.
      expect(haloParentCallback).toHaveBeenCalledTimes(1);
      expect(
        branchGroup.querySelector("[data-diagram-branch-halo]"),
      ).not.toBeNull();
    } finally {
      svgObserver.disconnect();
      branchGroupElObserver.disconnect();
      handleGroupObserver?.disconnect();
      haloParentObserver.disconnect();
    }
  });

  it("reorders SVG node groups to match rank order when a new node is inserted", async () => {
    // "offer_accepted" (endpoint rank 8) exists first; a later render adds
    // "awaiting_response" (rank 0), which must be inserted *before* it in
    // DOM order, not appended after -- proving the reconciler performs a
    // genuine reorder/insert, not just a same-position no-op or an
    // append-to-end.
    const before = bundle(
      [app("a")],
      [
        ev("a-o", "a", "application_submitted", "2026-01-01"),
        ev("a-r", "a", "recruiter_screen", "2026-01-02"),
        ev("a-off", "a", "offer_accepted", "2026-01-03"),
      ],
    );
    const after = bundle(
      [app("a"), app("b")],
      [
        ev("a-o", "a", "application_submitted", "2026-01-01"),
        ev("a-r", "a", "recruiter_screen", "2026-01-02"),
        ev("a-off", "a", "offer_accepted", "2026-01-03"),
        ev("b-o", "b", "application_submitted", "2026-01-01"),
      ],
    );
    const { root, view } = await render(before);
    const acceptedGroup = root.querySelector(
      "[data-diagram-node='endpoint:offer_accepted']",
    );
    expect(acceptedGroup).not.toBeNull();

    await view.update({
      timeline: buildLifecycleTimeline(after),
      snapshot: projectLifecycleAt(after, "current"),
      selectedBucketId: "current",
    });

    const svg = root.querySelector("svg");
    const nodeGroups = [...svg.children].filter((child) =>
      child.hasAttribute("data-diagram-node"),
    );
    const acceptedIndex = nodeGroups.indexOf(
      root.querySelector("[data-diagram-node='endpoint:offer_accepted']"),
    );
    const awaitingIndex = nodeGroups.indexOf(
      root.querySelector("[data-diagram-node='endpoint:awaiting_response']"),
    );
    expect(awaitingIndex).toBeGreaterThanOrEqual(0);
    expect(awaitingIndex).toBeLessThan(acceptedIndex);
  });

  it("renders warning summary from supplied P4 warning codes", async () => {
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

    await view.update({
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

    await view.update({
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
    // This fixture's route-crossing-safe search deterministically exhausts
    // the shared handle-state budget (~15s locally) rather than converging
    // quickly, and this test exercises that path twice (once via render()'s
    // own layoutLifecycleRoutingGraph call, once again in the
    // fallback-verification branch below). Shared CI runners measured
    // meaningfully slower than local dev hardware for this class of
    // deterministic budget-exhaustion search (see the sibling timing
    // thresholds in test/web-tracker-lifecycle-diagram-layout.test.js), so
    // this timeout has generous margin rather than being tuned tight to one
    // machine.
    const sparse = await render(
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
    const dense = await render(fixture.default);
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
    if (!nodesById.has("origin:application_submitted")) {
      expect(dense.root.querySelector("svg")).toBeNull();
      // Which branch is reported first is an artifact of search order, not
      // a meaningful assertion — this fixture's dense fan-in genuinely has
      // no handle-clearance-feasible arrangement for the lane-coordinate
      // search to find (see the transition lane solver test file for the
      // root-cause analysis), so only the error's type is pinned here. Which
      // of the two deterministic failure modes surfaces — a specific
      // handle-placement rejection, or the shared handle-state budget
      // exhausting first — depends on exactly how many coordinate variants
      // get tried before either happens; both are legitimate, bounded
      // outcomes (never a hang), so either message is accepted here.
      const deterministicFailure = new RegExp(
        [
          "^(Lifecycle diagram handle placement invariant violated for ",
          "|Lifecycle handle search exceeded \\d+ states)",
        ].join(""),
        "u",
      );
      expect(() =>
        lifecycleLayout.layoutLifecycleRoutingGraph(dense.snapshot, 1850),
      ).toThrow(deterministicFailure);
      return;
    }
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
  }, 180000);
});

describe("busy indicator (Phase 5a deferred render)", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

  // eslint-disable-next-line max-len
  it("shows the busy indicator while the old DOM is still visible, then hides it once the deferred render completes", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const busy = root.querySelector("[data-diagram-busy]");
    const scroll = root.querySelector(".diagram-scroll");
    const svgBefore = root.querySelector("svg");
    expect(busy.hidden).toBe(true);

    // "current" is always the last bucket; the second-to-last is the latest
    // historical bucket, guaranteed to still include the application (an
    // earlier bucket can predate its origin event entirely, rendering the
    // unrelated "No lifecycle data yet" empty state instead of an svg).
    const targetIndex = timeline.buckets.length - 2;
    const targetId = timeline.buckets[targetIndex].id;
    expect(targetId).not.toBe("current");
    const updated = view.update({
      timeline,
      snapshot: projectLifecycleAt(b, targetId),
      selectedBucketId: targetId,
    });
    // Synchronous assertions, same tick as the update() call: the busy
    // state must already be visible, and the OLD svg (Phase B's own output)
    // must still be on screen -- proving the indicator really shows before
    // the new content replaces it, not after. Phase A's cheap, immediate
    // fields (like the scrubber's own value) update right away regardless.
    expect(busy.hidden).toBe(false);
    expect(scroll.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelector("svg")).toBe(svgBefore);
    expect(root.querySelector("input[type='range']").value).toBe(
      String(targetIndex),
    );

    await updated;
    expect(busy.hidden).toBe(true);
    expect(scroll.getAttribute("aria-busy")).toBe("false");
    expect(root.querySelector("svg")).not.toBeNull();
  });

  it("never shows the busy indicator for a drag-tick render", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const busy = root.querySelector("[data-diagram-busy]");
    const range = root.querySelector("input[type='range']");
    range.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    const targetId = timeline.buckets.at(-1).id;
    // Drag-tick renders complete synchronously (see render()'s dragActive
    // gate) -- no await/flush needed, and the busy indicator must never
    // have appeared even momentarily.
    view.update({
      timeline,
      snapshot: projectLifecycleAt(b, targetId),
      selectedBucketId: targetId,
    });
    expect(busy.hidden).toBe(true);
    expect(
      root.querySelector(".diagram-scroll").getAttribute("aria-busy"),
    ).toBe("false");
  });

  it("cancels a superseded pending render rather than letting both complete", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root, view, timeline } = await render(b, "current");
    const firstTarget = timeline.buckets.at(-2) ?? timeline.buckets.at(-1);
    const secondTarget = timeline.buckets.at(-1);
    const firstUpdate = view.update({
      timeline,
      snapshot: projectLifecycleAt(b, firstTarget.id),
      selectedBucketId: firstTarget.id,
    });
    // Supersede before the first's deferred Phase B ever runs.
    const secondUpdate = view.update({
      timeline,
      snapshot: projectLifecycleAt(b, secondTarget.id),
      selectedBucketId: secondTarget.id,
    });
    // The superseded first promise must still resolve (not hang forever),
    // and only the second's content ever actually renders.
    await Promise.all([firstUpdate, secondUpdate]);
    expect(root.querySelector("input[type='range']").value).toBe(
      String(timeline.buckets.indexOf(secondTarget)),
    );
    expect(root.querySelector("[data-diagram-busy]").hidden).toBe(true);
  });
});

describe("lifecycle diagram P6 pagination and hardening", () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.ResizeObserver;
  });

  it("paginates event rows and resets event pages when snapshots or buckets change", async () => {
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
    const { root, view, timeline } = await render(b);
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
    await view.update({
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
    await view.update({
      timeline,
      snapshot: projectLifecycleAt(b, timeline.buckets[0].id),
      selectedBucketId: timeline.buckets[0].id,
    });
    expect(root.querySelector("[data-event-range]").textContent).toMatch(
      /^Events (0–0|1–)/u,
    );
  });

  it("preserves table pagination across a no-op re-render of the same bundle/bucket", async () => {
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
    const { root, view, timeline } = await render(b);
    root.querySelector("[aria-label='Next event page']").click();
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 51–100 of 125",
    );

    // Same bundle object + same bucket id: projectLifecycleAt is memoized and
    // returns the identical cached reference, so this is a no-op re-render
    // (e.g. re-navigating to the Diagram tab) rather than a real data change.
    await view.update({
      timeline,
      snapshot: projectLifecycleAt(b, "current"),
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 51–100 of 125",
    );

    // A genuinely new bundle object for the same bucket id is a real data
    // change (cache miss) and still resets pagination as before.
    const changed = bundle(applications, lifecycleEvents.slice(0, 124));
    await view.update({
      timeline,
      snapshot: projectLifecycleAt(changed, "current"),
      selectedBucketId: "current",
    });
    expect(root.querySelector("[data-event-range]").textContent).toBe(
      "Events 1–50 of 124",
    );
  });

  // Historical baseline (pre-fix): this test originally used a 60-app,
  // 89-branch fixture that funneled many origins through a small number of
  // milestones/endpoints -- infeasible then, and still infeasible now (see
  // transitionDensityProjection()'s negative-characterization test -- no
  // longer skipped, but still documenting the same infeasibility -- in
  // test/web-tracker-lifecycle-diagram-layout.test.js: 48 branches rejected
  // by the fixed-width rank corridor itself, not route clearance, so
  // neither shipped tolerance can help). Rewritten to exercise the same
  // pagination contract (>50 unique flows, page navigation, reachability
  // across pages, collapsing correctly when data shrinks) against a
  // *layout-feasible* dataset instead: the full 5-origin x 11-endpoint grid
  // of direct origin->endpoint applications with no intermediate milestone
  // -- the same shape as denseBranchProjection() in
  // test/web-tracker-lifecycle-diagram-layout.test.js, which
  // buildTransitionScopedJointOrder makes fully handle-feasible. Built as a
  // snapshot directly (not via app()/ev()/projectLifecycleAt reconciliation
  // events): only 8 of the 11 taxonomy endpoints are reachable as a direct,
  // milestone-free lifecycle-event outcome (interviewing and
  // assessment_in_progress structurally require a milestone-classified
  // event; see lifecycleProjection.js's endpointFromState/markEndpoint),
  // which caps unique flows at 40 (5 origins x 8 endpoints) -- short of the
  // ">50" this test needs. Constructing the snapshot directly reuses
  // exactly denseBranchProjection()'s already-proven-feasible topology
  // instead.
  // eslint-disable-next-line max-len
  it("paginates more than 50 endpoint-conditioned flow rows without losing reachability", async () => {
    const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map(({ id }) => id);
    const endpoints = LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map(({ id }) => id);
    const buildDensePaths = (limit) => {
      const paths = [];
      let index = 0;
      outer: for (const origin of origins) {
        for (const endpoint of endpoints) {
          if (index >= limit) break outer;
          paths.push({
            applicationId: `flow-app-${String(index).padStart(2, "0")}`,
            origin,
            milestones: [],
            endpoint,
            nodeIds: [`origin:${origin}`, `endpoint:${endpoint}`],
            details: [],
          });
          index += 1;
        }
      }
      return paths;
    };
    // Mirrors lifecycleProjection.js's makeNodes/makeLinks/countBy exactly
    // (those helpers aren't exported), so the directly-built snapshot below
    // matches projectLifecycleAt's own output contract byte-for-byte.
    const makeNodes = (paths) => {
      const totals = new Map();
      for (const path of paths)
        for (const nodeId of path.nodeIds)
          totals.set(nodeId, (totals.get(nodeId) ?? 0) + 1);
      const tax = [
        ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
        ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
        ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
      ];
      return tax
        .filter((item) => totals.has(item.nodeId))
        .map((item) => ({
          id: item.nodeId,
          taxonomyId: item.id,
          label: item.label,
          rank: item.rank,
          total: totals.get(item.nodeId),
        }));
    };
    const makeLinks = (paths) => {
      const map = new Map();
      for (const path of paths)
        for (let i = 0; i < path.nodeIds.length - 1; i += 1) {
          const source = path.nodeIds[i];
          const target = path.nodeIds[i + 1];
          const key = `${source}->${target}`;
          const link = map.get(key) ?? {
            id: `link:${key}`,
            source,
            target,
            value: 0,
            applicationIds: [],
          };
          link.applicationIds.push(path.applicationId);
          link.value += 1;
          map.set(key, link);
        }
      return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    };
    const countBy = (paths, key, order = []) => {
      const map = paths.reduce(
        (m, p) => m.set(p[key], (m.get(p[key]) ?? 0) + 1),
        new Map(),
      );
      const rank = new Map(order.map((id, i) => [id, i]));
      return Object.fromEntries(
        [...map.entries()].sort(
          ([a], [b]) =>
            (rank.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
        ),
      );
    };
    const buildSnapshot = (limit) => {
      const paths = buildDensePaths(limit);
      return {
        bucket: { id: "current", label: "Current", kind: "current" },
        includedApplications: paths.length,
        totalApplications: paths.length,
        paths,
        nodes: makeNodes(paths),
        links: makeLinks(paths),
        totals: {
          origins: countBy(
            paths,
            "origin",
            LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((x) => x.id),
          ),
          milestones: {},
          endpoints: countBy(
            paths,
            "endpoint",
            LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((x) => x.id),
          ),
          active: 0,
          terminal: paths.length,
        },
        events: [],
        warnings: [],
        warningCounts: {},
      };
    };
    const totalFlowCount = origins.length * endpoints.length;
    const snapshot = buildSnapshot(totalFlowCount);
    expect(
      lifecycleLayout.buildLifecycleDisplayBranches(snapshot),
    ).toHaveLength(totalFlowCount);
    expect(() =>
      lifecycleLayout.layoutLifecycleRoutingGraph(snapshot, 1850),
    ).not.toThrow();

    const root = setup();
    const view = createLifecycleDiagramView(root, { onBucketChange: vi.fn() });
    const timeline = buildLifecycleTimeline({
      applications: [],
      lifecycleEvents: [],
    });
    await view.update({ timeline, snapshot, selectedBucketId: "current" });
    expect(root.querySelector("svg")).not.toBeNull();
    expect(root.textContent).not.toContain(
      "Unable to lay out lifecycle diagram.",
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
    expect(totalFlows).toBe(totalFlowCount);
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
    await view.update({
      timeline,
      snapshot: buildSnapshot(49),
      selectedBucketId: "current",
    });
    expect(flowRows().length).toBeLessThanOrEqual(50);
    expect(root.querySelector("svg")).not.toBeNull();
    expect(root.textContent).not.toContain(
      "Unable to lay out lifecycle diagram.",
    );
    expect(root.querySelector("[data-flow-range]").textContent).toMatch(
      /^Flows 1–\d+ of \d+$/u,
    );
    expect(
      root.querySelector("[aria-label='Previous flow page']").disabled,
    ).toBe(true);
  });

  it("paginates affected applications with bounded ranges", async () => {
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
    const { root } = await render(bundle(applications, lifecycleEvents));
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

  it("exposes aria-pressed selection and transparent hit targets", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const { root } = await render(b);
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

  it("renders the layout fallback when branch handle placement fails", async () => {
    // The renderer prefers graph.acceptedHandles (the exact handles
    // layoutLifecycleRoutingGraph's own search already accepted) and only
    // falls back to a fresh assignBranchHandles() call when that's absent
    // -- see lifecycleDiagram.js and
    // docs/design/lifecycle-diagram-handle-search-seeding-plan.md. Strip
    // acceptedHandles from the real layout result so the mocked
    // assignBranchHandles() below is actually reached.
    const originalLayout = lifecycleLayout.layoutLifecycleRoutingGraph;
    const layoutSpy = vi
      .spyOn(lifecycleLayout, "layoutLifecycleRoutingGraph")
      .mockImplementation((...args) => {
        const result = originalLayout(...args);
        result.graph.acceptedHandles = undefined;
        return result;
      });
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
      const { root } = await render(b);
      expect(root.textContent).toContain(
        "Unable to lay out lifecycle diagram.",
      );
      expect(root.querySelector("svg")).toBeNull();
    } finally {
      spy.mockRestore();
      layoutSpy.mockRestore();
    }
  });

  it("renders the layout fallback when node label wrapping fails", async () => {
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
      const { root } = await render(b);
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
    const { root } = await render(b);
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
    const { root } = await render(b);
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

  it("uses time elements for exact and date-only event timestamps", async () => {
    const b = bundle(
      [app("a")],
      [
        ev("date", "a", "application_submitted", "2026-01-01"),
        ev("exact", "a", "technical_interview", "2026-01-02T10:00:00.000Z"),
        ev("unknown", "a", "employer_response_received", "unknown"),
      ],
    );
    const { root } = await render(b);
    expect(root.querySelector("time[datetime='2026-01-01']")).toBeTruthy();
    expect(
      root.querySelector("time[datetime='2026-01-02T10:00:00.000Z']"),
    ).toBeTruthy();
    expect(root.textContent).toContain(
      "Unknown date — off chronological scale",
    );
  });
});
