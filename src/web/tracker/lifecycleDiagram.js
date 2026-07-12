/* global document, window, ResizeObserver */
/* eslint-disable max-len */
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import {
  LIFECYCLE_DIAGRAM_TAXONOMY,
  projectLifecycleAt,
} from "./lifecycleProjection.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const RANKS = { origin: 0, milestone: 1, endpoint: 6 };
const MILESTONE_RANKS = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((item, index) => [
    `milestone:${item.id}`,
    index + 1,
  ]),
);
const TAXONOMY = new Map(
  [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
  ].map((item) => [item.nodeId, item]),
);
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
const debounce = (fn, ms = 80) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};
const nodeRank = (id) => {
  if (id.startsWith("origin:")) return RANKS.origin;
  if (id.startsWith("endpoint:")) return RANKS.endpoint;
  return MILESTONE_RANKS.get(id) ?? RANKS.milestone;
};
const nodeSort = (a, b) =>
  nodeRank(a.id) - nodeRank(b.id) || compare(a.id, b.id);
const bucketValueText = (bucket) => {
  if (!bucket) return "Current — latest data in this browser";
  if (bucket.kind === "current") return "Current — latest data in this browser";
  if (bucket.kind === "unknown-date")
    return "Unknown date — off chronological scale";
  if (bucket.kind === "date") return `${bucket.label}`;
  return `Historical event at ${bucket.label}`;
};
const formatTimestamp = (bucket, projection) => {
  if (bucket.kind === "current") {
    const known = projection.events
      .filter(
        (event) => event.occurredAtPrecision !== "unknown" && event.occurredAt,
      )
      .map((event) => event.occurredAt)
      .sort()
      .at(-1);
    const unknown = projection.events.filter(
      (event) => event.occurredAtPrecision === "unknown",
    ).length;
    return {
      label: `Current — latest data in this browser${known ? `, latest known event ${new Date(known).toLocaleString()}` : ""}${unknown ? `, ${unknown} unknown-time event${unknown === 1 ? "" : "s"}` : ""}`,
      datetime: known,
    };
  }
  if (bucket.kind === "unknown-date")
    return { label: "Unknown date — off chronological scale" };
  if (bucket.kind === "date")
    return { label: `${bucket.label}`, datetime: bucket.label.slice(0, 10) };
  return {
    label: new Date(bucket.label).toLocaleString(),
    datetime: bucket.label,
  };
};
const cloneProjectionForSankey = (projection) => ({
  nodes: projection.nodes
    .map((node) => ({ ...node, rank: nodeRank(node.id) }))
    .sort(nodeSort),
  links: projection.links
    .map((link) => ({ ...link }))
    .sort((a, b) => compare(a.id, b.id)),
});

