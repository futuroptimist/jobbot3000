/* global document, window, ResizeObserver */
import { sankey } from "d3-sankey";
import { LIFECYCLE_DIAGRAM_TAXONOMY } from "./lifecycleProjection.js";
import {
  BRANCH_HANDLE_RADIUS,
  LAYOUT_LEFT_MARGIN,
  LAYOUT_RIGHT_MARGIN,
  LIFECYCLE_ENDPOINT_COLORS,
  MINIMUM_RANK_CENTER_SPACING,
  NODE_LABEL_MAX_WIDTH,
  SANKEY_NODE_WIDTH,
  adjacentRankSegmentPath,
  branchHandleCandidates,
  buildLifecycleDisplayBranches,
  buildLifecycleRoutingGraph,
  calculateLifecycleDiagramLayout,
  endpointSortIndex,
  lifecycleNodeRank,
  rankCenterX,
  taxonomyLabel,
  wrapLifecycleNodeLabel,
} from "./lifecycleDiagramLayout.js";

const SVG_NS = "http://www.w3.org/2000/svg";
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
    if (value !== undefined && value !== null) {
      if (key === "textContent") node.textContent = value;
      else node.setAttribute(key, String(value));
    }
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
export { calculateLifecycleDiagramLayout };

const bucketValueText = (bucket) => {
  if (!bucket) return "Current — latest data in this browser";
  if (bucket.kind === "current") return "Current — latest data in this browser";
  if (bucket.kind === "unknown-date")
    return "Unknown date — off chronological scale";
  if (bucket.kind === "date") return `${bucket.label}`;
  return `Historical event at ${bucket.label}`;
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
const isUnknownPrecision = (precision) =>
  ["unknown", "legacy-placeholder", "legacy_placeholder"].includes(precision);
const PAGE_SIZE = 50;
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
const nodeSort = (a, b) =>
  (a.rank ?? lifecycleNodeRank(a.id)) - (b.rank ?? lifecycleNodeRank(b.id)) ||
  Number(a.routing) - Number(b.routing) ||
  endpointSortIndex(a.endpointId) - endpointSortIndex(b.endpointId) ||
  compare(a.branchId ?? a.id, b.branchId ?? b.id);
const linkSort = (a, b) =>
  endpointSortIndex(a.endpointId) - endpointSortIndex(b.endpointId) ||
  compare(a.semanticLinkId, b.semanticLinkId) ||
  compare(a.branchId, b.branchId) ||
  (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0);

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
  let applicationPage = 0;
  let tablesOpen = false;
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
  const tablesDisclosure = el("details", { className: "diagram-tables" }, [
    el("summary", { textContent: "Lifecycle data tables" }),
  ]);
  const tables = el("div", { className: "diagram-tables-body" });
  tablesDisclosure.append(tables);
  tablesDisclosure.addEventListener("toggle", () => {
    tablesOpen = tablesDisclosure.open;
  });
  const legend = el("div", {
    className: "diagram-legend",
    "data-diagram-legend": "",
    role: "group",
    "aria-label": "Outcome branch colors",
  });
  root.append(
    controls,
    stamp,
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
    const branch = buildLifecycleDisplayBranches(projection).find(
      (candidate) => candidate.id === id,
    );
    if (branch) {
      const from = taxonomyLabel(branch.source);
      const to = taxonomyLabel(branch.target);
      const outcome = taxonomyLabel(`endpoint:${branch.endpointId}`);
      return {
        ...branch,
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
    const active = document.activeElement;
    const shouldRestoreFocus = active?.matches?.(".diagram-select-button");
    if (selectedFeature?.id !== feature.id) applicationPage = 0;
    selectedFeature = {
      ...feature,
      applicationIds: featureApplicationIds(feature),
    };
    renderDetails();
    renderSvg();
    renderTables();
    if (shouldRestoreFocus)
      [...tables.querySelectorAll(".diagram-select-button")]
        .find((button) => button.dataset.diagramSelectId === feature.id)
        ?.focus();
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
  const renderLegend = (branches) => {
    legend.textContent = "";
    const counts = new Map();
    for (const branch of branches)
      counts.set(
        branch.endpointId,
        (counts.get(branch.endpointId) ?? 0) + branch.value,
      );
    for (const endpoint of LIFECYCLE_DIAGRAM_TAXONOMY.endpoints) {
      const count = counts.get(endpoint.id) ?? 0;
      if (!count) continue;
      legend.append(
        el("span", { className: "diagram-legend-item" }, [
          el("span", {
            className: "diagram-legend-swatch",
            "aria-hidden": "true",
            style: `background: ${LIFECYCLE_ENDPOINT_COLORS[endpoint.id]}`,
          }),
          document.createTextNode(`${endpoint.label} ${count}`),
        ]),
      );
    }
  };
  const renderSvg = () => {
    scroll.textContent = "";
    if (!projection.totalApplications) {
      legend.textContent = "";
      scroll.append(
        el("p", { className: "muted", textContent: "No lifecycle data yet." }),
      );
      return;
    }
    const routingGraph = buildLifecycleRoutingGraph(projection);
    const displayBranches = routingGraph.displayBranches;
    renderLegend(displayBranches);
    if (!projection.nodes.length) {
      scroll.append(
        el("p", {
          className: "muted",
          textContent: "No diagram nodes are available for this point.",
        }),
      );
      return;
    }
    const { width, height, nodePadding, topMargin, bottomMargin } =
      calculateLifecycleDiagramLayout(
        projection,
        root.clientWidth,
        routingGraph,
      );
    const graph = {
      nodes: routingGraph.nodes
        .map((node) => ({
          ...node,
          applicationIds: [...(node.applicationIds ?? [])],
        }))
        .sort(nodeSort),
      links: routingGraph.links
        .map((link) => ({
          ...link,
          applicationIds: [...(link.applicationIds ?? [])],
        }))
        .sort(linkSort),
    };
    const layout = sankey()
      .nodeId((d) => d.id)
      .nodeAlign((node) => node.rank)
      .nodeWidth(SANKEY_NODE_WIDTH)
      .nodePadding(nodePadding)
      .nodeSort(nodeSort)
      .linkSort(linkSort)
      .extent([
        [LAYOUT_LEFT_MARGIN, topMargin],
        [width - LAYOUT_RIGHT_MARGIN, height - bottomMargin],
      ]);
    try {
      layout(graph);
    } catch {
      scroll.append(
        el("p", {
          className: "muted",
          textContent: "Unable to lay out lifecycle diagram.",
        }),
      );
      return;
    }
    for (const node of graph.nodes) {
      const center = rankCenterX(node.rank);
      if (node.routing) node.x0 = node.x1 = center;
      else {
        node.x0 = center - SANKEY_NODE_WIDTH / 2;
        node.x1 = center + SANKEY_NODE_WIDTH / 2;
      }
    }
    layout.update(graph);
    const finiteNode = (node) =>
      [node.x0, node.x1, node.y0, node.y1].every(Number.isFinite);
    const finiteLink = (link) =>
      finiteNode(link.source) &&
      finiteNode(link.target) &&
      Number.isFinite(link.width ?? 0) &&
      Number.isFinite(link.y0) &&
      Number.isFinite(link.y1);
    const linksByBranch = new Map();
    for (const link of graph.links.filter(
      (l) => l.value > 0 && finiteLink(l),
    )) {
      if (!linksByBranch.has(link.branchId))
        linksByBranch.set(link.branchId, []);
      linksByBranch.get(link.branchId).push(link);
    }
    const svg = svgEl("svg", {
      role: "img",
      "aria-labelledby": `${ids.title} ${ids.desc}`,
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      "data-reduced-motion": reduceMotion?.matches ? "true" : "false",
      "data-rank-center-spacing": MINIMUM_RANK_CENTER_SPACING,
    });
    svg.append(svgEl("title", { id: ids.title }));
    svg.querySelector("title").textContent = "Lifecycle Sankey diagram";
    svg.append(svgEl("desc", { id: ids.desc }));
    svg.querySelector("desc").textContent =
      "Application counts flowing from origin through milestones to endpoints. " +
      "Equivalent tables follow.";
    const branchG = svgEl("g", { fill: "none" });
    const hitG = svgEl("g", { fill: "none" });
    for (const branch of displayBranches) {
      const segments = (linksByBranch.get(branch.id) ?? []).sort(
        (a, b) => a.segmentIndex - b.segmentIndex,
      );
      if (!segments.length) continue;
      const pathData = segments.map(adjacentRankSegmentPath).join(" ");
      if (!pathData || /NaN|Infinity/u.test(pathData)) continue;
      const from = taxonomyLabel(branch.source);
      const to = taxonomyLabel(branch.target);
      const outcome = taxonomyLabel(`endpoint:${branch.endpointId}`);
      const label = `${from} to ${to}, outcome ${outcome}: ${branch.value}`;
      const selected = selectedFeature?.id === branch.id;
      const widthPx = Math.max(
        3,
        ...segments.map((segment) => segment.width || 1),
      );
      const attrs = {
        d: pathData,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "data-diagram-branch": branch.id,
        "data-semantic-link-id": branch.semanticLinkId,
        "data-endpoint-id": branch.endpointId,
        "data-source-node-id": branch.source,
        "data-target-node-id": branch.target,
        "data-selected": selected ? "true" : "false",
        "data-segment-count": segments.length,
        "data-application-ids": branch.applicationIds.join(" "),
      };
      if (selected)
        branchG.append(
          svgEl("path", {
            ...attrs,
            stroke: "#F8FAFC",
            "stroke-width": widthPx + 12,
            "pointer-events": "none",
            "aria-hidden": "true",
          }),
        );
      branchG.append(
        svgEl("path", {
          ...attrs,
          stroke: "#020617",
          "stroke-width": widthPx + 6,
          "pointer-events": "none",
          "aria-hidden": "true",
        }),
      );
      const path = svgEl("path", {
        ...attrs,
        "data-diagram-link": branch.semanticLinkId,
        stroke: branch.color,
        "stroke-width": widthPx,
        "stroke-opacity": selected ? 1 : 0.82,
      });
      path.append(svgEl("title"));
      path.querySelector("title").textContent = label;
      const selectBranch = () => selectFeature({ ...branch, label });
      path.addEventListener("click", (event) => {
        event.stopPropagation();
        selectBranch();
      });
      path.addEventListener("touchend", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectBranch();
      });
      branchG.append(path);
      const preferred =
        segments.find(
          (segment) => segment.source.routing && segment.target.routing,
        ) ?? segments[Math.floor(segments.length / 2)];
      const handle = branchHandleCandidates(preferred)[0];
      const circle = svgEl("circle", {
        cx: handle.x,
        cy: handle.y,
        r: BRANCH_HANDLE_RADIUS,
        fill: "transparent",
        "data-diagram-link-hit": branch.id,
        "data-diagram-branch": branch.id,
        "aria-hidden": "true",
      });
      circle.addEventListener("click", (event) => {
        event.stopPropagation();
        selectBranch();
      });
      circle.addEventListener("touchend", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectBranch();
      });
      hitG.append(circle);
    }
    svg.append(hitG, branchG);
    for (const node of graph.nodes.filter(
      (n) =>
        !n.routing &&
        n.total > 0 &&
        [n.x0, n.x1, n.y0, n.y1].every(Number.isFinite),
    )) {
      const nodeLabel = `${node.label}: ${node.total}`;
      const g = svgEl("g", {
        "data-diagram-node": node.id,
        "data-selected": selectedFeature?.id === node.id ? "true" : "false",
      });
      const isEndpoint = node.id.startsWith("endpoint:");
      const endpointId = node.id.replace(/^endpoint:/u, "");
      const selected = selectedFeature?.id === node.id;
      const rect = svgEl("rect", {
        x: node.x0,
        y: node.y0,
        width: Math.max(8, node.x1 - node.x0),
        height: Math.max(8, node.y1 - node.y0),
        rx: 4,
        fill: isEndpoint
          ? (LIFECYCLE_ENDPOINT_COLORS[endpointId] ??
            LIFECYCLE_ENDPOINT_COLORS.unknown)
          : "#64748b",
        stroke: selected ? "#f8fafc" : "#e2e8f0",
        "stroke-width": selected ? 4 : 1,
      });
      g.append(svgEl("title"));
      g.querySelector("title").textContent = nodeLabel;
      const selectNode = () =>
        selectFeature({
          id: node.id,
          label: nodeLabel,
          applicationIds: node.applicationIds,
        });
      const hitRect = svgEl("rect", {
        x: node.x0 - Math.max(0, 44 - (node.x1 - node.x0)) / 2,
        y: node.y0 - Math.max(0, 44 - (node.y1 - node.y0)) / 2,
        width: Math.max(44, node.x1 - node.x0),
        height: Math.max(44, node.y1 - node.y0),
        fill: "transparent",
        "aria-hidden": "true",
        "data-diagram-node-hit": node.id,
      });
      for (const target of [hitRect, rect]) {
        target.addEventListener("click", (event) => {
          event.stopPropagation();
          selectNode();
        });
        target.addEventListener("touchend", (event) => {
          event.preventDefault();
          event.stopPropagation();
          selectNode();
        });
      }
      const lines = wrapLifecycleNodeLabel(`${node.label} (${node.total})`);
      const label = svgEl("text", {
        x: (node.x0 + node.x1) / 2,
        y: Math.max(16, node.y0 - 28),
        "text-anchor": "middle",
        fill: "currentColor",
        "data-diagram-node-label": node.id,
        "data-label-max-width": NODE_LABEL_MAX_WIDTH,
      });
      for (const [index, line] of lines.entries())
        label.append(
          svgEl("tspan", {
            x: (node.x0 + node.x1) / 2,
            dy: index ? "1.15em" : "0",
            textContent: line,
          }),
        );
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        selectNode();
      });
      label.addEventListener("touchend", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectNode();
      });
      g.append(hitRect, rect, label);
      svg.append(g);
    }
    scroll.append(svg);
  };
  const renderTables = () => {
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
    const branchRows = pageSlice(
      buildLifecycleDisplayBranches(projection),
      0,
    ).items.map((branch) => {
      const from = taxonomyLabel(branch.source);
      const to = taxonomyLabel(branch.target);
      const outcome = taxonomyLabel(`endpoint:${branch.endpointId}`);
      const flowLabel = `${from} to ${to}`;
      return {
        cells: [
          flowLabel,
          outcome,
          String(branch.value),
          pct(branch.value, total),
        ],
        label: `Select flow ${from} to ${to}, outcome ${outcome}`,
        id: branch.id,
        onSelect: () =>
          selectFeature({
            ...branch,
            label: `${flowLabel}, outcome ${outcome}: ${branch.value}`,
          }),
      };
    });
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
    tablesDisclosure.open = tablesOpen;
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
        branchRows,
      ),
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
  };
  const render = (newerAvailable = lastNewerAvailable) => {
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
  const debouncedResize = makeDebounce(() => render(lastNewerAvailable));
  resizeObserver = window.ResizeObserver
    ? new ResizeObserver(debouncedResize)
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
      if (bucketChanged) {
        selectedFeature = null;
        eventPage = 0;
      } else if (snapshotChanged) {
        eventPage = 0;
        if (previousSelectionId)
          selectedFeature = featureById(previousSelectionId);
      } else if (previousSelectionId)
        selectedFeature = featureById(previousSelectionId);
      render(newerAvailable);
    },
    announce(message) {
      announce(message);
    },
    destroy() {
      resizeObserver?.disconnect();
      if (windowResizeHandler)
        window.removeEventListener("resize", windowResizeHandler);
      debouncedResize.clear();
      announce.clear();
      root.textContent = "";
    },
  };
}
