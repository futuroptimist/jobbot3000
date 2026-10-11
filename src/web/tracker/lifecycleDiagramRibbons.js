// Presentation only: retain semantic branches and stage ranks, but group
// outcome bands instead of reproducing the route solver's thin-line detours.
import {
  endpointIndex,
  compareLifecycleIds,
} from "./lifecycleDiagramLayout.js";
// Never feed this geometry back into the solver's cross-bucket seed cache.
const NODE_WIDTH = 8;
const TOP = 64;
const BOTTOM = 48;
const LABEL_GAP = 52;
const ROUTE_GAP = 2;
export const MINIMUM_RIBBON_WIDTH = 1120;

export function layoutLifecycleRibbons(graph, dimensions, availableWidth) {
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links = graph.links.map((link) => ({
    ...link,
    source: byId.get(link.source.id),
    target: byId.get(link.target.id),
  }));
  const branchById = new Map(
    graph.branches.map((branch) => [branch.id, branch]),
  );
  const outcomeCenter = (node) => {
    const incident = links.filter(
      (link) => link.source === node || link.target === node,
    );
    const count = incident.reduce((sum, link) => sum + link.value, 0);
    return count
      ? incident.reduce(
          (sum, link) => sum + endpointIndex(link.endpointId) * link.value,
          0,
        ) / count
      : 0;
  };
  const centers = new Map(nodes.map((node) => [node.id, outcomeCenter(node)]));
  const columns = Array.from({ length: 7 }, (_, rank) =>
    nodes
      .filter((node) => node.rank === rank)
      .sort((a, b) => {
        // Keep source/outcome taxonomy order stable. Intermediate lanes group
        // by their count-weighted outcome; direct flows precede later detours
        // to that same outcome, instead of diving below milestone bands.
        if (rank === 0 || rank === 6)
          return a.y0 - b.y0 || compareLifecycleIds(a.id, b.id);
        return (
          centers.get(a.id) - centers.get(b.id) ||
          Number(b.routing) - Number(a.routing) ||
          (branchById.get(a.branchId)?.sourceRank ?? rank) -
            (branchById.get(b.branchId)?.sourceRank ?? rank) ||
          compareLifecycleIds(a.id, b.id)
        );
      }),
  );
  const width = Math.max(
    MINIMUM_RIBBON_WIDTH,
    Number.isFinite(availableWidth) ? Math.floor(availableWidth) - 26 : 0,
  );
  const height = Math.max(
    520,
    TOP +
      BOTTOM +
      Math.max(
        ...columns.map(
          (column) => column.filter((node) => !node.routing).length,
        ),
      ) *
        80,
  );
  const gap = (node) => (node.routing ? ROUTE_GAP : LABEL_GAP);
  const columnGap = (column) =>
    column.reduce((sum, node, index) => sum + (index ? gap(node) : 0), 0);
  const columnValue = (column) =>
    column.reduce((sum, node) => sum + node.value, 0);
  // A single scale for every rank, node and link. No minimum link thickness:
  // doubling an application count must double its ribbon's thickness.
  const unit = Math.min(
    ...columns
      .filter((column) => column.length)
      .map(
        (column) =>
          (height - TOP - BOTTOM - columnGap(column)) / columnValue(column),
      ),
  );
  const rankCenters = {};
  for (const [rank, column] of columns.entries()) {
    rankCenters[rank] = 92 + (rank * (width - 184)) / 6;
    let y = TOP;
    for (const [index, node] of column.entries()) {
      if (index) y += gap(node);
      node.x0 = rankCenters[rank] - NODE_WIDTH / 2;
      node.x1 = node.x0 + NODE_WIDTH;
      node.y0 = y;
      node.y1 = y + node.value * unit;
      y = node.y1;
      // D3's link arrays refer to the solver graph, not these copied nodes.
      delete node.sourceLinks;
      delete node.targetLinks;
    }
  }
  for (const node of nodes) {
    for (const [side, dock] of [
      ["source", "y0"],
      ["target", "y1"],
    ]) {
      const opposite = side === "source" ? "target" : "source";
      const incident = links
        .filter((link) => link[side] === node)
        .sort(
          (a, b) =>
            a[opposite].y0 - b[opposite].y0 ||
            endpointIndex(a.endpointId) - endpointIndex(b.endpointId) ||
            compareLifecycleIds(a.id, b.id),
        );
      let y = node.y0;
      for (const link of incident) {
        link.width = link.value * unit;
        link[dock] = y + link.width / 2;
        y += link.width;
      }
    }
  }
  // Small pointer targets stay inside their own ribbon. The equivalent HTML
  // flow buttons remain full-size keyboard/touch targets for every branch.
  const handles = new Map();
  for (const branch of graph.branches) {
    const segments = links
      .filter((link) => link.branchId === branch.id)
      .sort((a, b) => a.segmentIndex - b.segmentIndex);
    const segment = segments[Math.floor(segments.length / 2)];
    if (!segment) continue;
    const maxSlope =
      (2 * Math.abs(segment.y1 - segment.y0)) /
      (segment.target.x0 - segment.source.x1);
    handles.set(branch.id, {
      branchId: branch.id,
      x: (segment.source.x1 + segment.target.x0) / 2,
      y: (segment.y0 + segment.y1) / 2,
      radius: Math.min(22, segment.width / (2 * Math.hypot(1, maxSlope))),
    });
  }
  return {
    graph: { ...graph, nodes, links, acceptedHandles: handles },
    dimensions: {
      ...dimensions,
      width,
      height,
      unit,
      horizontalGeometry: { ...dimensions.horizontalGeometry, rankCenters },
    },
  };
}

// One closed band per semantic branch. Routing-only nodes bridge stage
// columns without creating artificial milestones or widening/narrowing flows.
export function lifecycleRibbonPath(segments) {
  if (!segments.length) return "";
  const ordered = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  const first = ordered[0];
  const last = ordered.at(-1);
  const edge = (link, sign, reverse = false) => {
    const x0 = reverse ? link.target.x0 : link.source.x1;
    const x1 = reverse ? link.source.x1 : link.target.x0;
    const y0 = (reverse ? link.y1 : link.y0) + (sign * link.width) / 2;
    const y1 = (reverse ? link.y0 : link.y1) + (sign * link.width) / 2;
    const bend = (x1 - x0) * 0.5;
    return `L ${x0} ${y0} C ${x0 + bend} ${y0} ${x1 - bend} ${y1} ${x1} ${y1}`;
  };
  return [
    `M ${first.source.x1} ${first.y0 - first.width / 2}`,
    ...ordered.map((link) => edge(link, -1)),
    `L ${last.target.x0} ${last.y1 + last.width / 2}`,
    ...ordered.reverse().map((link) => edge(link, 1, true)),
    "Z",
  ].join(" ");
}
