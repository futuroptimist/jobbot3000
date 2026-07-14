import { sankey } from "d3-sankey";
import { LIFECYCLE_DIAGRAM_TAXONOMY } from "./lifecycleProjection.js";

export const SANKEY_NODE_WIDTH = 18;
export const MINIMUM_SVG_HEIGHT = 360;
export const LAYOUT_TOP_MARGIN = 64;
export const LAYOUT_BOTTOM_MARGIN = 48;
export const ROUTED_NODE_PADDING = 72;
export const PER_LANE_VERTICAL_BUDGET = 36;
export const NODE_LABEL_MAX_WIDTH = 176;
export const NODE_LABEL_MAX_CHARACTERS_PER_LINE = 22;
export const RANK_CORRIDOR_HALF_WIDTH = 100;
export const MINIMUM_TRANSITION_WIDTH = 72;
export const LAYOUT_LEFT_MARGIN = 100;
export const LAYOUT_RIGHT_MARGIN = 100;
export const MINIMUM_RANK_CENTER_SPACING = 272;
export const MINIMUM_SVG_WIDTH =
  LAYOUT_LEFT_MARGIN +
  LAYOUT_RIGHT_MARGIN +
  SANKEY_NODE_WIDTH +
  6 * MINIMUM_RANK_CENTER_SPACING;
export const BRANCH_HANDLE_RADIUS = 22;
export const ENDPOINT_COLORS = Object.freeze({
  awaiting_response: "#60A5FA",
  interviewing: "#C084FC",
  assessment_in_progress: "#FACC15",
  offer_negotiating: "#2DD4BF",
  employer_rejected: "#FB7185",
  candidate_withdrew: "#FB923C",
  offer_declined: "#F472B6",
  offer_expired_rescinded: "#A3E635",
  offer_accepted: "#4ADE80",
  closed_archived: "#94A3B8",
  unknown: "#E2E8F0",
});

const collator = new Intl.Collator(undefined, { numeric: true });
export const compareLifecycleDiagramValues = (a, b) =>
  collator.compare(String(a), String(b));
const endpointOrder = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((item, index) => [item.id, index]),
);
const milestoneRank = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((item, index) => [
    item.nodeId,
    index + 1,
  ]),
);
const taxonomyOrder = new Map(
  [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
  ].map((item, index) => [item.nodeId, index]),
);

export const endpointIndex = (endpointId) =>
  endpointOrder.get(endpointId) ?? endpointOrder.get("unknown") ?? 999;
export const endpointColor = (endpointId) =>
  ENDPOINT_COLORS[endpointId] ?? ENDPOINT_COLORS.unknown;
export const nodeRank = (id) => {
  if (String(id).startsWith("origin:")) return 0;
  if (String(id).startsWith("endpoint:")) return 6;
  return milestoneRank.get(id) ?? 1;
};
const taxonomyId = (nodeId) => String(nodeId).split(":").at(-1) ?? nodeId;
const branchSortKey = (link, endpointId) =>
  [
    String(endpointIndex(endpointId)).padStart(3, "0"),
    String(nodeRank(link.source)).padStart(2, "0"),
    taxonomyId(link.source),
    String(nodeRank(link.target)).padStart(2, "0"),
    taxonomyId(link.target),
    link.id,
  ].join("|");
export const compareBranches = (a, b) =>
  compareLifecycleDiagramValues(a.sortKey, b.sortKey) ||
  compareLifecycleDiagramValues(a.id, b.id);

export function buildLifecycleDisplayBranches(projection) {
  const pathByApp = new Map(
    (projection?.paths ?? []).map((path) => [path.applicationId, path]),
  );
  const branches = [];
  for (const link of projection?.links ?? []) {
    const grouped = new Map();
    for (const appId of [...(link.applicationIds ?? [])].sort(
      compareLifecycleDiagramValues,
    )) {
      const endpointId = pathByApp.get(appId)?.endpoint ?? "unknown";
      if (!grouped.has(endpointId)) grouped.set(endpointId, []);
      grouped.get(endpointId).push(appId);
    }
    for (const [endpointId, applicationIds] of grouped) {
      const id = `branch:${link.id}:endpoint:${endpointId}`;
      branches.push({
        id,
        semanticLinkId: link.id,
        source: link.source,
        target: link.target,
        sourceRank: nodeRank(link.source),
        targetRank: nodeRank(link.target),
        endpointId,
        value: applicationIds.length,
        applicationIds: [...applicationIds].sort(compareLifecycleDiagramValues),
        color: endpointColor(endpointId),
        sortKey: branchSortKey(link, endpointId),
      });
    }
  }
  return branches.sort(compareBranches);
}

