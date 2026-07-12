/* global document, window, ResizeObserver */
import { sankey, sankeyJustify, sankeyLinkHorizontal } from "d3-sankey";
import {
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "./lifecycleProjection.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const rankFor = (id) =>
  id.startsWith("origin:")
    ? 0
    : id.startsWith("endpoint:")
      ? 6
      : 1 +
        [
          "recruiter_screen",
          "assessment_take_home",
          "technical_interview",
          "onsite_final_loop",
          "offer_received",
        ].indexOf(id.split(":")[1]);
const label = (v) =>
  String(v ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "0%");
const el = (name, attrs = {}, text) => {
  const node = document.createElement(name);
  for (const [k, v] of Object.entries(attrs))
    if (v !== undefined) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgEl = (name, attrs = {}, text) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs))
    if (v !== undefined) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};
const clear = (node) => {
  node.replaceChildren();
};
const timeText = (bucket, projection) => {
  if (!bucket || bucket.kind === "current") {
    const known = projection.events
      .map((e) => Date.parse(e.occurredAt))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    const unknown = projection.events.filter((e) =>
      ["unknown", "legacy-placeholder", "legacy_placeholder"].includes(
        e.occurredAtPrecision,
      ),
    ).length;
    const latest = known
      ? `; latest known event ${new Date(known).toLocaleString()}`
      : "";
    const plural = unknown === 1 ? "" : "s";
    return `Current — latest data in this browser${latest}; ${unknown} unknown-time event${plural}`;
  }
  if (bucket.kind === "unknown-date")
    return "Unknown date — off chronological scale";
  if (bucket.kind === "date")
    return `${String(bucket.id).slice(0, 10)} — time not recorded`;
  const iso = String(bucket.label ?? bucket.id).includes("T")
    ? String(bucket.label ?? bucket.id)
    : String(bucket.id).split("|").at(-1);
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleString()
    : String(bucket.label ?? bucket.id);
};
const cloneForSankey = (projection) => ({
  nodes: projection.nodes
    .map((n) => ({ ...n, fixedRank: rankFor(n.id) }))
    .sort((a, b) => a.fixedRank - b.fixedRank || a.id.localeCompare(b.id)),
  links: projection.links
    .map((l) => ({ ...l }))
    .sort((a, b) => a.id.localeCompare(b.id)),
});
function renderTable(container, caption, headers, rows, onSelect) {
  const table = el("table", { class: "tracker-table lifecycle-table" });
  table.append(el("caption", {}, caption));
  const thead = el("thead");
  const tr = el("tr");
  headers.forEach((h) => tr.append(el("th", { scope: "col" }, h)));
  thead.append(tr);
  table.append(thead);
  const tbody = el("tbody");
  rows.forEach((row) => {
    const r = el("tr");
    row.cells.forEach((c, i) =>
      r.append(el(i ? "td" : "th", i ? {} : { scope: "row" }, c)),
    );
    const td = el("td");
    const b = el(
      "button",
      { type: "button", class: "button", "data-select-id": row.id },
      "Select",
    );
    b.addEventListener("click", () => onSelect(row.id));
    td.append(b);
    r.append(td);
    tbody.append(r);
  });
  table.append(tbody);
  container.append(table);
}
export function createLifecycleDiagramView(root) {
  let selectedId = "";
  let resizeTimer;
  let current;
  root.classList.add("lifecycle-diagram");
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => current && draw(current), 80);
  };
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(onResize)
      : undefined;
  ro?.observe(root);
  const select = (id) => {
    selectedId = id;
    root
      .querySelectorAll("[data-diagram-id]")
      .forEach((n) =>
        n.classList.toggle("is-selected", n.dataset.diagramId === id),
      );
    renderDetails();
  };
  function renderDetails() {
    const box = root.querySelector("[data-diagram-details]");
    if (!box || !current) return;
    const p = current.projection;
    const item = [...p.nodes, ...p.links].find((x) => x.id === selectedId);
    if (!item) {
      box.textContent = "Select a row or diagram element for details.";
      return;
    }
    const count = item.total ?? item.value;
    const apps =
      item.applicationIds ??
      p.paths
        .filter((path) => path.nodeIds.includes(item.id))
        .map((path) => path.applicationId);
    const observed = p.paths.filter(
      (path) =>
        apps.includes(path.applicationId) &&
        !path.details.some((d) => d.code.startsWith("inferred")),
    ).length;
    box.replaceChildren(
      el(
        "h3",
        {},
        item.source
          ? `${label(item.source.id ?? item.source)} to ${label(
              item.target.id ?? item.target,
            )}`
          : label(item.label ?? item.id),
      ),
      el(
        "p",
        {},
        [
          `${count} application${count === 1 ? "" : "s"}`,
          `(${pct(count, p.includedApplications)}).`,
          `Observed ${observed};`,
          `inferred ${Math.max(0, count - observed)}.`,
          `Date range: ${p.bucket.label}.`,
        ].join(" "),
      ),
      el("details", {}, ""),
    );
    const d = box.querySelector("details");
    d.append(
      el("summary", {}, "Affected applications"),
      el("p", {}, apps.join(", ") || "None"),
    );
  }
  function draw({ projection, timeline, selectedBucketId, newerAvailable }) {
    current = { projection, timeline, selectedBucketId, newerAvailable };
    clear(root);
    const buckets = timeline.buckets;
    const index = Math.max(
      0,
      buckets.findIndex((b) => b.id === selectedBucketId),
    );
    const bucket = buckets[index] ?? buckets.at(-1);
    const controls = el("div", { class: "diagram-controls" });
    const prev = el(
      "button",
      {
        type: "button",
        class: "button",
        "data-diagram-prev": "",
        disabled: index <= 0 ? "" : undefined,
      },
      "Previous event",
    );
    const rangeId = "lifecycle-bucket-range";
    const range = el("input", {
      id: rangeId,
      type: "range",
      min: "0",
      max: String(Math.max(0, buckets.length - 1)),
      value: String(index),
      "aria-label": "Lifecycle event bucket",
      "aria-valuetext": timeText(bucket, projection),
    });
    const next = el(
      "button",
      {
        type: "button",
        class: "button",
        disabled: index >= buckets.length - 1 ? "" : undefined,
      },
      "Next event",
    );
    const cur = el(
      "button",
      {
        type: "button",
        class: "button",
        disabled: selectedBucketId === "current" ? "" : undefined,
      },
      "Return to current",
    );
    controls.append(
      prev,
      el("label", { for: rangeId }, "Timeline"),
      range,
      next,
      cur,
      el(
        "span",
        { class: "chip" },
        bucket.kind === "current" ? "Current" : "Historical",
      ),
      el(
        "span",
        {},
        `${projection.includedApplications}/${projection.totalApplications} applications`,
      ),
    );
    root.append(
      controls,
      el("p", {}, timeText(bucket, projection)),
      el(
        "p",
        { role: "status", "aria-live": "polite", class: "muted" },
        newerAvailable ? "Newer activity available" : "",
      ),
    );
    if (projection.events.length > 1) {
      const det = el("details");
      det.append(
        el(
          "summary",
          {},
          `${projection.events.length} simultaneous/boundary events`,
        ),
        el("p", {}, projection.events.map((e) => e.id).join(", ")),
      );
      root.append(det);
    }
    const dispatch = (i) =>
      root.dispatchEvent(
        new CustomEvent("lifecycle-diagram-bucket", {
          bubbles: true,
          detail: { bucketId: buckets[i]?.id ?? "current" },
        }),
      );
    prev.onclick = () => dispatch(index - 1);
    next.onclick = () => dispatch(index + 1);
    cur.onclick = () => dispatch(buckets.length - 1);
    range.oninput = () => dispatch(Number(range.value));
    if (!projection.includedApplications) {
      root.append(
        el(
          "p",
          { class: "muted", "data-diagram-empty": "" },
          projection.totalApplications
            ? "No applications existed at this point."
            : "No application data yet.",
        ),
      );
      return;
    }
    const scroll = el("div", {
      class: "diagram-scroll",
      tabindex: "0",
      role: "region",
      "aria-label": "Scrollable lifecycle diagram",
    });
    const svg = svgEl("svg", {
      role: "img",
      "aria-labelledby": "lifecycle-diagram-title lifecycle-diagram-desc",
      width: "920",
      height: "420",
      viewBox: "0 0 920 420",
    });
    svg.append(
      svgEl(
        "title",
        { id: "lifecycle-diagram-title" },
        "Application lifecycle diagram",
      ),
      svgEl(
        "desc",
        { id: "lifecycle-diagram-desc" },
        "Sankey diagram of application origins, milestones, and endpoints.",
      ),
    );
    const graph = cloneForSankey(projection);
    const layout = sankey()
      .nodeId((d) => d.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(16)
      .nodePadding(14)
      .extent([
        [12, 12],
        [908, 360],
      ]);
    layout(graph);
    graph.nodes.forEach((n) => {
      const x = 12 + (n.fixedRank / 6) * 880;
      n.x0 = x;
      n.x1 = x + 16;
    });
    layout.update(graph);
    const gLinks = svgEl("g", { class: "diagram-links" });
    graph.links.forEach((l) => {
      if (!l.value) return;
      const pth = svgEl("path", {
        d: sankeyLinkHorizontal()(l),
        class: "diagram-link",
        "data-diagram-id": l.id,
        "stroke-width": String(Math.max(3, l.width || 1)),
        tabindex: "-1",
      });
      pth.append(
        svgEl(
          "title",
          {},
          `${label(l.source.id)} to ${label(l.target.id)}: ${l.value}`,
        ),
      );
      pth.addEventListener("click", () => select(l.id));
      gLinks.append(pth);
    });
    const gNodes = svgEl("g", { class: "diagram-nodes" });
    graph.nodes.forEach((n) => {
      if (!n.value) return;
      const h = Math.max(10, n.y1 - n.y0);
      const r = svgEl("rect", {
        x: String(n.x0),
        y: String(n.y0),
        width: String(n.x1 - n.x0),
        height: String(h),
        class: "diagram-node",
        "data-diagram-id": n.id,
      });
      r.append(svgEl("title", {}, `${n.label}: ${n.total}`));
      r.addEventListener("click", () => select(n.id));
      const t = svgEl(
        "text",
        { x: String(n.x1 + 5), y: String(n.y0 + 12) },
        `${n.label} (${n.total})`,
      );
      gNodes.append(r, t);
    });
    svg.append(gLinks, gNodes);
    scroll.append(svg);
    root.append(
      scroll,
      el("div", { "data-diagram-details": "", class: "card" }),
    );
    const sem = el("div", { class: "diagram-semantics" });
    renderTable(
      sem,
      "Origins",
      ["Origin", "Count", "Percentage", "Action"],
      Object.entries(projection.totals.origins).map(([k, v]) => ({
        id: `origin:${k}`,
        cells: [label(k), String(v), pct(v, projection.includedApplications)],
      })),
      select,
    );
    renderTable(
      sem,
      "Endpoints",
      ["Endpoint", "Count", "Percentage", "Action"],
      Object.entries(projection.totals.endpoints).map(([k, v]) => ({
        id: `endpoint:${k}`,
        cells: [label(k), String(v), pct(v, projection.includedApplications)],
      })),
      select,
    );
    renderTable(
      sem,
      "Flows",
      ["From", "To", "Applications", "Action"],
      projection.links.map((l) => ({
        id: l.id,
        cells: [label(l.source), label(l.target), String(l.value)],
      })),
      select,
    );
    renderTable(
      sem,
      "Selected-boundary events",
      ["Event", "Application", "Type", "Action"],
      projection.events.map((e) => ({
        id: "",
        cells: [e.id, e.applicationId, label(e.eventType)],
      })),
      () => {},
    );
    sem.append(
      el(
        "p",
        { class: "muted" },
        [
          `Warnings — inferred history: ${
            projection.warningCounts.inferred_event ?? 0
          };`,
          `unknown origin/time: ${
            (projection.warningCounts.inferred_origin ?? 0) +
            (projection.warningCounts.invalid_timestamp ?? 0)
          };`,
          `status mismatch: ${projection.warningCounts.status_mismatch ?? 0};`,
          `regression: ${projection.warningCounts.regressive_history ?? 0}.`,
        ].join(" "),
      ),
    );
    root.append(sem);
    select(selectedId);
  }
  return {
    update({
      timeline,
      snapshot,
      selectedBucketId = "current",
      newerAvailable = false,
    }) {
      const t = timeline ?? buildLifecycleTimeline(snapshot ?? {});
      draw({
        projection: projectLifecycleAt(snapshot ?? {}, selectedBucketId),
        timeline: t,
        selectedBucketId,
        newerAvailable,
      });
    },
    destroy() {
      ro?.disconnect();
      window.clearTimeout(resizeTimer);
      clear(root);
    },
  };
}
