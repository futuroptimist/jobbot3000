/* global document, window, ResizeObserver */
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { LIFECYCLE_DIAGRAM_TAXONOMY } from "./lifecycleProjection.js";

const NS = "http://www.w3.org/2000/svg";
const columns = new Map([
  ...LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((n) => [n.nodeId, 0]),
  ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((n, i) => [n.nodeId, i + 1]),
  ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((n) => [n.nodeId, 6]),
]);
const fmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "long",
});
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "0%");
const el = (tag, attrs = {}, text) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs))
    if (v !== undefined) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};
const labelFor = (id) =>
  [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
  ].find((x) => x.nodeId === id)?.label ?? id;
const bucketText = (bucket, projection) => {
  if (!bucket || bucket.id === "current") {
    const known = (projection?.events ?? []).filter(
      (e) => e.occurredAt && e.occurredAtPrecision !== "unknown",
    );
    const latest = known
      .map((e) => Date.parse(e.occurredAt))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    const suffix = latest
      ? `, latest known event time ${fmt.format(new Date(latest))}`
      : "";
    const unknownCount = projection?.warningCounts?.invalid_timestamp ?? 0;
    return `Current — latest data in this browser${suffix}; unknown-time count ${unknownCount}`;
  }
  if (bucket.kind === "unknown-date")
    return "Unknown date — off chronological scale";
  if (bucket.kind === "date") return `${bucket.label}`;
  const iso = String(bucket.label ?? bucket.id)
    .split("|")
    .pop();
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? fmt.format(new Date(ms))
    : String(bucket.label ?? bucket.id);
};

