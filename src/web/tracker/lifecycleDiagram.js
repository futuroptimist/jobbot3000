/* global document, window, ResizeObserver */
import { LIFECYCLE_DIAGRAM_TAXONOMY } from "./lifecycleProjection.js";
import {
  BRANCH_STROKE_OPACITY,
  TAXONOMY_BY_NODE_ID as TAXONOMY,
  assignBranchHandles,
  buildLifecycleDisplayBranches,
  calculateLifecycleDiagramLayout,
  compareBranches,
  compareLifecycleIds,
  compoundBranchPath,
  endpointColor,
  layoutLifecycleRoutingGraph,
  labelBoxForNode,
  renderedBranchStrokeWidth,
  rendererHitBoxForNode,
  wrapLifecycleLabel,
} from "./lifecycleDiagramLayout.js";
export { calculateLifecycleDiagramLayout };

const SVG_NS = "http://www.w3.org/2000/svg";
const collator = new Intl.Collator(undefined, { numeric: true });
const compare = (a, b) => collator.compare(String(a), String(b));
const pct = (value, total) =>
  total ? `${Math.round((value / total) * 100)}%` : "0%";
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
};
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs))
    if (value !== undefined && value !== null)
      node.setAttribute(key, String(value));
  return node;
};
const makeDebounce = (fn, ms = 80) => {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.clear = () => clearTimeout(timer);
  return debounced;
};
const EMPTY_PROJECTION = Object.freeze({
  bucket: Object.freeze({ id: "current", kind: "current", label: "Current" }),
  totalApplications: 0,
  includedApplications: 0,
  nodes: Object.freeze([]),
  links: Object.freeze([]),
  paths: Object.freeze([]),
  events: Object.freeze([]),
  warnings: Object.freeze([]),
  totals: Object.freeze({
    origins: Object.freeze({}),
    milestones: Object.freeze({}),
    endpoints: Object.freeze({}),
  }),
});
const bucketValueText = (bucket) => {
  if (!bucket) return "Current — latest data in this browser";
  if (bucket.kind === "current") return "Current — latest data in this browser";
  if (bucket.kind === "unknown-date")
    return "Unknown date — off chronological scale";
  if (bucket.kind === "date") return `${bucket.label}`;
  return `Historical event at ${bucket.label}`;
};
const isUnknownPrecision = (precision) =>
  ["unknown", "legacy-placeholder", "legacy_placeholder"].includes(precision);
const PAGE_SIZE = 50;
// Draft-tier layout budgets used only while actively dragging the scrubber
// (see renderSvg()'s qualityTier option) -- roughly a quarter of
// lifecycleDiagramLayout.js's full-quality defaults (200000/32768). A
// smaller budget both bounds per-tick latency and makes
// toleratedRouteCrossingCount's existing budget-pressure curve relax sooner,
// without changing any ordering/search logic itself.
const DRAG_QUALITY_TRANSITION_LANE_STATE_LIMIT = 50000;
const DRAG_QUALITY_HANDLE_STATE_LIMIT = 8192;
// Structured lifecycle-layout-search failure causes (see
// lifecycleDiagramLayout.js) -- a deterministic budget/state-limit or
// infeasible-ordering rejection, always carried as error.cause.type. An
// unexpected/programming error (a genuine bug, not a search limit) never
// sets a cause matching this set -- see the "hard or unexpected
// materialization invariant" comment in lifecycleDiagramLayout.js, which
// propagates with no cause at all specifically so it isn't misclassified
// as ordinary infeasibility.
const LIFECYCLE_LAYOUT_FAILURE_CAUSE_TYPES = new Set([
  "lifecycle-transition-lane-order",
  "lifecycle-handle-placement",
  "lifecycle-routing-anchor-allocation",
  "lifecycle-authoritative-rank-order",
]);
// A seed-replay rejection (see lastLayoutSeed below) is an EXPECTED, routine
// outcome for a cross-bucket seed candidate -- unlike the same-call
// discovery->final replay this mechanism was originally built for, two
// different buckets are not guaranteed to agree. Distinguished from every
// other typed layout failure so only this one triggers an unseeded retry.
const isSeedReplayFailure = (error) =>
  error?.cause?.type === "lifecycle-authoritative-rank-order" &&
  error?.cause?.reason === "seed-replay-failed";
const unique = (items) => [...new Set(items.filter(Boolean))].sort(compare);
const pageSlice = (items, page) => {
  const maxPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  return {
    page: safePage,
    maxPage,
    total: items.length,
    start: items.length ? safePage * PAGE_SIZE + 1 : 0,
    end: Math.min(items.length, (safePage + 1) * PAGE_SIZE),
    items: items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
  };
};
const formatEventTime = (event) => {
  if (event?.occurredAtPrecision === "date") {
    const date = /^\d{4}-\d{2}-\d{2}/u.exec(
      String(event.occurredAt ?? ""),
    )?.[0];
    return date
      ? { label: `${date} — time not recorded`, datetime: date }
      : { label: "Unknown date — off chronological scale" };
  }
  if (isUnknownPrecision(event?.occurredAtPrecision) || !event?.occurredAt)
    return { label: "Unknown date — off chronological scale" };
  const parsed = new Date(event.occurredAt);
  return Number.isFinite(parsed.getTime())
    ? { label: parsed.toLocaleString(), datetime: parsed.toISOString() }
    : { label: "Unknown date — off chronological scale" };
};
const formatTimestamp = (bucket, projection) => {
  if (bucket.kind === "current") {
    const known = projection.events
      .filter(
        (event) =>
          !isUnknownPrecision(event.occurredAtPrecision) && event.occurredAt,
      )
      .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)))
      .at(-1);
    const unknown = projection.events.filter((event) =>
      isUnknownPrecision(event.occurredAtPrecision),
    ).length;
    const latest = known ? formatEventTime(known) : undefined;
    return {
      // eslint-disable-next-line max-len
      label: `Current — latest data in this browser${latest ? `, latest known event ${latest.label}` : ""}${unknown ? `, ${unknown} unknown-time event${unknown === 1 ? "" : "s"}` : ""}`,
      datetime: latest?.datetime,
    };
  }
  if (bucket.kind === "unknown-date")
    return { label: "Unknown date — off chronological scale" };
  if (bucket.kind === "date")
    return {
      label: bucket.label.includes("time not recorded")
        ? bucket.label
        : `${bucket.label} — time not recorded`,
      datetime: bucket.label.slice(0, 10),
    };
  return formatEventTime({
    occurredAt: bucket.label,
    occurredAtPrecision: "instant",
  });
};

