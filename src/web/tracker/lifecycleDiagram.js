/* global document, ResizeObserver */
/* eslint-disable max-len */
import { sankey, sankeyJustify, sankeyLinkHorizontal } from "d3-sankey";
import { LIFECYCLE_DIAGRAM_TAXONOMY } from "./lifecycleProjection.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const COLUMNS = { origin: 0, milestone: 1, endpoint: 6 };
const codeCompare = (a, b) => String(a).localeCompare(String(b));
const percent = (value, total) =>
  total ? `${Math.round((value / total) * 100)}%` : "0%";
const el = (name, attrs = {}, text) => {
  const node = document.createElement(name);
  for (const [key, value] of Object.entries(attrs))
    if (value !== undefined) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgEl = (name, attrs = {}, text) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs))
    if (value !== undefined) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};
const taxonomy = new Map([
  ...LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((x) => [
    x.nodeId,
    { ...x, type: "origin", column: 0 },
  ]),
  ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((x) => [
    x.nodeId,
    { ...x, type: "milestone", column: x.rank + 1 },
  ]),
  ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((x) => [
    x.nodeId,
    { ...x, type: "endpoint", column: 6 },
  ]),
]);
const fmtDate = (value) => {
  if (!value) return "Unknown";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value).slice(0, 10)
    : d.toLocaleString();
};
const ariaText = (bucket) => {
  if (!bucket || bucket.id === "current")
    return "Current, latest data in this browser";
  if (bucket.id === "unknown-date")
    return "Unknown date, off chronological scale";
  return bucket.kind === "date"
    ? `${String(bucket.label).slice(0, 10)}, time not recorded`
    : fmtDate(bucket.label);
};
const cloneProjection = (snapshot) => ({
  ...snapshot,
  nodes: (snapshot?.nodes ?? []).map((n) => ({ ...n })),
  links: (snapshot?.links ?? []).map((l) => ({
    ...l,
    applicationIds: [...(l.applicationIds ?? [])],
  })),
  paths: (snapshot?.paths ?? []).map((p) => ({
    ...p,
    milestones: [...p.milestones],
    nodeIds: [...p.nodeIds],
  })),
});