export function createLifecycleDiagramView(root, options = {}) {
  let selectedId = "current",
    selectedDatum,
    last,
    ro,
    timer;
  root.classList.add("lifecycle-diagram");
  const controls = el("div", { class: "diagram-controls" });
  const prev = el(
    "button",
    { type: "button", class: "button", "data-diagram-prev": "" },
    "Previous event",
  );
  const rangeLabel = el(
    "label",
    { class: "diagram-range-label" },
    "Lifecycle scrubber",
  );
  const range = el("input", {
    type: "range",
    min: "0",
    value: "0",
    "aria-label": "Lifecycle event bucket",
  });
  rangeLabel.append(range);
  const next = el(
    "button",
    { type: "button", class: "button", "data-diagram-next": "" },
    "Next event",
  );
  const current = el(
    "button",
    { type: "button", class: "button", "data-diagram-current": "" },
    "Return to current",
  );
  const badge = el("span", { class: "chip", "data-diagram-badge": "" });
  const count = el("span", { class: "chip", "data-diagram-count": "" });
  controls.append(prev, rangeLabel, next, current, badge, count);
  const time = el("p", { class: "muted", "data-diagram-time": "" });
  const live = el("p", {
    class: "muted",
    "aria-live": "polite",
    "data-diagram-live": "",
  });
  const disclosure = el("details", { "data-diagram-simultaneous": "" });
  disclosure.append(
    el("summary", {}, "Simultaneous events"),
    el("p", { class: "muted" }),
  );
  const scroller = el("div", {
    class: "diagram-scroll",
    tabindex: "0",
    role: "region",
    "aria-label": "Scrollable lifecycle diagram",
  });
  const details = el("section", {
    class: "card",
    "data-diagram-selection": "",
  });
  const tables = el("div", { class: "diagram-tables" });
  root.replaceChildren(
    controls,
    time,
    live,
    disclosure,
    scroller,
    details,
    tables,
  );
  const choose = (id) => options.onSelectBucket?.(id);
  prev.addEventListener("click", () => {
    if (last)
      choose(last.timeline.buckets[Math.max(0, range.valueAsNumber - 1)]?.id);
  });
  next.addEventListener("click", () => {
    if (last)
      choose(
        last.timeline.buckets[
          Math.min(last.timeline.buckets.length - 1, range.valueAsNumber + 1)
        ]?.id,
      );
  });
  current.addEventListener("click", () => choose("current"));
  range.addEventListener("input", () => {
    if (last) choose(last.timeline.buckets[range.valueAsNumber]?.id);
  });
  const resize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => last && draw(last), 80);
  };
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(resize);
    ro.observe(root);
  } else window.addEventListener("resize", resize);

  function draw(payload) {
    last = payload;
    const { timeline, snapshot, selectedBucketId, newerAvailable } = payload;
    const buckets = timeline?.buckets ?? [];
    const index = Math.max(
      0,
      buckets.findIndex((b) => b.id === selectedBucketId),
    );
    const bucket = buckets[index] ?? { id: "current", label: "Current" };
    range.max = String(Math.max(0, buckets.length - 1));
    range.value = String(index);
    range.disabled = buckets.length <= 1;
    prev.disabled = index <= 0;
    next.disabled = index >= buckets.length - 1;
    current.disabled = bucket.id === "current";
    range.setAttribute("aria-valuetext", bucketText(bucket, snapshot));
    badge.textContent =
      bucket.id === "current"
        ? "Current"
        : newerAvailable
          ? "Historical · Newer activity available"
          : "Historical";
    const includedCount = snapshot.includedApplications ?? 0;
    const totalCount = snapshot.totalApplications ?? 0;
    count.textContent = `${includedCount}/${totalCount} applications`;
    const dt =
      bucket.id === "current"
        ? new Date().toISOString()
        : (bucket.cutoff?.split("|").pop() ?? "");
    time.replaceChildren(
      el("time", dt ? { datetime: dt } : {}, bucketText(bucket, snapshot)),
    );
    clearTimeout(timer);
    timer = setTimeout(() => {
      const visibleTime = bucketText(bucket, snapshot);
      live.textContent = `${badge.textContent}: ${count.textContent}. ${visibleTime}`;
    }, 120);
    disclosure.hidden = (snapshot.events ?? []).length <= 1;
    disclosure.querySelector("p").textContent =
      `${(snapshot.events ?? []).length} boundary events share this selection.`;
    renderSvg(snapshot);
    renderTables(snapshot);
    renderSelection();
  }
  function renderSvg(snapshot) {
    scroller.replaceChildren();
    if (!snapshot.totalApplications) {
      scroller.append(
        el("p", { class: "muted" }, "No diagram applications yet."),
      );
      return;
    }
    if (!snapshot.nodes?.length) {
      scroller.append(
        el(
          "p",
          { class: "muted" },
          "No lifecycle diagram data for this bucket.",
        ),
      );
      return;
    }
    const width = Math.max(760, root.clientWidth || 760),
      height = Math.max(320, snapshot.nodes.length * 34);
    const nodes = snapshot.nodes.map((n) => ({ ...n, value: n.total }));
    const links = snapshot.links.map((l) => ({ ...l }));
    const graph = sankey()
      .nodeId((d) => d.id)
      .nodeWidth(16)
      .nodePadding(14)
      .extent([
        [16, 28],
        [width - 24, height - 24],
      ])({ nodes, links });
    for (const n of graph.nodes) {
      const x = 16 + (columns.get(n.id) ?? 0) * ((width - 56) / 6);
      n.x0 = x;
      n.x1 = x + 16;
    }
    sankey()
      .nodeId((d) => d.id)
      .update(graph);
    const svg = svgEl("svg", {
      role: "img",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "aria-labelledby": "lifecycle-diagram-title lifecycle-diagram-desc",
    });
    const title = svgEl("title", { id: "lifecycle-diagram-title" });
    title.textContent = "Application lifecycle Sankey diagram";
    const desc = svgEl("desc", { id: "lifecycle-diagram-desc" });
    desc.textContent =
      "Application counts flow from origins through milestones to endpoints. " +
      "Equivalent data tables follow.";
    svg.append(title, desc);
    for (const l of graph.links
      .filter((x) => x.value > 0)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const path = svgEl("path", {
        d: sankeyLinkHorizontal()(l),
        class: `diagram-link${selectedId === l.id ? " is-selected" : ""}`,
        stroke: "#38bdf8",
        "stroke-width": Math.max(3, l.width),
        fill: "none",
        "data-id": l.id,
      });
      const pathTitle = svgEl("title");
      pathTitle.textContent = `${labelFor(l.source.id)} to ${labelFor(
        l.target.id,
      )}: ${l.value} applications`;
      path.append(pathTitle);
      path.addEventListener("click", () => {
        selectedId = l.id;
        selectedDatum = l;
        draw(last);
      });
      svg.append(path);
    }
    for (const n of graph.nodes
      .filter((x) => x.value > 0)
      .sort(
        (a, b) =>
          columns.get(a.id) - columns.get(b.id) ||
          String(a.id).localeCompare(String(b.id)),
      )) {
      const g = svgEl("g", {
        class: selectedId === n.id ? "is-selected" : "",
        "data-id": n.id,
      });
      const rect = svgEl("rect", {
        x: n.x0,
        y: n.y0,
        width: n.x1 - n.x0,
        height: Math.max(8, n.y1 - n.y0),
        fill: "#fbbf24",
        stroke: selectedId === n.id ? "#fff" : "#111827",
      });
      rect.addEventListener("click", () => {
        selectedId = n.id;
        selectedDatum = n;
        draw(last);
      });
      g.append(
        rect,
        svgEl("text", {
          x: n.x1 + 6,
          y: Math.max(12, n.y0 + 14),
          fill: "currentColor",
        }),
      );
      g.querySelector("text").textContent =
        `${n.label} (${n.total ?? n.value})`;
      const nodeTitle = svgEl("title");
      nodeTitle.textContent = `${n.label}: ${n.total ?? n.value} applications`;
      g.append(nodeTitle);
      svg.append(g);
    }
    scroller.append(svg);
  }
  function row(cells, header = false) {
    const tr = el("tr");
    for (const c of cells)
      tr.append(el(header ? "th" : "td", header ? { scope: "col" } : {}, c));
    return tr;
  }
  function table(caption, heads, rows) {
    const t = el("table", { class: "tracker-table" });
    t.append(el("caption", {}, caption));
    const thead = el("thead");
    thead.append(row(heads, true));
    const tbody = el("tbody");
    rows.forEach((r) => tbody.append(row(r)));
    t.append(thead, tbody);
    return t;
  }
  function renderTables(s) {
    const originRows = Object.entries(s.totals?.origins ?? {}).map(([k, v]) => [
      labelFor(`origin:${k}`),
      String(v),
      pct(v, s.includedApplications),
    ]);
    const endpointRows = Object.entries(s.totals?.endpoints ?? {}).map(
      ([k, v]) => [
        labelFor(`endpoint:${k}`),
        String(v),
        pct(v, s.includedApplications),
      ],
    );
    const boundaryRows = (s.links ?? []).map((l) => [
      labelFor(l.source),
      labelFor(l.target),
      String(l.value),
    ]);
    const eventRows = (s.events ?? []).map((event) => [
      event.id,
      event.applicationId,
      event.eventType,
    ]);
    tables.replaceChildren(
      el("h3", {}, "Semantic lifecycle data"),
      table("Origins", ["Origin", "Count", "Percentage"], originRows),
      table("Endpoints", ["Endpoint", "Count", "Percentage"], endpointRows),
      table("Boundaries", ["From", "To", "Application count"], boundaryRows),
      table(
        "Selected-boundary events",
        ["Event", "Application", "Type"],
        eventRows,
      ),
    );
    tables.append(el("p", { class: "muted" }, warningText(s)));
    tables.querySelectorAll("tbody tr").forEach((tr) => {
      const b = el("button", { type: "button", class: "button" }, "Select");
      b.addEventListener("click", () => {
        selectedId = tr.textContent;
        selectedDatum = { id: selectedId, value: 0 };
        renderSelection();
      });
      tr.append(el("td"));
      tr.lastChild.append(b);
    });
  }
  function warningText(s) {
    const inferred = s.warningCounts?.inferred_event ?? 0;
    const unknown =
      (s.warningCounts?.inferred_origin ?? 0) +
      (s.warningCounts?.invalid_timestamp ?? 0);
    const mismatch = s.warningCounts?.status_mismatch ?? 0;
    const regression = s.warningCounts?.regressive_history ?? 0;
    return (
      `Warnings: inferred history ${inferred}; unknown origin/time ${unknown}; ` +
      `status mismatch ${mismatch}; regression ${regression}.`
    );
  }
  function renderSelection() {
    details.replaceChildren(
      el("h3", {}, "Selection details"),
      el(
        "p",
        {},
        selectedDatum
          ? selectionText()
          : "Select a node, ribbon, or table row for drilldown.",
      ),
    );
  }
  function selectionText() {
    const value = selectedDatum.value ?? selectedDatum.total ?? 0;
    const total = last?.snapshot?.includedApplications ?? 0;
    return (
      `${selectedId}: ${value} applications (${pct(value, total)}). ` +
      "Observed and inferred counts reflect lifecycle warning tables. " +
      "Date range: current bucket."
    );
  }
  return {
    update: draw,
    destroy() {
      ro?.disconnect();
      window.removeEventListener("resize", resize);
      clearTimeout(timer);
      root.replaceChildren();
    },
  };
}