export function createLifecycleDiagramView(root, options = {}) {
  const onBucketChange = options.onBucketChange ?? (() => {});
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let selectedId = "current";
  let projection = projectLifecycleAt({}, "current");
  let timeline = { buckets: [] };
  let selectedFeature = null;
  let resizeObserver;
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
  const tables = el("div", { className: "diagram-tables" });
  root.append(controls, stamp, live, scroll, details, simultaneous, tables);

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
    for (const row of rows)
      tbody.append(
        el(
          "tr",
          {},
          row.map((cell, index) =>
            el(index ? "td" : "th", {
              scope: index ? undefined : "row",
              textContent: cell,
            }),
          ),
        ),
      );
    table.append(thead, tbody);
    return el("div", { className: "table-container" }, [table]);
  };
  const selectFeature = (feature) => {
    selectedFeature = feature;
    renderDetails();
    renderSvg();
  };
  const renderDetails = () => {
    const total = projection.includedApplications || 0;
    if (!selectedFeature) {
      details.textContent =
        "Select a node or flow row for counts, percentages, and affected applications.";
      return;
    }
    const ids =
      selectedFeature.applicationIds ??
      projection.paths
        .filter((p) => p.nodeIds.includes(selectedFeature.id))
        .map((p) => p.applicationId);
    details.textContent = "";
    details.append(
      el("h3", { textContent: selectedFeature.label }),
      el("p", {
        textContent: `${ids.length} application${ids.length === 1 ? "" : "s"} (${pct(ids.length, total)}). Observed ${ids.length}; inferred ${projection.warnings.filter((w) => ids.includes(w.applicationId) && w.code.includes("inferred")).length}. Date range: ${projection.bucket.label}.`,
      }),
    );
    const d = el("details", {}, [
      el("summary", { textContent: "Affected applications" }),
      el("p", { textContent: ids.join(", ") || "None" }),
    ]);
    details.append(d);
  };
  const renderSvg = () => {
    scroll.textContent = "";
    if (!projection.totalApplications) {
      scroll.append(
        el("p", { className: "muted", textContent: "No lifecycle data yet." }),
      );
      return;
    }
    if (!projection.nodes.length) {
      scroll.append(
        el("p", {
          className: "muted",
          textContent: "No diagram nodes are available for this point.",
        }),
      );
      return;
    }
    const width = Math.max(760, root.clientWidth || 760),
      height = Math.max(260, 70 + projection.nodes.length * 34);
    const graph = cloneProjectionForSankey(projection);
    const layout = sankey()
      .nodeId((d) => d.id)
      .nodeWidth(18)
      .nodePadding(16)
      .nodeSort(nodeSort)
      .extent([
        [16, 20],
        [width - 24, height - 30],
      ]);
    layout(graph);
    const columnWidth = (width - 64) / 6;
    for (const node of graph.nodes) {
      const fixedX = 16 + node.rank * columnWidth;
      node.x0 = fixedX;
      node.x1 = fixedX + 18;
    }
    layout.update(graph);
    const svg = svgEl("svg", {
      role: "img",
      "aria-labelledby": `${ids.title} ${ids.desc}`,
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      "data-reduced-motion": reduceMotion?.matches ? "true" : "false",
    });
    svg.append(svgEl("title", { id: ids.title }));
    svg.querySelector("title").textContent = "Lifecycle Sankey diagram";
    svg.append(svgEl("desc", { id: ids.desc }));
    svg.querySelector("desc").textContent =
      "Application counts flowing from origin through milestones to endpoints. Equivalent tables follow.";
    const linkG = svgEl("g", { fill: "none", strokeOpacity: "0.45" });
    for (const link of graph.links.filter((l) => l.value > 0)) {
      const path = svgEl("path", {
        d: sankeyLinkHorizontal()(link),
        stroke: selectedFeature?.id === link.id ? "#fbbf24" : "#38bdf8",
        "stroke-width": Math.max(3, link.width || 1),
        "data-diagram-link": link.id,
      });
      path.append(svgEl("title"));
      path.querySelector("title").textContent =
        `${TAXONOMY.get(link.source.id)?.label ?? link.source.id} to ${TAXONOMY.get(link.target.id)?.label ?? link.target.id}: ${link.value}`;
      path.addEventListener("click", () =>
        selectFeature({
          id: link.id,
          label: path.querySelector("title").textContent,
          applicationIds: link.applicationIds,
        }),
      );
      linkG.append(path);
    }
    svg.append(linkG);
    for (const node of graph.nodes.filter(
      (n) => n.total > 0 && [n.x0, n.x1, n.y0, n.y1].every(Number.isFinite),
    )) {
      const g = svgEl("g", { "data-diagram-node": node.id });
      const rect = svgEl("rect", {
        x: node.x0,
        y: node.y0,
        width: Math.max(8, node.x1 - node.x0),
        height: Math.max(8, node.y1 - node.y0),
        rx: 4,
        fill: selectedFeature?.id === node.id ? "#fbbf24" : "#64748b",
        stroke: "#e2e8f0",
      });
      rect.addEventListener("click", () =>
        selectFeature({ id: node.id, label: `${node.label}: ${node.total}` }),
      );
      const label = svgEl("text", {
        x: node.x0 < width / 2 ? node.x1 + 6 : node.x0 - 6,
        y: (node.y0 + node.y1) / 2,
        "dominant-baseline": "middle",
        "text-anchor": node.x0 < width / 2 ? "start" : "end",
        fill: "currentColor",
      });
      label.textContent = `${node.label} (${node.total})`;
      g.append(rect, label);
      svg.append(g);
    }
    scroll.append(svg);
  };
  const renderTables = () => {
    const total = projection.includedApplications;
    const originRows = Object.entries(projection.totals.origins).map(
      ([id, value]) => [
        TAXONOMY.get(`origin:${id}`)?.label ?? id,
        String(value),
        pct(value, total),
      ],
    );
    const endpointRows = Object.entries(projection.totals.endpoints).map(
      ([id, value]) => [
        TAXONOMY.get(`endpoint:${id}`)?.label ?? id,
        String(value),
        pct(value, total),
      ],
    );
    const linkRows = projection.links.map((link) => [
      TAXONOMY.get(link.source)?.label ?? link.source,
      TAXONOMY.get(link.target)?.label ?? link.target,
      String(link.value),
    ]);
    const eventRows = projection.events.map((event) => [
      event.id,
      event.applicationId,
      event.eventType,
      event.occurredAt ?? "Unknown",
    ]);
    tables.textContent = "";
    tables.append(
      renderTable("Origins", ["Origin", "Count", "Percentage"], originRows),
      renderTable(
        "Endpoints",
        ["Endpoint", "Count", "Percentage"],
        endpointRows,
      ),
      renderTable("Flows", ["From", "To", "Application count"], linkRows),
      renderTable(
        "Selected-boundary events",
        ["Event", "Application", "Type", "Timestamp"],
        eventRows,
      ),
    );
    tables.querySelectorAll("tbody tr").forEach((row, index) => {
      if (
        index >= originRows.length + endpointRows.length &&
        index < originRows.length + endpointRows.length + linkRows.length
      ) {
        const link =
          projection.links[index - originRows.length - endpointRows.length];
        row.tabIndex = 0;
        row.addEventListener("click", () =>
          selectFeature({
            id: link.id,
            label: `${linkRows[index - originRows.length - endpointRows.length][0]} to ${linkRows[index - originRows.length - endpointRows.length][1]}`,
            applicationIds: link.applicationIds,
          }),
        );
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            row.click();
          }
        });
      }
    });
  };
  const render = (newerAvailable = false) => {
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
    count.textContent = `${projection.includedApplications}/${projection.totalApplications} applications included`;
    const ts = formatTimestamp(projection.bucket, projection);
    stamp.textContent = "";
    stamp.append(
      ts.datetime
        ? el("time", { datetime: ts.datetime, textContent: ts.label })
        : document.createTextNode(ts.label),
    );
    live.textContent = `${badge.textContent}. ${count.textContent}. ${bucketValueText(projection.bucket)}`;
    simultaneous.querySelector("[data-boundary-events]").textContent =
      projection.events.map((e) => `${e.id}: ${e.eventType}`).join("; ") ||
      "No boundary events.";
    renderDetails();
    renderSvg();
    renderTables();
  };
  const changeToIndex = (index) => {
    const bucket = timeline.buckets[index];
    if (bucket) onBucketChange(bucket.id);
  };
  prev.addEventListener("click", () => changeToIndex(Number(range.value) - 1));
  next.addEventListener("click", () => changeToIndex(Number(range.value) + 1));
  current.addEventListener("click", () => onBucketChange("current"));
  range.addEventListener("input", () => changeToIndex(Number(range.value)));
  resizeObserver = window.ResizeObserver
    ? new ResizeObserver(debounce(() => render()))
    : undefined;
  resizeObserver?.observe(root);
  return {
    update({
      timeline: nextTimeline,
      snapshot,
      selectedBucketId = "current",
      newerAvailable = false,
    }) {
      timeline = nextTimeline ?? { buckets: [] };
      selectedId = selectedBucketId;
      projection = snapshot ?? projectLifecycleAt({}, selectedId);
      render(newerAvailable);
    },
    destroy() {
      resizeObserver?.disconnect();
      root.textContent = "";
    },
  };
}
