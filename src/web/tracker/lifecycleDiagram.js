/* global document, window, ResizeObserver */
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { LIFECYCLE_DIAGRAM_TAXONOMY } from "./lifecycleProjection.js";

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
const isUnknownPrecision = (precision) =>
  ["unknown", "legacy-placeholder", "legacy_placeholder"].includes(precision);
const unique = (items) => [...new Set(items.filter(Boolean))].sort(compare);
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
const cloneProjectionForSankey = (projection) => ({
  nodes: projection.nodes
    .map((node) => ({
      ...node,
      applicationIds: [...(node.applicationIds ?? [])],
      rank: nodeRank(node.id),
    }))
    .sort(nodeSort),
  links: projection.links
    .map((link) => ({
      ...link,
      applicationIds: [...(link.applicationIds ?? [])],
    }))
    .sort((a, b) => compare(a.id, b.id)),
});

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
  const PAGE_SIZE = 50;
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

  const announce = makeDebounce((message) => {
    live.textContent = message;
  });
  const pageSlice = (items, page) =>
    items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const rangeText = (label, page, total) => {
    if (!total) return `${label} 0 of 0`;
    const start = page * PAGE_SIZE + 1;
    const end = Math.min(total, start + PAGE_SIZE - 1);
    return `${label} ${start}–${end} of ${total}`;
  };
  const renderPagination = (label, page, total, onPrev, onNext) => {
    const wrapper = el("div", { className: "diagram-pagination" });
    const prevPage = el("button", {
      type: "button",
      className: "button",
      textContent: `Previous ${label.toLowerCase()} page`,
      "aria-label": `Previous ${label.toLowerCase()} page`,
    });
    const nextPage = el("button", {
      type: "button",
      className: "button",
      textContent: `Next ${label.toLowerCase()} page`,
      "aria-label": `Next ${label.toLowerCase()} page`,
    });
    prevPage.disabled = page <= 0;
    nextPage.disabled = (page + 1) * PAGE_SIZE >= total;
    prevPage.addEventListener("click", onPrev);
    nextPage.addEventListener("click", onNext);
    wrapper.append(
      el("span", {
        className: "muted",
        textContent: rangeText(`${label}s`, page, total),
      }),
      prevPage,
      nextPage,
    );
    return wrapper;
  };
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
            "aria-pressed": selectedFeature?.id === row.id ? "true" : "false",
          });
          button.addEventListener("click", row.onSelect);
          td.append(button);
        } else {
          td.textContent = cell;
        }
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    return el("div", { className: "table-container" }, [table]);
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
    const link = projection.links.find((candidate) => candidate.id === id);
    if (link) {
      const from = TAXONOMY.get(link.source)?.label ?? link.source;
      const to = TAXONOMY.get(link.target)?.label ?? link.target;
      return {
        id: link.id,
        label: `${from} to ${to}: ${link.value}`,
        applicationIds: link.applicationIds,
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
    if (selectedFeature?.id !== feature.id) applicationPage = 0;
    selectedFeature = {
      ...feature,
      applicationIds: featureApplicationIds(feature),
    };
    renderDetails();
    renderSvg();
    renderTables();
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
    const safePage = Math.min(
      applicationPage,
      Math.max(0, Math.ceil(ids.length / PAGE_SIZE) - 1),
    );
    applicationPage = safePage;
    const appList = el("ol", { className: "diagram-application-list" });
    for (const id of pageSlice(ids, applicationPage))
      appList.append(el("li", { textContent: id }));
    const appSummary = el("p", { textContent: ids.join(", ") || "None" });
    const appPager = renderPagination(
      "Application",
      applicationPage,
      ids.length,
      () => {
        applicationPage = Math.max(0, applicationPage - 1);
        renderDetails();
      },
      () => {
        applicationPage += 1;
        renderDetails();
      },
    );
    const d = el("details", {}, [
      el("summary", { textContent: "Affected applications" }),
      appPager,
      appSummary,
      appList,
    ]);
    details.append(
      d,
      el("p", { className: "muted", textContent: warningSummary }),
    );
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
    const columnWidth = (width - 64) / 6;
    for (const node of graph.nodes) {
      const fixedX = 16 + node.rank * columnWidth;
      node.x0 = fixedX;
      node.x1 = fixedX + 18;
    }
    layout.update(graph);
    const finiteNode = (node) =>
      [node.x0, node.x1, node.y0, node.y1].every(Number.isFinite);
    const finiteLink = (link) =>
      finiteNode(link.source) &&
      finiteNode(link.target) &&
      Number.isFinite(link.width ?? 0);
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
      "Application counts flowing from origin through milestones to endpoints. " +
      "Equivalent tables follow.";
    const linkG = svgEl("g", { fill: "none", strokeOpacity: "0.45" });
    for (const link of graph.links.filter(
      (l) => l.value > 0 && finiteLink(l),
    )) {
      // eslint-disable-next-line max-len
      const linkLabel = `${TAXONOMY.get(link.source.id)?.label ?? link.source.id} to ${TAXONOMY.get(link.target.id)?.label ?? link.target.id}: ${link.value}`;
      const pathData = sankeyLinkHorizontal()(link);
      if (!pathData || /NaN|Infinity/u.test(pathData)) continue;
      const path = svgEl("path", {
        d: pathData,
        stroke: selectedFeature?.id === link.id ? "#fbbf24" : "#38bdf8",
        "stroke-width": Math.max(3, link.width || 1),
        "data-diagram-link": link.id,
      });
      path.append(svgEl("title"));
      path.querySelector("title").textContent = linkLabel;
      const selectLink = () =>
        selectFeature({
          id: link.id,
          label: linkLabel,
          applicationIds: link.applicationIds,
        });
      path.addEventListener("click", selectLink);
      linkG.append(path);
      const hit = svgEl("path", {
        d: pathData,
        stroke: "transparent",
        "stroke-width": Math.max(44, link.width || 1),
        "pointer-events": "stroke",
        "aria-hidden": "true",
        "data-diagram-hit-link": link.id,
      });
      hit.addEventListener("click", selectLink);
      linkG.append(hit);
    }
    svg.append(linkG);
    for (const node of graph.nodes.filter(
      (n) => n.total > 0 && [n.x0, n.x1, n.y0, n.y1].every(Number.isFinite),
    )) {
      const nodeLabel = `${node.label}: ${node.total}`;
      const g = svgEl("g", {
        "data-diagram-node": node.id,
      });
      const rect = svgEl("rect", {
        x: node.x0,
        y: node.y0,
        width: Math.max(8, node.x1 - node.x0),
        height: Math.max(8, node.y1 - node.y0),
        rx: 4,
        fill: selectedFeature?.id === node.id ? "#fbbf24" : "#64748b",
        stroke: "#e2e8f0",
      });
      g.append(svgEl("title"));
      g.querySelector("title").textContent = nodeLabel;
      // SVG pointer handlers intentionally remain mouse-only; semantic table
      // buttons below provide the compact keyboard equivalent.
      const selectNode = () =>
        selectFeature({
          id: node.id,
          label: nodeLabel,
          applicationIds: node.applicationIds,
        });
      g.addEventListener("click", selectNode);
      const label = svgEl("text", {
        x: node.x0 < width / 2 ? node.x1 + 6 : node.x0 - 6,
        y: (node.y0 + node.y1) / 2,
        "dominant-baseline": "middle",
        "text-anchor": node.x0 < width / 2 ? "start" : "end",
        fill: "currentColor",
      });
      label.textContent = `${node.label} (${node.total})`;
      const hitRect = svgEl("rect", {
        x: node.x0 - Math.max(0, 44 - (node.x1 - node.x0)) / 2,
        y: node.y0 - Math.max(0, 44 - (node.y1 - node.y0)) / 2,
        width: Math.max(44, node.x1 - node.x0),
        height: Math.max(44, node.y1 - node.y0),
        fill: "transparent",
        "pointer-events": "all",
        "aria-hidden": "true",
        "data-diagram-hit-node": node.id,
      });
      hitRect.addEventListener("click", selectNode);
      g.append(rect, hitRect, label);
      svg.append(g);
    }
    scroll.append(svg);
  };
  const renderTables = () => {
    const total = projection.includedApplications;
    const makeNodeRows = (entries, namespace) =>
      LIFECYCLE_DIAGRAM_TAXONOMY[
        namespace === "origin"
          ? "origins"
          : namespace === "milestone"
            ? "milestones"
            : "endpoints"
      ].map(({ id }) => {
        const value = entries[id] ?? 0;
        const nodeId = `${namespace}:${id}`;
        const label = TAXONOMY.get(nodeId)?.label ?? id;
        const applicationIds = unique(
          projection.paths
            .filter((path) => path.nodeIds.includes(nodeId))
            .map((path) => path.applicationId),
        );
        return {
          id: nodeId,
          cells: [label, String(value), pct(value, total)],
          label: `Select ${label}`,
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
    const linkRows = projection.links.map((link) => {
      const from = TAXONOMY.get(link.source)?.label ?? link.source;
      const to = TAXONOMY.get(link.target)?.label ?? link.target;
      const flowLabel = `${from} to ${to}`;
      return {
        id: link.id,
        cells: [flowLabel, String(link.value), pct(link.value, total)],
        label: `Select flow ${flowLabel}`,
        onSelect: () =>
          selectFeature({
            id: link.id,
            label: `${flowLabel}: ${link.value}`,
            applicationIds: link.applicationIds,
          }),
      };
    });
    const eventRows = projection.events.map((event) => {
      const time = formatEventTime(event);
      return {
        cells: [event.id, event.applicationId, event.eventType, time.label],
        time,
      };
    });
    eventPage = Math.min(
      eventPage,
      Math.max(0, Math.ceil(eventRows.length / PAGE_SIZE) - 1),
    );
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
        ["Flow", "Application count", "Percentage"],
        linkRows,
      ),
      (() => {
        const table = renderTable(
          "Selected-boundary events",
          ["Event", "Application", "Type", "Timestamp"],
          pageSlice(eventRows, eventPage),
        );
        const rows = table.querySelectorAll("tbody tr");
        pageSlice(eventRows, eventPage).forEach((row, index) => {
          const cell = rows[index]?.querySelector("td:last-child");
          if (cell && row.time?.datetime) {
            cell.textContent = "";
            cell.append(
              el("time", {
                datetime: row.time.datetime,
                textContent: row.time.label,
              }),
            );
          }
        });
        table.prepend(
          renderPagination(
            "Event",
            eventPage,
            eventRows.length,
            () => {
              eventPage = Math.max(0, eventPage - 1);
              renderTables();
            },
            () => {
              eventPage += 1;
              renderTables();
            },
          ),
        );
        return table;
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
        applicationPage = 0;
      } else if (snapshotChanged && previousSelectionId)
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