export function buildLifecycleRoutingGraph(projection) {
  const branches = buildLifecycleDisplayBranches(projection);
  const visibleNodes = (projection?.nodes ?? []).map((node) => ({
    ...node,
    applicationIds: [...(node.applicationIds ?? [])],
    rank: nodeRank(node.id),
    routing: false,
  }));
  const nodes = new Map(visibleNodes.map((node) => [node.id, node]));
  const links = [];
  for (const branch of branches) {
    if (branch.targetRank <= branch.sourceRank)
      throw new Error(`Lifecycle branch must advance ranks: ${branch.id}`);
    const chain = [branch.source];
    for (
      let rank = branch.sourceRank + 1;
      rank < branch.targetRank;
      rank += 1
    ) {
      const id = `route:${branch.id}:rank:${rank}`;
      nodes.set(id, {
        id,
        rank,
        branchId: branch.id,
        endpointId: branch.endpointId,
        value: branch.value,
        total: branch.value,
        routing: true,
        sortKey: branch.sortKey,
      });
      chain.push(id);
    }
    chain.push(branch.target);
    const segmentCount = chain.length - 1;
    for (let i = 0; i < segmentCount; i += 1) {
      const source = chain[i];
      const target = chain[i + 1];
      links.push({
        id: `${branch.id}:segment:${i}`,
        source,
        target,
        value: branch.value,
        branchId: branch.id,
        semanticLinkId: branch.semanticLinkId,
        endpointId: branch.endpointId,
        segmentIndex: i,
        segmentCount,
        applicationIds: [...branch.applicationIds],
        color: branch.color,
        sortKey: branch.sortKey,
      });
    }
  }
  return { nodes: [...nodes.values()], links, branches };
}

export function calculateLifecycleDiagramLayout(
  projectionOrGraph,
  availableWidth,
) {
  const graph = projectionOrGraph?.branches
    ? projectionOrGraph
    : buildLifecycleRoutingGraph(projectionOrGraph);
  const integerWidth = Math.floor(Number(availableWidth));
  const sanitizedWidth =
    Number.isFinite(integerWidth) && integerWidth > 0
      ? integerWidth
      : MINIMUM_SVG_WIDTH;
  const rankCounts = new Map();
  for (const node of graph.nodes ?? []) {
    const active = node.routing
      ? Number(node.value) > 0
      : Number(node.total) > 0;
    if (!active) continue;
    rankCounts.set(node.rank, (rankCounts.get(node.rank) ?? 0) + 1);
  }
  const densestRoutedRank = Math.max(1, ...rankCounts.values());
  const densityHeight =
    LAYOUT_TOP_MARGIN +
    LAYOUT_BOTTOM_MARGIN +
    densestRoutedRank * PER_LANE_VERTICAL_BUDGET +
    Math.max(0, densestRoutedRank - 1) * ROUTED_NODE_PADDING;
  return {
    width: Math.max(MINIMUM_SVG_WIDTH, sanitizedWidth),
    height: Math.max(MINIMUM_SVG_HEIGHT, Math.ceil(densityHeight)),
    nodePadding: ROUTED_NODE_PADDING,
    topMargin: LAYOUT_TOP_MARGIN,
    bottomMargin: LAYOUT_BOTTOM_MARGIN,
  };
}

const nodeOrderValue = (node) => {
  if (node.routing)
    return [1, endpointIndex(node.endpointId), node.sortKey ?? "", node.id];
  const id = taxonomyId(node.id);
  if (node.rank === 0 || node.rank === 6)
    return [0, taxonomyOrder.get(node.id) ?? 999, id, node.id];
  return [
    0,
    endpointIndex(node.endpointId),
    taxonomyOrder.get(node.id) ?? 999,
    id,
  ];
};
export const compareRoutingNodes = (a, b) => {
  const av = nodeOrderValue(a),
    bv = nodeOrderValue(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
    const cmp = compareLifecycleDiagramValues(av[i] ?? "", bv[i] ?? "");
    if (cmp) return cmp;
  }
  return 0;
};
export const compareRoutingLinks = (a, b) =>
  endpointIndex(a.endpointId) - endpointIndex(b.endpointId) ||
  compareLifecycleDiagramValues(a.semanticLinkId, b.semanticLinkId) ||
  compareLifecycleDiagramValues(a.branchId, b.branchId) ||
  a.segmentIndex - b.segmentIndex;