export function createLifecycleDiagramView(root, options = {}) {
  const onSelectBucket = options.onSelectBucket ?? (() => {});
  let selectedId = "current";
  let selectedElementId = "";
  let projection = undefined;
  let ro;
  let liveTimer;

  root.textContent = "";
  const controls = el("div", { class: "diagram-controls" });
  const prev = el(
    "button",
    { type: "button", class: "button" },
    "Previous event",
  );
  const label = el("label", {}, "Timeline position");
  const range = el("input", { type: "range", min: "0", value: "0" });
  label.append(range);
  const next = el("button", { type: "button", class: "button" }, "Next event");
  const current = el(
    "button",
    { type: "button", class: "button" },
    "Return to current",
  );
  const badge = el(
    "span",
    { class: "pill", "data-diagram-badge": "" },
    "Current",
  );
  controls.append(prev, label, next, current, badge);
  const timestamp = el("p", { class: "muted", "data-diagram-timestamp": "" });
  const counts = el("p", { class: "muted", "data-diagram-counts": "" });
  const simultaneous = el("details", { "data-diagram-simultaneous": "" });
  const live = el("p", {
    class: "sr-only",
    role: "status",
    "aria-live": "polite",
  });
  const scroller = el("div", {
    class: "diagram-scroll",
    tabindex: "0",
    role: "region",
    "aria-label": "Scrollable lifecycle diagram",
  });
  const details = el("div", { class: "card", "data-diagram-details": "" });
  const tables = el("div", { class: "diagram-tables" });
  root.append(
    controls,
    timestamp,
    counts,
    simultaneous,
    live,
    scroller,
    details,
    tables,
  );

  const announce = (message) => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      live.textContent = message;
    }, 120);
  };
  const bucketIndex = (timeline) =>
    Math.max(
      0,
      (timeline?.buckets ?? []).findIndex((b) => b.id === selectedId),
    );
  const bucketAt = (timeline, index) =>
    timeline.buckets[Math.max(0, Math.min(timeline.buckets.length - 1, index))];
  const selectIndex = (timeline, index) => {
    const b = bucketAt(timeline, index);
    if (b) onSelectBucket(b.id);
  };
  prev.addEventListener("click", () =>
    selectIndex(lastTimeline, bucketIndex(lastTimeline) - 1),
  );
  next.addEventListener("click", () =>
    selectIndex(lastTimeline, bucketIndex(lastTimeline) + 1),
  );
  current.addEventListener("click", () => onSelectBucket("current"));
  range.addEventListener("input", () =>
    selectIndex(lastTimeline, Number(range.value)),
  );
  let lastTimeline = { buckets: [] };

  const renderSvg = () => {
    scroller.textContent = "";
    const snap = cloneProjection(projection);
    const nodes = snap.nodes
      .filter((n) => n.total > 0)
      .sort(
        (a, b) =>
          (taxonomy.get(a.id)?.column ?? 0) -
            (taxonomy.get(b.id)?.column ?? 0) || codeCompare(a.id, b.id),
      );
    const links = snap.links
      .filter((l) => l.value > 0)
      .sort((a, b) => codeCompare(a.id, b.id));
    if (!nodes.length) {
      scroller.append(
        el(
          "p",
          { class: "muted" },
          "No lifecycle paths to diagram for this bucket.",
        ),
      );
      return;
    }
    const width = Math.max(720, root.clientWidth || 720),
      height = Math.max(360, nodes.length * 38);
    const graph = {
      nodes: nodes.map((n) => ({
        ...n,
        column:
          taxonomy.get(n.id)?.column ?? COLUMNS[taxonomy.get(n.id)?.type] ?? 0,
      })),
      links: links.map((l) => ({ ...l })),
    };
    const s = sankey()
      .nodeId((d) => d.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(16)
      .nodePadding(14)
      .extent([
        [8, 8],
        [width - 180, height - 24],
      ]);
    s(graph);
    for (const n of graph.nodes) {
      const c = taxonomy.get(n.id)?.column ?? n.column;
      n.x0 = 8 + ((width - 220) * c) / 6;
      n.x1 = n.x0 + 16;
    }
    s.update(graph);
    const svg = svgEl("svg", {
      role: "img",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "aria-labelledby": "lifecycle-diagram-title lifecycle-diagram-desc",
    });
    svg.append(
      svgEl(
        "title",
        { id: "lifecycle-diagram-title" },
        "Lifecycle Sankey diagram",
      ),
    );
    svg.append(
      svgEl(
        "desc",
        { id: "lifecycle-diagram-desc" },
        "Application counts flow from origin through milestones to endpoints. Equivalent tables follow.",
      ),
    );
    for (const link of graph.links) {
      if (![link.y0, link.y1, link.width].every(Number.isFinite)) continue;
      const path = svgEl("path", {
        d: sankeyLinkHorizontal()(link),
        class: `diagram-link ${selectedElementId === link.id ? "is-selected" : ""}`,
        "data-diagram-id": link.id,
        stroke: "currentColor",
        "stroke-width": Math.max(4, link.width),
        fill: "none",
      });
      path.append(
        svgEl(
          "title",
          {},
          `${link.source.label} to ${link.target.label}: ${link.value} applications`,
        ),
      );
      path.addEventListener("click", () => {
        selectedElementId = link.id;
        renderSelection(link);
        renderSvg();
      });
      svg.append(path);
    }
    for (const node of graph.nodes) {
      if (![node.x0, node.x1, node.y0, node.y1].every(Number.isFinite))
        continue;
      const g = svgEl("g", {
        class: selectedElementId === node.id ? "is-selected" : "",
        "data-diagram-id": node.id,
      });
      const rect = svgEl("rect", {
        x: node.x0,
        y: node.y0,
        width: Math.max(16, node.x1 - node.x0),
        height: Math.max(10, node.y1 - node.y0),
        rx: "3",
      });
      rect.append(
        svgEl("title", {}, `${node.label}: ${node.total} applications`),
      );
      rect.addEventListener("click", () => {
        selectedElementId = node.id;
        renderSelection(node);
        renderSvg();
      });
      g.append(
        rect,
        svgEl(
          "text",
          {
            x: node.x1 + 6,
            y: Math.max(14, (node.y0 + node.y1) / 2),
            "dominant-baseline": "middle",
          },
          `${node.label} (${node.total})`,
        ),
      );
      svg.append(g);
    }
    scroller.append(svg);
  };
  const table = (caption, headers, rows) => {
    const t = el("table", { class: "tracker-table" });
    t.append(el("caption", {}, caption));
    const thead = el("thead"),
      tr = el("tr");
    headers.forEach((h) => tr.append(el("th", { scope: "col" }, h)));
    thead.append(tr);
    t.append(thead);
    const tbody = el("tbody");
    rows.forEach((r) => {
      const row = el("tr");
      r.forEach((c, i) =>
        row.append(el(i ? "td" : "th", i ? {} : { scope: "row" }, c)),
      );
      tbody.append(row);
    });
    t.append(tbody);
    return t;
  };
  const renderSelection = (item) => {
    const total = projection?.includedApplications ?? 0,
      value = item.value ?? item.total ?? 0;
    const apps =
      item.applicationIds ??
      projection.paths
        .filter((p) => p.nodeIds.includes(item.id))
        .map((p) => p.applicationId);
    details.textContent = "";
    details.append(
      el(
        "h3",
        {},
        item.source
          ? `${item.source.label} → ${item.target.label}`
          : item.label,
      ),
    );
    details.append(
      el(
        "p",
        {},
        `${value} applications (${percent(value, total)}). Observed/inferred details are reflected in warning counts below. Date range: ${ariaText(projection.bucket)}.`,
      ),
    );
    const disclosure = el("details");
    disclosure.append(
      el("summary", {}, `Affected applications (${apps.length})`),
      el("p", {}, apps.join(", ") || "None"),
    );
    details.append(disclosure);
  };
  const renderTables = () => {
    tables.textContent = "";
    const total = projection.includedApplications;
    const rowsFor = (obj) =>
      Object.entries(obj ?? {}).map(([k, v]) => [
        taxonomy.get(`${k.includes(":") ? k : "origin:" + k}`)?.label ??
          taxonomy.get(`endpoint:${k}`)?.label ??
          k,
        String(v),
        percent(v, total),
      ]);
    tables.append(
      table(
        "Origins",
        ["Origin", "Count", "Percentage"],
        rowsFor(projection.totals.origins),
      ),
    );
    tables.append(
      table(
        "Endpoints",
        ["Endpoint", "Count", "Percentage"],
        Object.entries(projection.totals.endpoints ?? {}).map(([k, v]) => [
          taxonomy.get(`endpoint:${k}`)?.label ?? k,
          String(v),
          percent(v, total),
        ]),
      ),
    );
    tables.append(
      table(
        "Transitions",
        ["From", "To", "Application count"],
        projection.links.map((l) => [
          taxonomy.get(l.source)?.label ?? l.source,
          taxonomy.get(l.target)?.label ?? l.target,
          String(l.value),
        ]),
      ),
    );
    tables.append(
      table(
        "Selected-boundary events",
        ["Event", "Application", "Type"],
        (projection.events ?? []).map((e) => [
          e.id,
          e.applicationId,
          e.eventType,
        ]),
      ),
    );
    tables.append(
      el(
        "p",
        { class: "muted" },
        `Warnings — inferred history: ${projection.warningCounts.inferred_event ?? 0}, unknown origin/time: ${(projection.warningCounts.inferred_origin ?? 0) + (projection.warningCounts.invalid_timestamp ?? 0)}, status mismatch: ${projection.warningCounts.status_mismatch ?? 0}, regression: ${projection.warningCounts.regressive_history ?? 0}.`,
      ),
    );
  };
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(renderSvg, 100);
    });
    ro.observe(root);
  }
  return {
    update({
      timeline,
      snapshot,
      selectedBucketId = "current",
      newerAvailable = false,
    }) {
      lastTimeline = timeline;
      selectedId = selectedBucketId;
      projection = snapshot;
      const idx = bucketIndex(timeline),
        max = Math.max(0, timeline.buckets.length - 1),
        bucket = timeline.buckets[idx] ?? timeline.buckets[max];
      range.max = String(max);
      range.value = String(idx);
      range.disabled = max === 0;
      range.setAttribute("aria-valuetext", ariaText(bucket, timeline));
      prev.disabled = idx <= 0;
      next.disabled = idx >= max;
      current.disabled = selectedId === "current";
      badge.textContent =
        selectedId === "current"
          ? "Current"
          : `Historical${newerAvailable ? " — Newer activity available" : ""}`;
      timestamp.textContent = "";
      const knownBuckets = timeline.buckets.filter(
        (candidate) =>
          !["current", "unknown-date"].includes(candidate.id) &&
          candidate.eventIds?.length,
      );
      const latestKnown = knownBuckets.at(-1);
      const unknownCount =
        timeline.buckets.find((candidate) => candidate.id === "unknown-date")
          ?.eventIds?.length ?? 0;
      const timestampText =
        bucket?.id === "current"
          ? `Current — latest data in this browser. Latest known event time: ${latestKnown ? ariaText(latestKnown) : "none"}. Unknown-time events: ${unknownCount}.`
          : ariaText(bucket);
      timestamp.append(
        el(
          "time",
          {
            datetime:
              bucket?.id === "current"
                ? new Date().toISOString()
                : String(bucket?.cutoff ?? bucket?.id ?? ""),
          },
          timestampText,
        ),
      );
      simultaneous.textContent = "";
      const simultaneousCount = bucket?.eventIds?.length ?? 0;
      if (simultaneousCount > 1) {
        simultaneous.append(
          el("summary", {}, `Simultaneous events (${simultaneousCount})`),
          el("p", {}, bucket.eventIds.join(", ")),
        );
      }
      counts.textContent = `${snapshot.includedApplications} of ${snapshot.totalApplications} applications included`;
      announce(`${badge.textContent}. ${counts.textContent}.`);
      renderSvg();
      renderTables();
      renderSelection({
        label: "Diagram summary",
        total: snapshot.includedApplications,
        id: "summary",
        applicationIds: snapshot.paths.map((p) => p.applicationId),
      });
    },
    destroy() {
      ro?.disconnect();
      clearTimeout(liveTimer);
      root.textContent = "";
    },
  };
}