export function createLifecycleDiagramView(root, options = {}) {
  const onBucketChange = options.onBucketChange ?? (() => {});
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let selectedId = "current";
  let projection = EMPTY_PROJECTION;
  let timeline = { buckets: [] };
  let selectedFeature = null;
  let resizeObserver;
  let windowResizeHandler;
  let lastNewerAvailable = false;
  let eventPage = 0;
  let flowPage = 0;
  let applicationPage = 0;
  let displayBranches = [];
  let lastLayoutWidth = null;
  // True only between a pointerdown and the matching pointerup/pointercancel
  // on the scrubber range input -- distinguishes an active drag (cheap,
  // approximate layout is acceptable) from every other trigger of a render
  // (bucket navigation, resize, selection, keyboard stepping), which always
  // use the full-quality layout. See renderSvg()'s qualityTier option below.
  let dragActive = false;
  // Two-phase render deferral, used by render() (bucket navigation: mount,
  // prev/next/current, keyboard stepping, resize, drag-release settle) --
  // NOT by selectFeature() (selection clicks stay synchronous, see its own
  // comment). Browsers only paint after the current synchronous task yields
  // back to the event loop, so a busy indicator can only actually be
  // visible before the (still-synchronous) layout/DOM work runs if that
  // work is deferred past a real paint. A single requestAnimationFrame
  // callback fires *before* the next paint -- too early to guarantee the
  // busy state has rendered -- so this waits for a second, nested rAF,
  // which runs only after that frame has actually painted. Falls back to
  // setTimeout(fn, 0) if rAF/cancelAnimationFrame aren't available
  // (defensive, matches the optional-chaining style already used for
  // window.matchMedia?.(...) below). Drag ticks (Phase 4a/4b) skip this
  // entirely -- they're already fast, and flickering the indicator every
  // ~100ms during a drag would be distracting, not helpful.
  const scheduleFrame = (fn) =>
    (window.requestAnimationFrame ?? ((cb) => setTimeout(cb, 0)))(fn);
  const cancelFrame = window.cancelAnimationFrame ?? clearTimeout;
  let pendingRenderFrame = null;
  let pendingRenderResolve = null;
  const cancelPendingRender = () => {
    if (pendingRenderFrame === null) return;
    cancelFrame(pendingRenderFrame);
    pendingRenderFrame = null;
    // A superseded render's caller must not hang forever waiting on a
    // Phase B that will now never run -- resolve it as a no-op instead.
    pendingRenderResolve?.();
    pendingRenderResolve = null;
  };
  // runDeferred's caller passes the generation it captured at render()'s own
  // top -- phaseB (Phase 5b) can now itself await a Worker round-trip, so a
  // *newer* render can be triggered while this one's rAF-scheduled phaseB is
  // already running. cancelPendingRender only guards the window *before*
  // phaseB starts (see below); once it's running, only this generation
  // check can tell a superseded completion apart from the current one, so
  // its busy-indicator hide doesn't clobber a still-genuinely-busy newer
  // render.
  const runDeferred = (phaseB, myGeneration) => {
    cancelPendingRender();
    busyIndicator.hidden = false;
    scroll.setAttribute("aria-busy", "true");
    return new Promise((resolve) => {
      pendingRenderResolve = resolve;
      pendingRenderFrame = scheduleFrame(() => {
        pendingRenderFrame = scheduleFrame(() => {
          pendingRenderFrame = null;
          pendingRenderResolve = null;
          Promise.resolve(phaseB())
            .catch((error) => {
              // phaseB (Phase 5b) can now reject -- e.g. an unexpected
              // throw from renderDetails()/renderTables(), not one of the
              // structured layout-failure statuses acquireLayoutAsync
              // already handles. Never let that leave update()'s caller
              // hanging or the busy indicator stuck; still surface it
              // instead of swallowing a genuine bug silently.
              console.error("Lifecycle diagram render failed", error);
            })
            .finally(() => {
              if (myGeneration === renderGeneration) {
                busyIndicator.hidden = true;
                scroll.setAttribute("aria-busy", "false");
              }
              resolve();
            });
        });
      });
    });
  };
  // Bumped unconditionally at the top of every render() call (drag and
  // non-drag alike). cancelPendingRender only protects the pre-rAF window;
  // this closes the gap it structurally can't reach -- a Worker call
  // already in flight when a newer render starts. Each async layout
  // acquisition captures its own generation and discards its result if this
  // has moved on by the time its await resolves.
  let renderGeneration = 0;
  // Lazily created on first non-drag render that needs it -- a mounted but
  // never-viewed diagram tab shouldn't pay for a worker thread. One worker
  // is reused for the view's whole lifetime; requests are matched to
  // responses by id since a stale request's response can still arrive after
  // a newer one's (the worker processes messages one at a time, so a
  // superseded request already being computed isn't interrupted, just
  // ignored on arrival -- see acquireLayoutAsync).
  let layoutWorker = null;
  let layoutWorkerRequestId = 0;
  const layoutWorkerPending = new Map();
  // Guards selectFeature() the same way pendingRenderFrame already does --
  // see its own comment. A count, not a boolean: two overlapping non-drag
  // renders can each have a worker call in flight at once, and a boolean
  // would be incorrectly cleared by the first one's completion while the
  // second is still outstanding.
  let outstandingAsyncLayoutCalls = 0;
  const rejectAllPendingLayoutRequests = (error) => {
    for (const pending of layoutWorkerPending.values()) pending.reject(error);
    layoutWorkerPending.clear();
  };
  const getLayoutWorker = () => {
    if (!window.Worker) return null;
    if (layoutWorker) return layoutWorker;
    try {
      layoutWorker = new window.Worker(
        "/assets/lifecycle-diagram-layout.worker.js",
        { type: "module" },
      );
    } catch {
      // Construction can throw synchronously (sandboxed or policy-restricted
      // browser, blocked module worker, etc.) -- treat it exactly like
      // window.Worker being unavailable so the caller falls back to
      // acquireLayoutSync instead of an uncaught rejection.
      return null;
    }
    layoutWorker.onmessage = (event) => {
      const { requestId, ok, graph, dimensions, error } = event.data ?? {};
      const pending = layoutWorkerPending.get(requestId);
      if (!pending) return;
      layoutWorkerPending.delete(requestId);
      pending.resolve(
        ok ? { ok: true, graph, dimensions } : { ok: false, error },
      );
    };
    // A worker-thread crash must not leave any caller hanging forever, and
    // the broken instance must not be reused -- a future render would post
    // to a worker that can never respond. Discard it so the next
    // getLayoutWorker() call creates a fresh one (or, if construction now
    // also fails, falls back to acquireLayoutSync).
    layoutWorker.onerror = () => {
      rejectAllPendingLayoutRequests(
        new Error("Lifecycle diagram layout worker failed."),
      );
      layoutWorker?.terminate();
      layoutWorker = null;
    };
    return layoutWorker;
  };
  const requestLayoutFromWorker = (worker, availableWidth, options) => {
    layoutWorkerRequestId += 1;
    const requestId = layoutWorkerRequestId;
    return new Promise((resolve, reject) => {
      layoutWorkerPending.set(requestId, { resolve, reject });
      worker.postMessage({
        type: "layout",
        requestId,
        projection,
        availableWidth,
        options,
      });
    });
  };
  // Captured from the most recent successful layoutLifecycleRoutingGraph()
  // call (draft or full quality, whichever produced it) -- an opportunistic
  // candidate for the next drag tick's seed-replay attempt. Node/branch/link
  // ids are pure functions of taxonomy vocabulary (stable across different
  // buckets of the same bundle, not just across two passes of one bucket),
  // so a seed captured here can be looked up by id against a later bucket's
  // freshly-built graph even though the two buckets are otherwise unrelated.
  let lastLayoutSeed = null;
  // The bucket id resolved at the most recent drag-tick "input" event,
  // reset on each new pointerdown. Release must resolve against this
  // captured id, never a raw index against range.value -- update() can
  // replace `timeline` between the last tick and release (e.g. a
  // background refresh inserting a bucket), which would shift what that
  // index now points to. See the debouncedRangeChange comment below for
  // the identical hazard/fix already applied to the debounced path itself.
  let lastDragTickBucketId = null;
  // Keyed-diff state for renderSvg(): svg/branchG/handleG are created once
  // and reused across renders instead of being torn down every call. Node
  // ids (`origin:x`, `milestone:x`, `endpoint:x`) and branch ids
  // (`branch:${semanticLinkId}:endpoint:${endpointId}`) are pure functions
  // of taxonomy vocabulary (see docs/design/application-lifecycle-diagram.md),
  // so they're stable/safe diff keys both within one projection's
  // re-renders and across different bucket projections of the same bundle.
  let diagramSvg = null;
  let branchGroupEl = null;
  let handleGroupEl = null;
  const nodeElementsByKey = new Map();
  const nodeSignatureByKey = new Map();
  const currentNodeByKey = new Map();
  const branchElementsByKey = new Map();
  const branchSignatureByKey = new Map();
  const currentBranchByKey = new Map();
  const resetSvgDiffState = () => {
    diagramSvg = null;
    branchGroupEl = null;
    handleGroupEl = null;
    nodeElementsByKey.clear();
    nodeSignatureByKey.clear();
    currentNodeByKey.clear();
    branchElementsByKey.clear();
    branchSignatureByKey.clear();
    currentBranchByKey.clear();
  };
  const ids = {
    title: "lifecycle-diagram-title",
    desc: "lifecycle-diagram-desc",
    live: "lifecycle-diagram-live",
  };

  root.textContent = "";
  const controls = el("div", { className: "diagram-controls" });
  const prev = el("button", {
    type: "button",
    className: "button",
    textContent: "Previous event",
  });
  const rangeLabel = el("label", { className: "diagram-range-label" }, [
    document.createTextNode("Lifecycle point"),
  ]);
  const range = el("input", {
    type: "range",
    min: "0",
    value: "0",
    "aria-label": "Lifecycle point",
  });
  rangeLabel.append(range);
  const next = el("button", {
    type: "button",
    className: "button",
    textContent: "Next event",
  });
  const current = el("button", {
    type: "button",
    className: "button",
    textContent: "Return to current",
  });
  const badge = el("span", { className: "chip", textContent: "Current" });
  const count = el("span", { className: "muted" });
  const stamp = el("p", { className: "muted diagram-timestamp" });
  // Dedicated aria-live region for the busy state, kept separate from `live`
  // below (driven by the debounced announce() helper for scrub-position
  // text) so a busy announcement can never be coalesced away by that
  // debounce. See render()'s Phase A/B split for when this toggles.
  const busyIndicator = el("p", {
    className: "muted diagram-busy",
    "data-diagram-busy": "",
    "aria-live": "polite",
    textContent: "Updating diagram…",
    hidden: "",
  });
  const simultaneous = el("details", {}, [
    el("summary", { textContent: "Selected-boundary events" }),
    el("div", { "data-boundary-events": "" }),
  ]);
  const live = el("p", {
    id: ids.live,
    className: "sr-only",
    "aria-live": "polite",
  });
  controls.append(prev, rangeLabel, next, current, badge, count);
  const legend = el("div", {
    className: "diagram-legend",
    "data-diagram-legend": "",
    role: "group",
    "aria-label": "Outcome branch colors",
  });
  const scroll = el("div", {
    className: "diagram-scroll",
    tabindex: "0",
    role: "region",
    "aria-label": "Scrollable lifecycle diagram",
  });
  const details = el("section", {
    className: "card",
    "aria-live": "polite",
    "data-diagram-details": "",
  });
  const tablesDisclosure = el("details", { className: "diagram-tables" }, [
    el("summary", { textContent: "Lifecycle data tables" }),
  ]);
  const tables = el("div", { className: "diagram-tables-body" });
  tablesDisclosure.append(tables);
  root.append(
    controls,
    stamp,
    busyIndicator,
    live,
    legend,
    scroll,
    details,
    simultaneous,
    tablesDisclosure,
  );

  const announce = makeDebounce((message) => {
    live.textContent = message;
  });
  const renderTable = (caption, headers, rows) => {
    const table = el("table", { className: "tracker-table" });
    table.append(el("caption", { textContent: caption }));
    const thead = el("thead");
    thead.append(
      el(
        "tr",
        {},
        headers.map((h) => el("th", { scope: "col", textContent: h })),
      ),
    );
    const tbody = el("tbody");
    for (const row of rows) {
      const tr = el("tr");
      row.cells.forEach((cell, index) => {
        const td = el(index ? "td" : "th", {
          scope: index ? undefined : "row",
        });
        if (!index && row.onSelect) {
          const button = el("button", {
            type: "button",
            className: "link-button diagram-select-button",
            textContent: cell,
            "aria-label": row.label,
            "aria-pressed":
              row.id && selectedFeature?.id === row.id ? "true" : "false",
            "data-diagram-select-id": row.id,
          });
          button.addEventListener("click", row.onSelect);
          td.append(button);
        } else if (row.time && index === 3 && row.time.datetime) {
          td.append(
            el("time", { datetime: row.time.datetime, textContent: cell }),
          );
        } else {
          td.textContent = cell;
        }
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    return el(
      "div",
      {
        className: "table-container",
        tabindex: "0",
        role: "region",
        "aria-label": `${caption} table`,
      },
      [table],
    );
  };
  const featureApplicationIds = (feature) =>
    unique(
      feature.applicationIds?.length
        ? feature.applicationIds
        : projection.paths
            .filter((path) => path.nodeIds?.includes(feature.id))
            .map((path) => path.applicationId),
    );
  const featureById = (id) => {
    const branch = displayBranches.find((candidate) => candidate.id === id);
    if (branch) {
      const from = TAXONOMY.get(branch.source)?.label ?? branch.source;
      const to = TAXONOMY.get(branch.target)?.label ?? branch.target;
      const outcome =
        LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.find(
          (endpoint) => endpoint.id === branch.endpointId,
        )?.label ?? branch.endpointId;
      return {
        id: branch.id,
        label: `${from} to ${to}, outcome ${outcome}: ${branch.value}`,
        applicationIds: branch.applicationIds,
      };
    }
    const node = projection.nodes.find((candidate) => candidate.id === id);
    if (node) {
      const label = TAXONOMY.get(node.id)?.label ?? node.label ?? node.id;
      return {
        id: node.id,
        label: `${label}: ${node.total ?? 0}`,
        applicationIds: node.applicationIds,
      };
    }
    return null;
  };
  const selectFeature = (feature) => {
    // The old SVG/table DOM stays visible and clickable during the busy
    // window between Phase A (which already reassigned `projection` to the
    // new snapshot) and Phase B (which rebuilds currentNodeByKey/
    // currentBranchByKey/displayBranches from it) -- a click routed through
    // here in that window would resolve applicationIds against the *new*
    // projection for a feature id read off the *old* render, and since ids
    // are stable taxonomy-derived values (Phase 4b), that can silently
    // resurrect a selection the bucket change was supposed to clear. Drop
    // it instead; Phase B lands within a couple of frames regardless. Phase
    // 5b's Worker-based layout acquisition opens the identical window for
    // longer (an await, not just a pending rAF) -- outstandingAsyncLayoutCalls
    // covers that too.
    if (pendingRenderFrame !== null || outstandingAsyncLayoutCalls > 0) return;
    const active = document.activeElement;
    const shouldRestoreFocus = active?.matches?.(".diagram-select-button");
    if (selectedFeature?.id !== feature.id) applicationPage = 0;
    selectedFeature = {
      ...feature,
      applicationIds: featureApplicationIds(feature),
    };
    // Selection clicks stay fully synchronous, unlike render() -- they never
    // trigger new data-layer work (the projection is already cached), and
    // Phase 3's keyed diff already makes the DOM-reconciliation half cheap.
    // Only the layout search re-runs unconditionally, and that's already
    // fast enough in practice (~100-150ms even on a dense fixture, per
    // Phase 4's manual verification) that deferring it here would mostly
    // just add a busy-indicator flicker to normally-instant clicks. If a
    // genuinely slow selection case turns up in practice, revisit as its
    // own small follow-up rather than folding it into this phase.
    renderDetails();
    renderSvg();
    renderTables();
    if (shouldRestoreFocus)
      [...tables.querySelectorAll(".diagram-select-button")]
        .find((button) => button.dataset.diagramSelectId === feature.id)
        ?.focus();
  };
  const branchLabelFor = (branch) => {
    const from = TAXONOMY.get(branch.source)?.label ?? branch.source;
    const to = TAXONOMY.get(branch.target)?.label ?? branch.target;
    const outcome =
      LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.find(
        (endpoint) => endpoint.id === branch.endpointId,
      )?.label ?? branch.endpointId;
    return `${from} to ${to}, outcome ${outcome}: ${branch.value}`;
  };
  const nodeLabelFor = (node) => `${node.label}: ${node.total}`;
  // Click/touch/pointer listeners on a reused SVG element are attached
  // exactly once, at element creation — never re-attached on reuse. To
  // avoid them going stale (layoutLifecycleRoutingGraph() isn't memoized by
  // projection identity, so a node/branch can have identical rendered
  // geometry across two different buckets while its `applicationIds`
  // membership differs), listeners look up the *current* node/branch by key
  // at click time via these maps rather than closing over the object
  // captured when the element was built.
  const selectBranchByKey = (branchId) => {
    const branch = currentBranchByKey.get(branchId);
    if (branch)
      selectFeature({
        id: branch.id,
        label: branchLabelFor(branch),
        applicationIds: branch.applicationIds,
      });
  };
  const selectNodeByKey = (nodeId) => {
    const node = currentNodeByKey.get(nodeId);
    if (node)
      selectFeature({
        id: node.id,
        label: nodeLabelFor(node),
        applicationIds: node.applicationIds,
      });
  };
  const renderDetails = () => {
    const total = projection.includedApplications || 0;
    const warningCounts = projection.warningCounts ?? {};
    const unknownTimeEvents = (projection.events ?? []).filter((event) =>
      isUnknownPrecision(event.occurredAtPrecision),
    ).length;
    // eslint-disable-next-line max-len
    const warningSummary = `Warnings: inferred history ${warningCounts.inferred_event ?? 0}; unknown origin/time ${(warningCounts.inferred_origin ?? 0) + (warningCounts.invalid_timestamp ?? 0) + unknownTimeEvents}; status mismatch ${warningCounts.status_mismatch ?? 0}; regression ${warningCounts.regressive_history ?? 0}.`;
    if (!selectedFeature) {
      details.textContent =
        // eslint-disable-next-line max-len
        `Select a node or flow row for counts, percentages, and affected applications. ${warningSummary}`;
      return;
    }
    const ids = featureApplicationIds(selectedFeature);
    const inferred = unique(
      projection.warnings
        .filter(
          (w) =>
            ids.includes(w.applicationId) &&
            String(w.code).includes("inferred"),
        )
        .map((w) => w.applicationId),
    );
    const observed = ids.filter((id) => !inferred.includes(id));
    details.textContent = "";
    details.append(
      el("h3", { textContent: selectedFeature.label }),
      el("p", {
        // eslint-disable-next-line max-len
        textContent: `${ids.length} application${ids.length === 1 ? "" : "s"} (${pct(ids.length, total)}). Observed ${observed.length}; inferred ${inferred.length}. Date range: ${projection.bucket.kind === "date" ? formatTimestamp(projection.bucket, projection).label : projection.bucket.kind === "current" ? `through ${projection.bucket.label}` : projection.bucket.label}.`,
      }),
    );
    const appPage = pageSlice(ids, applicationPage);
    applicationPage = appPage.page;
    const appList = el("ul", { "data-affected-applications": "" });
    for (const id of appPage.items)
      appList.append(el("li", { textContent: id }));
    const prevApp = el("button", {
      type: "button",
      className: "button",
      textContent: "Previous application page",
      "aria-label": "Previous application page",
    });
    const nextApp = el("button", {
      type: "button",
      className: "button",
      textContent: "Next application page",
      "aria-label": "Next application page",
    });
    prevApp.disabled = appPage.page <= 0;
    nextApp.disabled = appPage.page >= appPage.maxPage;
    prevApp.addEventListener("click", () => {
      applicationPage -= 1;
      renderDetails();
    });
    nextApp.addEventListener("click", () => {
      applicationPage += 1;
      renderDetails();
    });
    const d = el("details", {}, [
      el("summary", { textContent: `Affected applications (${ids.length})` }),
      el("p", {
        "data-application-range": "",
        textContent: `Applications ${appPage.start}–${appPage.end} of ${appPage.total}`,
      }),
      el("p", {
        className: "muted",
        textContent: ids.length
          ? "Application IDs are paginated below to keep rendering bounded."
          : "None",
      }),
      appList,
      el("div", { className: "diagram-pagination" }, [prevApp, nextApp]),
    ]);
    details.append(
      d,
      el("p", { className: "muted", textContent: warningSummary }),
    );
  };
  const renderLegend = () => {
    legend.textContent = "";
    const active = new Map(
      LIFECYCLE_DIAGRAM_TAXONOMY.endpoints
        .filter(({ id }) => (projection.totals.endpoints?.[id] ?? 0) > 0)
        .map(({ id, label }) => [
          id,
          { id, label, count: projection.totals.endpoints[id] },
        ]),
    );
    for (const item of active.values()) {
      legend.append(
        el("span", { className: "diagram-legend-item" }, [
          el("span", {
            // A static per-endpoint-id class, not an inline style -- the
            // strict production CSP (script-src/style-src 'self', no
            // 'unsafe-inline') blocks the style attribute entirely. Colors
            // live in tracker.css's .diagram-legend-swatch--* rules, kept in
            // sync with ENDPOINT_BRANCH_COLORS by hand. item.id is always a
            // fixed taxonomy id, never arbitrary data.
            className: `diagram-legend-swatch diagram-legend-swatch--${item.id}`,
            "aria-hidden": "true",
          }),
          document.createTextNode(`${item.label} ${item.count}`),
        ]),
      );
    }
  };
  const branchSignature = (branch, pathData, widthPx, handle) => ({
    pathData,
    widthPx,
    color: branch.color,
    value: branch.value,
    handleX: handle?.x ?? null,
    handleY: handle?.y ?? null,
    handleR: handle?.radius ?? null,
  });
  const nodeSignature = (node) => ({
    x0: node.x0,
    y0: node.y0,
    x1: node.x1,
    y1: node.y1,
    label: node.label,
    total: node.total,
  });
  const sameSignature = (a, b) => {
    if (!a || !b) return false;
    for (const key of Object.keys(a))
      if (!Object.is(a[key], b[key])) return false;
    return true;
  };
  // `container.append(existingChild)` unconditionally removes and
  // reinserts the child even when it's already in the correct position --
  // that's a real DOM mutation, not a no-op, so doing it for every keyed
  // element on every render would silently defeat the "reuse untouched"
  // half of the diff contract above. This walks the container's current
  // children alongside the desired order and only calls insertBefore for
  // an element that's actually out of place; elements already positioned
  // correctly are left completely untouched (zero DOM writes, zero
  // mutation records). `startAfter` lets a reconciled range start partway
  // through a container that also holds other, non-reconciled children
  // (diagramSvg's title/desc/branchGroupEl/handleGroupEl before its node
  // groups).
  const reconcileChildOrder = (container, desiredElements, startAfter) => {
    let referenceNode = startAfter
      ? startAfter.nextSibling
      : container.firstChild;
    for (const element of desiredElements) {
      if (referenceNode === element) referenceNode = referenceNode.nextSibling;
      else container.insertBefore(element, referenceNode);
    }
  };
  const showDiagramFallback = (message) => {
    scroll.textContent = "";
    resetSvgDiffState();
    scroll.append(el("p", { className: "muted", textContent: message }));
  };
  const buildBaseLayoutOptions = () => ({
    ...(options.horizontalGeometry
      ? { horizontalGeometry: options.horizontalGeometry }
      : {}),
    // Draft tier still runs full handle placement and route-crossing
    // auditing (unlike the test-only transitionLanePhaseOnly shortcut) --
    // it only skips discovery's seed-replay half of the pipeline and uses
    // smaller state budgets, so its output is always independently
    // validated by the same acceptance logic full quality uses.
    ...(dragActive
      ? {
          qualityTier: "draft",
          transitionLaneStateLimit: DRAG_QUALITY_TRANSITION_LANE_STATE_LIMIT,
          handleStateLimit: DRAG_QUALITY_HANDLE_STATE_LIMIT,
          skipHandleFallbackSweep: true,
        }
      : {}),
  });
  // Used by drag ticks and selectFeature() (both stay fully synchronous --
  // see their own comments): the exact layout-acquisition logic that
  // predates the Worker offload, relocated into its own function so the new
  // async path below can share renderSvgFromLayout with it. Returns a
  // discriminated result rather than calling showDiagramFallback itself, so
  // the async caller can gate showing it behind its own staleness check;
  // the sync caller (renderSvg) shows it unconditionally.
  const acquireLayoutSync = (baseLayoutOptions) => {
    // Cross-bucket seed reuse only applies to draft-tier drag ticks -- the
    // full-quality settle-on-release call always runs unseeded (dragActive
    // is false by the time it fires), and it already derives its own seed
    // internally via its two-pass discovery+final wrapper.
    const seededLayoutOptions =
      dragActive && lastLayoutSeed
        ? { ...baseLayoutOptions, ...lastLayoutSeed }
        : null;
    try {
      return {
        status: "ok",
        ...layoutLifecycleRoutingGraph(
          projection,
          root.clientWidth,
          seededLayoutOptions ?? baseLayoutOptions,
        ),
      };
    } catch (error) {
      if (seededLayoutOptions && isSeedReplayFailure(error)) {
        // A seed that doesn't apply to this bucket (different composition,
        // or geometry that's no longer legal under this bucket's own
        // values) is expected, routine, and cheap to detect -- retry once,
        // unseeded, before falling into the ordinary layout-failure
        // handling below.
        try {
          return {
            status: "ok",
            ...layoutLifecycleRoutingGraph(
              projection,
              root.clientWidth,
              baseLayoutOptions,
            ),
          };
        } catch (retryError) {
          if (
            dragActive &&
            LIFECYCLE_LAYOUT_FAILURE_CAUSE_TYPES.has(retryError?.cause?.type)
          )
            return { status: "skip" };
          return { status: "error", error: retryError };
        }
      }
      if (
        dragActive &&
        LIFECYCLE_LAYOUT_FAILURE_CAUSE_TYPES.has(error?.cause?.type)
      ) {
        // A known layout-search failure (budget exceeded, infeasible
        // ordering, etc.) during a draft-tier tick doesn't mean the bucket
        // is actually unlayoutable -- full quality would likely have
        // succeeded given more budget. Skip this tick's render and keep
        // whatever was already on screen rather than flashing the fallback
        // message; a full-quality render is guaranteed on drag release (see
        // releaseDrag below), which will show the real fallback if it also
        // fails there. An *unexpected* error (no structured cause -- a
        // genuine bug, not a search limit) must never be silently swallowed
        // just because a drag happens to be in progress.
        return { status: "skip" };
      }
      return { status: "error", error };
    }
  };
  const renderSvg = () => {
    renderLegend();
    if (!projection.totalApplications) {
      showDiagramFallback("No lifecycle data yet.");
      return;
    }
    if (!projection.nodes.length) {
      showDiagramFallback("No diagram nodes are available for this point.");
      return;
    }
    const result = acquireLayoutSync(buildBaseLayoutOptions());
    if (result.status === "skip") return;
    if (result.status === "error") {
      console.error(
        "Lifecycle diagram layout failed",
        result.error?.message,
        JSON.stringify(result.error?.cause),
      );
      showDiagramFallback("Unable to lay out lifecycle diagram.");
      return;
    }
    renderSvgFromLayout(result.graph, result.dimensions);
  };
  // Only reached for a non-drag render (see render()'s dragActive branch).
  // acquireLayoutAsync's Worker call is what actually moves the layout
  // search off the main thread; it falls back to acquireLayoutSync
  // synchronously if window.Worker is unavailable, matching this file's
  // established `X ?? fallback` style for optional browser APIs.
  const renderSvgAsync = async (myGeneration) => {
    renderLegend();
    if (!projection.totalApplications) {
      showDiagramFallback("No lifecycle data yet.");
      return true;
    }
    if (!projection.nodes.length) {
      showDiagramFallback("No diagram nodes are available for this point.");
      return true;
    }
    const result = await acquireLayoutAsync(
      buildBaseLayoutOptions(),
      myGeneration,
    );
    // acquireLayoutAsync checks staleness immediately after its own await
    // (the only yield point between there and here) -- nothing else can
    // have advanced renderGeneration in between, so this single check is
    // both necessary and sufficient; a second check here would be dead code.
    if (result.status === "stale") return false;
    if (result.status === "skip") return true;
    if (result.status === "error") {
      console.error(
        "Lifecycle diagram layout failed",
        result.error?.message,
        JSON.stringify(result.error?.cause),
      );
      showDiagramFallback("Unable to lay out lifecycle diagram.");
      return true;
    }
    renderSvgFromLayout(result.graph, result.dimensions);
    return true;
  };
  // A single request/response, unlike acquireLayoutSync -- seededLayoutOptions
  // is only ever non-null when dragActive is true (see acquireLayoutSync),
  // and this is only ever reached when it's false, so the seed-replay-retry
  // branch can never apply here; there's nothing to replicate across the
  // worker boundary.
  const acquireLayoutAsync = async (baseLayoutOptions, myGeneration) => {
    const worker = getLayoutWorker();
    if (!worker) return acquireLayoutSync(baseLayoutOptions);
    outstandingAsyncLayoutCalls += 1;
    try {
      const response = await requestLayoutFromWorker(
        worker,
        root.clientWidth,
        baseLayoutOptions,
      );
      if (myGeneration !== renderGeneration) return { status: "stale" };
      if (!response.ok) return { status: "error", error: response.error };
      return {
        status: "ok",
        graph: response.graph,
        dimensions: response.dimensions,
      };
    } catch (error) {
      if (myGeneration !== renderGeneration) return { status: "stale" };
      return { status: "error", error };
    } finally {
      outstandingAsyncLayoutCalls -= 1;
    }
  };
  // Shared by both the sync (drag tick, selectFeature) and async (Worker)
  // acquisition paths -- everything from here on is pure DOM
  // construction/diffing plus the cross-bucket seed capture, with no
  // dependency on *how* { graph, dimensions } was obtained. Only ever
  // called with an already-known-fresh result; a superseded async result
  // never reaches this function (see renderSvgAsync).
  const renderSvgFromLayout = (graph, dimensions) => {
    // Capture a fresh cross-bucket seed candidate from this successful
    // layout (draft or full quality -- either populates the same fields on
    // its own graph) for the next drag tick to opportunistically reuse.
    {
      const authoritativeBranchOrderByRank = new Map(
        [...graph.transitionLaneRankOrder].map(([rank, ids]) => [
          rank,
          new Map(ids.map((id, index) => [id, index])),
        ]),
      );
      const nodesByRank = new Map();
      for (const node of graph.nodes) {
        if (!nodesByRank.has(node.rank)) nodesByRank.set(node.rank, []);
        nodesByRank.get(node.rank).push(node);
      }
      const authoritativeNodeOrderByRank = new Map();
      for (const [rank, nodes] of nodesByRank) {
        const sorted = [...nodes].sort(
          (a, b) => a.y0 - b.y0 || compareLifecycleIds(a.id, b.id),
        );
        authoritativeNodeOrderByRank.set(
          rank,
          new Map(sorted.map((node, index) => [node.id, index])),
        );
      }
      // seedAcceptedRouteCrossingCount is deliberately NOT captured here,
      // unlike the same-bucket discovery->final replay this mechanism was
      // originally built for. It's used as the audit's tolerance bound
      // verbatim rather than derived from *this* attempt's own budget
      // pressure, which would let a generously-tolerant previous bucket's
      // bound validate a worse layout than this bucket's own search would
      // ever accept. Omitting it simply lets candidateCallback fall through
      // to its normal, already-correct-for-this-bucket budget-pressure
      // derivation. seedLinkDocks IS still captured -- materializeLaneAssignments
      // only reproduces the seeded dock for a link's *routing* (invisible,
      // intermediate) endpoint, never a real node's, so it can't leave a
      // route ending outside a real node's current boundary; the real
      // half is always freshly computed from this pass's own geometry.
      lastLayoutSeed = {
        seedAssignments: new Map(
          graph.links.map((link) => [link.id, link.transitionLaneY]),
        ),
        seedRankOrderByRank: graph.transitionLaneRankOrder,
        seedHandles: graph.acceptedHandles,
        seedLinkDocks: new Map(
          graph.links.map((link) => [link.id, { y0: link.y0, y1: link.y1 }]),
        ),
        authoritativeBranchOrderByRank,
        authoritativeNodeOrderByRank,
      };
    }
    const { width, height } = dimensions;
    const finiteNode = (node) =>
      [node.x0, node.x1, node.y0, node.y1].every(Number.isFinite);
    const finiteLink = (link) =>
      finiteNode(link.source) &&
      finiteNode(link.target) &&
      Number.isFinite(link.width ?? 0) &&
      link.target.rank === link.source.rank + 1;
    const visibleNodes = graph.nodes.filter(
      (n) => !n.routing && n.total > 0 && finiteNode(n),
    );
    const segmentsByBranch = new Map();
    for (const link of graph.links.filter(
      (l) => l.value > 0 && finiteLink(l),
    )) {
      if (!segmentsByBranch.has(link.branchId))
        segmentsByBranch.set(link.branchId, []);
      segmentsByBranch.get(link.branchId).push(link);
    }
    const branches = graph.branches
      .filter((branch) => segmentsByBranch.has(branch.id))
      .sort(compareBranches);
    let handles;
    try {
      // Handle placement is not a pure function of lane geometry -- a
      // fresh, independent search over the exact same accepted geometry
      // can land on a different assignment, or fail outright, even though
      // layoutLifecycleRoutingGraph's own internal search already found a
      // legal one (see
      // docs/design/lifecycle-diagram-handle-search-seeding-plan.md).
      // Reuse graph.acceptedHandles directly when it covers every branch
      // this render needs, instead of re-deriving via a second,
      // independent assignBranchHandles() call.
      if (
        graph.acceptedHandles &&
        branches.every((branch) => graph.acceptedHandles.has(branch.id))
      ) {
        handles = graph.acceptedHandles;
      } else {
        handles = new Map(
          assignBranchHandles(
            branches,
            segmentsByBranch,
            visibleNodes,
            dimensions.horizontalGeometry,
          ).map((h) => [h.branchId, h]),
        );
      }
    } catch (error) {
      console.error(
        "Lifecycle diagram layout failed",
        error?.message,
        JSON.stringify(error?.cause),
      );
      showDiagramFallback("Unable to lay out lifecycle diagram.");
      return;
    }

    // svg/branchGroupEl/handleGroupEl are created once and reused across
    // renders (a scrub tick, click, or resize no longer tears down and
    // rebuilds the whole SVG). branchGroupEl must stay appended before
    // handleGroupEl -- an existing test asserts the visible-link group's
    // DOM index is less than the link-hit group's.
    if (!diagramSvg) {
      scroll.textContent = "";
      diagramSvg = svgEl("svg", {
        role: "img",
        "aria-labelledby": `${ids.title} ${ids.desc}`,
      });
      diagramSvg.append(svgEl("title", { id: ids.title }));
      diagramSvg.querySelector("title").textContent =
        "Lifecycle Sankey diagram";
      diagramSvg.append(svgEl("desc", { id: ids.desc }));
      diagramSvg.querySelector("desc").textContent =
        "Application counts flowing through protected adjacent-rank lifecycle branches. " +
        "Equivalent tables follow.";
      branchGroupEl = svgEl("g", { fill: "none" });
      handleGroupEl = svgEl("g", { fill: "none" });
      diagramSvg.append(branchGroupEl, handleGroupEl);
      scroll.append(diagramSvg);
    }
    diagramSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    diagramSvg.setAttribute("width", width);
    diagramSvg.setAttribute("height", height);
    diagramSvg.setAttribute(
      "data-reduced-motion",
      reduceMotion?.matches ? "true" : "false",
    );

    const processedBranchKeys = new Set();
    const orderedBranchGroups = [];
    const orderedHandleCircles = [];
    for (const branch of branches) {
      const segments = segmentsByBranch
        .get(branch.id)
        .sort((a, b) => a.segmentIndex - b.segmentIndex);
      const pathData = compoundBranchPath(
        segments,
        dimensions.horizontalGeometry,
      );
      if (!pathData || /NaN|Infinity/u.test(pathData)) continue;
      processedBranchKeys.add(branch.id);
      currentBranchByKey.set(branch.id, branch);
      const selected = selectedFeature?.id === branch.id;
      const widthPx = Math.max(
        3,
        ...segments.map((segment) => renderedBranchStrokeWidth(segment.width)),
      );
      const handle = handles.get(branch.id);
      const signature = branchSignature(branch, pathData, widthPx, handle);
      const stored = branchElementsByKey.get(branch.id);
      const previousSignature = branchSignatureByKey.get(branch.id);
      let group;
      let handleCircle;

      if (stored && sameSignature(previousSignature, signature)) {
        group = stored.group;
        handleCircle = stored.handleCircle;
        if (stored.selected !== selected) {
          group.setAttribute("data-selected", selected ? "true" : "false");
          stored.path.setAttribute(
            "data-selected",
            selected ? "true" : "false",
          );
          stored.path.setAttribute(
            "stroke-opacity",
            selected ? "1" : String(BRANCH_STROKE_OPACITY),
          );
          if (selected && !stored.hasHalo) {
            const halo = svgEl("path", {
              d: pathData,
              stroke: "#F8FAFC",
              "stroke-width": widthPx + 12,
              "pointer-events": "none",
              "aria-hidden": "true",
              "data-diagram-branch-halo": branch.id,
            });
            group.insertBefore(halo, group.firstChild);
            stored.hasHalo = true;
          } else if (!selected && stored.hasHalo) {
            group.querySelector("[data-diagram-branch-halo]")?.remove();
            stored.hasHalo = false;
          }
          stored.selected = selected;
        }
      } else {
        if (stored) {
          stored.group.remove();
          stored.handleCircle?.remove();
        }
        const branchLabel = branchLabelFor(branch);
        group = svgEl("g", {
          "data-diagram-branch-group": branch.id,
          "data-selected": selected ? "true" : "false",
        });
        let hasHalo = false;
        if (selected) {
          group.append(
            svgEl("path", {
              d: pathData,
              stroke: "#F8FAFC",
              "stroke-width": widthPx + 12,
              "pointer-events": "none",
              "aria-hidden": "true",
              "data-diagram-branch-halo": branch.id,
            }),
          );
          hasHalo = true;
        }
        group.append(
          svgEl("path", {
            d: pathData,
            stroke: "#020617",
            "stroke-width": widthPx + 6,
            "pointer-events": "none",
            "aria-hidden": "true",
            "data-diagram-branch-separator": branch.id,
          }),
        );
        const path = svgEl("path", {
          d: pathData,
          stroke: branch.color,
          "stroke-width": widthPx,
          "stroke-opacity": selected ? "1" : String(BRANCH_STROKE_OPACITY),
          "data-diagram-link": branch.id,
          "data-diagram-branch": branch.id,
          "data-semantic-link-id": branch.semanticLinkId,
          "data-endpoint-id": branch.endpointId,
          "data-source-node-id": branch.source,
          "data-target-node-id": branch.target,
          "data-selected": selected ? "true" : "false",
          "data-segment-ranks": segments
            .map((segment) => `${segment.source.rank}-${segment.target.rank}`)
            .join(","),
        });
        path.append(svgEl("title"));
        path.querySelector("title").textContent = branchLabel;
        path.addEventListener("click", (event) => {
          event.stopPropagation();
          selectBranchByKey(branch.id);
        });
        path.addEventListener("touchend", (event) => {
          event.preventDefault();
          event.stopPropagation();
          selectBranchByKey(branch.id);
        });
        group.append(path);
        handleCircle = null;
        if (handle) {
          handleCircle = svgEl("circle", {
            cx: handle.x,
            cy: handle.y,
            r: handle.radius,
            fill: "transparent",
            "pointer-events": "all",
            "data-diagram-link-hit": branch.id,
            "data-diagram-branch-handle": branch.id,
            "aria-hidden": "true",
          });
          handleCircle.addEventListener("click", (event) => {
            event.stopPropagation();
            selectBranchByKey(branch.id);
          });
          handleCircle.addEventListener("touchend", (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectBranchByKey(branch.id);
          });
          handleCircle.addEventListener("pointerup", (event) => {
            event.stopPropagation();
            selectBranchByKey(branch.id);
          });
        }
        branchElementsByKey.set(branch.id, {
          group,
          path,
          handleCircle,
          hasHalo,
          selected,
        });
        branchSignatureByKey.set(branch.id, signature);
      }
      orderedBranchGroups.push(group);
      if (handleCircle) orderedHandleCircles.push(handleCircle);
    }
    for (const [key, stored] of [...branchElementsByKey]) {
      if (processedBranchKeys.has(key)) continue;
      stored.group.remove();
      stored.handleCircle?.remove();
      branchElementsByKey.delete(key);
      branchSignatureByKey.delete(key);
      currentBranchByKey.delete(key);
    }
    // Reconcile order only after stale keys are removed, so a removed
    // element that's still momentarily in the DOM can't cause an
    // unnecessary extra move while walking the desired sequence.
    reconcileChildOrder(branchGroupEl, orderedBranchGroups);
    reconcileChildOrder(handleGroupEl, orderedHandleCircles);

    try {
      const processedNodeKeys = new Set();
      const orderedNodeGroups = [];
      for (const node of visibleNodes) {
        const rawWidth = node.x1 - node.x0;
        const rawHeight = node.y1 - node.y0;
        // Symmetric to the branch loop's pathData NaN/Infinity skip above:
        // degenerate (non-positive) geometry is a layout-bug symptom, not
        // something to paper over with the minimum-size floor below.
        if (!(rawWidth > 0) || !(rawHeight > 0)) continue;
        processedNodeKeys.add(node.id);
        currentNodeByKey.set(node.id, node);
        const selected = selectedFeature?.id === node.id;
        const signature = nodeSignature(node);
        const stored = nodeElementsByKey.get(node.id);
        const previousSignature = nodeSignatureByKey.get(node.id);
        let g;

        if (stored && sameSignature(previousSignature, signature)) {
          g = stored.group;
          if (stored.selected !== selected) {
            stored.rect.setAttribute(
              "stroke",
              selected ? "#F8FAFC" : "#e2e8f0",
            );
            stored.rect.setAttribute("stroke-width", selected ? "4" : "1");
            g.setAttribute("data-selected", selected ? "true" : "false");
            stored.selected = selected;
          }
        } else {
          if (stored) stored.group.remove();
          const nodeLabel = nodeLabelFor(node);
          g = svgEl("g", {
            "data-diagram-node": node.id,
            "data-selected": selected ? "true" : "false",
          });
          const rect = svgEl("rect", {
            x: node.x0,
            y: node.y0,
            width: Math.max(8, rawWidth),
            height: Math.max(8, rawHeight),
            rx: 4,
            fill: node.id.startsWith("endpoint:")
              ? endpointColor(node.id.split(":").at(-1))
              : "#64748b",
            stroke: selected ? "#F8FAFC" : "#e2e8f0",
            "stroke-width": selected ? "4" : "1",
          });
          g.append(svgEl("title"));
          g.querySelector("title").textContent = nodeLabel;
          const hitBox = rendererHitBoxForNode(
            node,
            dimensions.horizontalGeometry,
          );
          const hitRect = svgEl("rect", {
            x: hitBox.x,
            y: hitBox.y,
            width: hitBox.width,
            height: hitBox.height,
            fill: "transparent",
            "pointer-events": "all",
            "aria-hidden": "true",
            "data-diagram-node-hit": node.id,
          });
          hitRect.addEventListener("click", (event) => {
            event.stopPropagation();
            selectNodeByKey(node.id);
          });
          hitRect.addEventListener("touchend", (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectNodeByKey(node.id);
          });
          hitRect.addEventListener("pointerup", (event) => {
            event.stopPropagation();
            selectNodeByKey(node.id);
          });
          rect.addEventListener("click", (event) => {
            event.stopPropagation();
            selectNodeByKey(node.id);
          });
          rect.addEventListener("touchend", (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectNodeByKey(node.id);
          });
          rect.addEventListener("pointerup", (event) => {
            event.stopPropagation();
            selectNodeByKey(node.id);
          });
          const labelBox = labelBoxForNode(node, dimensions.horizontalGeometry);
          const label = svgEl("text", {
            x: labelBox.x + labelBox.width / 2,
            y: labelBox.y + 12,
            "text-anchor": "middle",
            fill: "currentColor",
            "data-diagram-node-label": node.id,
          });
          wrapLifecycleLabel(node.label).forEach((line, index) => {
            const tspan = svgEl("tspan", {
              x: labelBox.x + labelBox.width / 2,
              dy: index ? "1.1em" : "0",
            });
            tspan.textContent = line;
            label.append(tspan);
          });
          label.addEventListener("click", (event) => {
            event.stopPropagation();
            selectNodeByKey(node.id);
          });
          g.append(hitRect, rect, label);
          nodeElementsByKey.set(node.id, { group: g, rect, selected });
          nodeSignatureByKey.set(node.id, signature);
        }
        orderedNodeGroups.push(g);
      }
      for (const [key, stored] of [...nodeElementsByKey]) {
        if (processedNodeKeys.has(key)) continue;
        stored.group.remove();
        nodeElementsByKey.delete(key);
        nodeSignatureByKey.delete(key);
        currentNodeByKey.delete(key);
      }
      // Node groups are diagramSvg's direct children too, appended after
      // title/desc/branchGroupEl/handleGroupEl -- reconcile only the range
      // starting right after handleGroupEl so those earlier, static
      // children are never touched.
      reconcileChildOrder(diagramSvg, orderedNodeGroups, handleGroupEl);
    } catch (error) {
      console.error(
        "Lifecycle diagram layout failed",
        error?.message,
        JSON.stringify(error?.cause),
      );
      showDiagramFallback("Unable to lay out lifecycle diagram.");
      return;
    }
  };
  const renderTables = () => {
    const activeLabel =
      document.activeElement instanceof window.HTMLElement
        ? document.activeElement.getAttribute("aria-label")
        : null;
    const total = projection.includedApplications;
    const makeNodeRows = (entries, namespace) =>
      LIFECYCLE_DIAGRAM_TAXONOMY[`${namespace}s`].map(({ id, label }) => {
        const value = entries[id] ?? 0;
        const nodeId = `${namespace}:${id}`;
        const applicationIds = unique(
          projection.paths
            .filter((path) => path.nodeIds.includes(nodeId))
            .map((path) => path.applicationId),
        );
        return {
          cells: [label, String(value), pct(value, total)],
          label: `Select ${label}`,
          id: nodeId,
          onSelect: () =>
            selectFeature({
              id: nodeId,
              label: `${label}: ${value}`,
              applicationIds,
            }),
        };
      });
    const originRows = makeNodeRows(projection.totals.origins, "origin");
    const milestoneRows = makeNodeRows(
      projection.totals.milestones,
      "milestone",
    );
    const endpointRows = makeNodeRows(projection.totals.endpoints, "endpoint");
    const linkRows = displayBranches.map((branch) => {
      const from = TAXONOMY.get(branch.source)?.label ?? branch.source;
      const to = TAXONOMY.get(branch.target)?.label ?? branch.target;
      const outcome =
        LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.find(
          (endpoint) => endpoint.id === branch.endpointId,
        )?.label ?? branch.endpointId;
      const flowLabel = `${from} to ${to}`;
      return {
        cells: [
          flowLabel,
          outcome,
          String(branch.value),
          pct(branch.value, total),
        ],
        label: `Select flow ${flowLabel}, outcome ${outcome}`,
        id: branch.id,
        onSelect: () =>
          selectFeature({
            id: branch.id,
            label: `${flowLabel}, outcome ${outcome}: ${branch.value}`,
            applicationIds: branch.applicationIds,
          }),
      };
    });
    const flowPageData = pageSlice(linkRows, flowPage);
    flowPage = flowPageData.page;
    const eventPageData = pageSlice(projection.events, eventPage);
    eventPage = eventPageData.page;
    const eventRows = eventPageData.items.map((event) => {
      const formatted = formatEventTime(event);
      return {
        cells: [
          event.id,
          event.applicationId,
          event.eventType,
          formatted.label,
        ],
        time: formatted,
      };
    });
    tables.textContent = "";
    tables.append(
      renderTable("Origins", ["Origin", "Count", "Percentage"], originRows),
      renderTable(
        "Milestones",
        ["Milestone", "Count", "Percentage"],
        milestoneRows,
      ),
      renderTable(
        "Endpoints",
        ["Endpoint", "Count", "Percentage"],
        endpointRows,
      ),
      renderTable(
        "Flows",
        ["Flow", "Outcome", "Applications", "Percentage"],
        flowPageData.items,
      ),
      (() => {
        const prevFlow = el("button", {
          type: "button",
          className: "button",
          textContent: "Previous flow page",
          "aria-label": "Previous flow page",
        });
        const nextFlow = el("button", {
          type: "button",
          className: "button",
          textContent: "Next flow page",
          "aria-label": "Next flow page",
        });
        prevFlow.disabled = flowPageData.page <= 0;
        nextFlow.disabled = flowPageData.page >= flowPageData.maxPage;
        prevFlow.addEventListener("click", () => {
          flowPage -= 1;
          renderTables();
        });
        nextFlow.addEventListener("click", () => {
          flowPage += 1;
          renderTables();
        });
        return el(
          "div",
          { className: "diagram-pagination", "data-flow-pagination": "" },
          [
            el("span", {
              "data-flow-range": "",
              textContent:
                `Flows ${flowPageData.start}–${flowPageData.end} ` +
                `of ${flowPageData.total}`,
            }),
            prevFlow,
            nextFlow,
          ],
        );
      })(),
      renderTable(
        "Selected-boundary events",
        ["Event", "Application", "Type", "Timestamp"],
        eventRows,
      ),
      (() => {
        const prevEvent = el("button", {
          type: "button",
          className: "button",
          textContent: "Previous event page",
          "aria-label": "Previous event page",
        });
        const nextEvent = el("button", {
          type: "button",
          className: "button",
          textContent: "Next event page",
          "aria-label": "Next event page",
        });
        prevEvent.disabled = eventPageData.page <= 0;
        nextEvent.disabled = eventPageData.page >= eventPageData.maxPage;
        prevEvent.addEventListener("click", () => {
          eventPage -= 1;
          renderTables();
        });
        nextEvent.addEventListener("click", () => {
          eventPage += 1;
          renderTables();
        });
        return el(
          "div",
          { className: "diagram-pagination", "data-event-pagination": "" },
          [
            el("span", {
              "data-event-range": "",
              textContent:
                `Events ${eventPageData.start}–${eventPageData.end} ` +
                `of ${eventPageData.total}`,
            }),
            prevEvent,
            nextEvent,
          ],
        );
      })(),
    );
    if (activeLabel)
      tables.querySelectorAll("[aria-label]").forEach((element) => {
        if (element.getAttribute("aria-label") === activeLabel) element.focus();
      });
  };
  const render = (newerAvailable = lastNewerAvailable) => {
    // Bumped unconditionally, before either branch below -- see
    // renderGeneration's own comment for why both need it, not just the
    // deferred (non-drag) path.
    const myGeneration = ++renderGeneration;
    lastNewerAvailable = newerAvailable;
    const buckets = timeline.buckets?.length
      ? timeline.buckets
      : [{ id: "current", kind: "current", label: "Current" }];
    const index = Math.max(
      0,
      buckets.findIndex((bucket) => bucket.id === selectedId),
    );
    range.max = String(Math.max(0, buckets.length - 1));
    range.value = String(index);
    range.setAttribute("aria-valuetext", bucketValueText(buckets[index]));
    prev.disabled = index <= 0;
    next.disabled = index >= buckets.length - 1;
    current.disabled = selectedId === "current";
    badge.textContent =
      selectedId === "current"
        ? "Current"
        : `Historical${newerAvailable ? " · Newer activity available" : ""}`;
    count.textContent =
      `${projection.includedApplications}/${projection.totalApplications} ` +
      "applications included";
    const ts = formatTimestamp(projection.bucket, projection);
    stamp.textContent = "";
    stamp.append(
      ts.datetime
        ? el("time", { datetime: ts.datetime, textContent: ts.label })
        : document.createTextNode(ts.label),
    );
    announce(
      `${badge.textContent}. ${count.textContent}. ${bucketValueText(projection.bucket)}`,
    );
    const boundaryBuckets = projection.events.reduce((map, event) => {
      if (
        projection.bucket.kind === "current" ||
        projection.bucket.kind === "unknown-date" ||
        isUnknownPrecision(event.occurredAtPrecision) ||
        !event.occurredAt
      )
        return map;
      const key = `${event.occurredAtPrecision}:${event.occurredAt}`;
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map());
    const sharedBoundary = [...boundaryBuckets.values()].some((n) => n > 1);
    simultaneous.querySelector("summary").textContent = sharedBoundary
      ? "Simultaneous selected-boundary events"
      : "Selected-boundary events";
    simultaneous.querySelector("[data-boundary-events]").textContent =
      projection.events.map((e) => `${e.id}: ${e.eventType}`).join("; ") ||
      "No boundary events.";
    // dragActive is read here, synchronously, before any await -- stable
    // for this whole invocation regardless of what happens later (a
    // pointerdown mid-await can't retroactively change which path this
    // particular call already committed to).
    const runPhaseB = async () => {
      renderDetails();
      if (dragActive) {
        renderSvg();
      } else if (!(await renderSvgAsync(myGeneration))) {
        // Superseded mid-await -- skip the now-redundant renderTables() too
        // (harmless either way since it doesn't depend on the layout
        // result, but this keeps "stale means untouched" easy to verify).
        return;
      }
      renderTables();
    };
    // Drag ticks (Phase 4a/4b) are already fast and stay fully synchronous,
    // unchanged by this deferral -- flickering the busy indicator every
    // ~100ms during a drag would be distracting, not helpful. A drag tick
    // can start while an earlier non-drag render is still deferred (e.g. a
    // pointerdown right after a prev/next click) -- cancel that pending
    // Phase B and clear the busy state first, or its rAF would still fire
    // later and overwrite this tick's synchronous output with stale data.
    if (dragActive) {
      cancelPendingRender();
      busyIndicator.hidden = true;
      scroll.setAttribute("aria-busy", "false");
      return runPhaseB();
    }
    return runDeferred(runPhaseB, myGeneration);
  };
  const changeToIndex = (index) => {
    const bucket = timeline.buckets[index];
    if (bucket) onBucketChange(bucket.id);
  };
  // Resolve the bucket *id* from the timeline at input-event time and
  // debounce that id, rather than debouncing a raw index and resolving it
  // against `timeline` later: `update()` can reassign `timeline` (e.g. a
  // background refresh inserting a bucket) before the 80ms timer fires,
  // which would otherwise shift what an unresolved index points to and
  // silently select a different bucket than the one the user dragged to.
  const debouncedRangeChange = makeDebounce((bucketId) => {
    if (bucketId) onBucketChange(bucketId);
  });
  // A newer explicit prev/next/current action always wins over an older
  // pending drag — without this, clicking a discrete control while a scrub
  // debounce is still pending would let the stale drag overwrite the newer
  // selection once its timer caught up.
  prev.addEventListener("click", () => {
    debouncedRangeChange.clear();
    changeToIndex(Number(range.value) - 1);
  });
  next.addEventListener("click", () => {
    debouncedRangeChange.clear();
    changeToIndex(Number(range.value) + 1);
  });
  current.addEventListener("click", () => {
    debouncedRangeChange.clear();
    onBucketChange("current");
  });
  range.addEventListener("input", () => {
    const bucketId = timeline.buckets[Number(range.value)]?.id;
    lastDragTickBucketId = bucketId ?? null;
    debouncedRangeChange(bucketId);
  });
  // Draft-quality rendering (see renderSvg()'s qualityTier option) is only
  // used between a pointerdown and its matching release on the scrubber
  // itself -- keyboard-driven arrow-key stepping produces "input" events
  // with no preceding pointerdown, so it's unaffected by construction and
  // always renders full quality, same as today.
  range.addEventListener("pointerdown", () => {
    dragActive = true;
    lastDragTickBucketId = null;
  });
  const releaseDrag = () => {
    if (!dragActive) return;
    dragActive = false;
    // Same "cancel the pending debounce, then do the authoritative thing
    // synchronously" pattern prev/next/current already use -- guarantees
    // the frame left on screen after release is always full quality, never
    // whatever draft-tier layout the last drag tick happened to produce.
    // Resolves the bucket *id* captured at the last input tick rather than
    // changeToIndex(range.value)'s raw index, for the same reason the
    // "input" listener above resolves an id up front instead of debouncing
    // a raw index. No captured id (pointerdown/pointerup with no drag
    // movement in between) means nothing changed -- no bucket change to
    // apply.
    debouncedRangeChange.clear();
    if (lastDragTickBucketId) onBucketChange(lastDragTickBucketId);
    lastDragTickBucketId = null;
  };
  // Range inputs get implicit pointer capture while dragging in evergreen
  // browsers, so pointerup fires on `range` itself even if the pointer moved
  // off it before release; pointercancel is a safety net for capture loss
  // (e.g. an OS-level interruption mid-drag).
  range.addEventListener("pointerup", releaseDrag);
  range.addEventListener("pointercancel", releaseDrag);
  const sanitizedRootWidth = () => {
    const width = Math.floor(Number(root.clientWidth));
    return Number.isFinite(width) && width > 0 ? width : 0;
  };
  const debouncedResize = makeDebounce(() => {
    const nextWidth = sanitizedRootWidth();
    if (nextWidth === lastLayoutWidth) return;
    lastLayoutWidth = nextWidth;
    render(lastNewerAvailable);
  });
  resizeObserver = window.ResizeObserver
    ? new ResizeObserver((entries) => {
        const entryWidth = Math.floor(
          Number(entries?.[0]?.contentRect?.width ?? root.clientWidth),
        );
        const nextWidth =
          Number.isFinite(entryWidth) && entryWidth > 0 ? entryWidth : 0;
        if (nextWidth !== lastLayoutWidth) debouncedResize();
      })
    : undefined;
  if (resizeObserver) resizeObserver.observe(root);
  else {
    windowResizeHandler = debouncedResize;
    window.addEventListener("resize", windowResizeHandler);
  }
  return {
    update({
      timeline: nextTimeline,
      snapshot,
      selectedBucketId = "current",
      newerAvailable = false,
    }) {
      const nextProjection = snapshot ?? EMPTY_PROJECTION;
      const bucketChanged = selectedId !== selectedBucketId;
      const snapshotChanged = projection !== nextProjection;
      const previousSelectionId = selectedFeature?.id;
      timeline = nextTimeline ?? { buckets: [] };
      selectedId = selectedBucketId;
      projection = nextProjection;
      displayBranches = buildLifecycleDisplayBranches(projection);
      lastLayoutWidth = sanitizedRootWidth();
      if (bucketChanged) {
        selectedFeature = null;
        eventPage = 0;
        flowPage = 0;
      } else if (snapshotChanged) {
        eventPage = 0;
        flowPage = 0;
        if (previousSelectionId)
          selectedFeature = featureById(previousSelectionId);
      } else if (previousSelectionId)
        selectedFeature = featureById(previousSelectionId);
      return render(newerAvailable);
    },
    announce(message) {
      announce(message);
    },
    destroy() {
      resizeObserver?.disconnect();
      if (windowResizeHandler)
        window.removeEventListener("resize", windowResizeHandler);
      debouncedResize.clear();
      debouncedRangeChange.clear();
      announce.clear();
      cancelPendingRender();
      // A caller awaiting an in-flight Worker call must not hang forever
      // just because the view was torn down mid-request.
      rejectAllPendingLayoutRequests(
        new Error("Lifecycle diagram view destroyed."),
      );
      layoutWorker?.terminate();
      layoutWorker = null;
      root.textContent = "";
    },
  };
}