export function layoutLifecycleRoutingGraph(projection, availableWidth) {
  const graph = buildLifecycleRoutingGraph(projection);
  const dimensions = calculateLifecycleDiagramLayout(graph, availableWidth);
  const layout = sankey()
    .nodeId((node) => node.id)
    .nodeAlign((node) => node.rank)
    .nodeWidth(SANKEY_NODE_WIDTH)
    .nodePadding(ROUTED_NODE_PADDING)
    .nodeSort(compareRoutingNodes)
    .linkSort(compareRoutingLinks)
    .extent([
      [LAYOUT_LEFT_MARGIN, dimensions.topMargin],
      [
        dimensions.width - LAYOUT_RIGHT_MARGIN,
        dimensions.height - dimensions.bottomMargin,
      ],
    ]);
  layout(graph);
  for (const node of graph.nodes) {
    const center = rankCenterX(node.rank);
    if (node.routing) node.x0 = node.x1 = center;
    else {
      node.x0 = center - SANKEY_NODE_WIDTH / 2;
      node.x1 = center + SANKEY_NODE_WIDTH / 2;
    }
  }
  layout.update(graph);
  return { graph, dimensions };
}

export const rankCenterX = (rank) =>
  LAYOUT_LEFT_MARGIN +
  SANKEY_NODE_WIDTH / 2 +
  rank * MINIMUM_RANK_CENTER_SPACING;
export const rankCorridor = (rank) => ({
  left: rankCenterX(rank) - RANK_CORRIDOR_HALF_WIDTH,
  right: rankCenterX(rank) + RANK_CORRIDOR_HALF_WIDTH,
});

export function adjacentRankSegmentPath(link) {
  const sourceRank = link.source.rank;
  const targetRank = link.target.rank;
  const sourceX = link.source.x1;
  const targetX = link.target.x0;
  const y0 = link.y0;
  const y1 = link.y1;
  const sourceExit = rankCorridor(sourceRank).right;
  const targetEntry = rankCorridor(targetRank).left;
  const c1 = sourceExit + (targetEntry - sourceExit) / 2;
  return (
    `M${sourceX},${y0}L${sourceExit},${y0}` +
    `C${c1},${y0} ${c1},${y1} ${targetEntry},${y1}` +
    `L${targetX},${y1}`
  );
}

export function compoundBranchPath(segments) {
  return segments.map(adjacentRankSegmentPath).join("");
}

export function wrapLifecycleNodeLabel(text) {
  const words = String(text).split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= NODE_LABEL_MAX_CHARACTERS_PER_LINE || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(" ")];
}

export function branchHandleCandidates(segment) {
  const sourceExit = rankCorridor(segment.source.rank).right;
  const targetEntry = rankCorridor(segment.target.rank).left;
  return [0.5, 0.35, 0.65].map((t) => ({
    x: sourceExit + (targetEntry - sourceExit) * t,
    y: segment.y0 + (segment.y1 - segment.y0) * t,
    r: BRANCH_HANDLE_RADIUS,
    branchId: segment.branchId,
  }));
}

export function assignBranchHandles(branches, segmentsByBranch) {
  const handles = [];
  const intersects = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
  for (const branch of [...branches].sort(compareBranches)) {
    const segments = segmentsByBranch.get(branch.id) ?? [];
    const preferred =
      segments.find((s) => s.source.routing && s.target.routing) ??
      segments[Math.floor(segments.length / 2)] ??
      segments[0];
    const candidates = [preferred, ...segments.filter((s) => s !== preferred)]
      .flatMap(branchHandleCandidates)
      .filter((candidate) => !handles.some((h) => intersects(candidate, h)));
    handles.push(candidates[0] ?? branchHandleCandidates(preferred)[0]);
  }
  return handles;
}
