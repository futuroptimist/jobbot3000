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
export const MINIMUM_RANK_CENTER_SPACING =
  2 * RANK_CORRIDOR_HALF_WIDTH + MINIMUM_TRANSITION_WIDTH;
export const MINIMUM_SVG_WIDTH =
  LAYOUT_LEFT_MARGIN +
  LAYOUT_RIGHT_MARGIN +
  SANKEY_NODE_WIDTH +
  6 * MINIMUM_RANK_CENTER_SPACING;

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
export const compareLifecycleIds = (a, b) =>
  collator.compare(String(a), String(b));
export const endpointOrder = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((item, index) => [item.id, index]),
);
const originOrder = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((item, index) => [item.nodeId, index]),
);
const milestoneRank = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((item, index) => [
    item.nodeId,
    index + 1,
  ]),
);
export const lifecycleNodeRank = (id) => {
  if (String(id).startsWith("origin:")) return 0;
  if (String(id).startsWith("endpoint:")) return 6;
  return milestoneRank.get(id) ?? 1;
};
export const endpointIdFromNode = (id) =>
  String(id ?? "").replace(/^endpoint:/u, "");
export const endpointColor = (endpointId) =>
  ENDPOINT_COLORS[endpointId] ?? ENDPOINT_COLORS.unknown;
export const rankCenterX = (rank) =>
  LAYOUT_LEFT_MARGIN +
  SANKEY_NODE_WIDTH / 2 +
  rank * MINIMUM_RANK_CENTER_SPACING;

const pathEndpoint = (path) =>
  endpointIdFromNode(
    path?.endpointId ??
      path?.terminalEndpointId ??
      path?.nodeIds?.findLast?.((id) => String(id).startsWith("endpoint:")) ??
      "unknown",
  );

export function buildLifecycleDisplayBranches(projection) {
  const pathsById = new Map(
    (projection?.paths ?? []).map((path) => [path.applicationId, path]),
  );
  const branches = [];
  for (const link of projection?.links ?? []) {
    const groups = new Map();
    for (const applicationId of [...(link.applicationIds ?? [])].sort(
      compareLifecycleIds,
    )) {
      const endpointId = pathEndpoint(pathsById.get(applicationId));
      if (!groups.has(endpointId)) groups.set(endpointId, []);
      groups.get(endpointId).push(applicationId);
    }
    for (const [endpointId, applicationIds] of groups) {
      const sourceRank = lifecycleNodeRank(link.source);
      const targetRank = lifecycleNodeRank(link.target);
      const semanticLinkId = link.id;
      const sortKey = [
        String(endpointOrder.get(endpointId) ?? 999).padStart(3, "0"),
        String(sourceRank).padStart(2, "0"),
        link.source,
        String(targetRank).padStart(2, "0"),
        link.target,
        semanticLinkId,
      ].join("|");
      branches.push({
        id: `branch:${semanticLinkId}:endpoint:${endpointId}`,
        semanticLinkId,
        source: link.source,
        target: link.target,
        sourceRank,
        targetRank,
        endpointId,
        value: applicationIds.length,
        applicationIds: [...applicationIds],
        color: endpointColor(endpointId),
        sortKey,
      });
    }
  }
  return branches.sort((a, b) => compareLifecycleIds(a.sortKey, b.sortKey));
}

export function buildLifecycleRoutingGraph(projection) {
  const displayBranches = buildLifecycleDisplayBranches(projection);
  const visibleNodes = (projection?.nodes ?? [])
    .filter((node) => Number(node?.total) > 0)
    .map((node) => ({
      ...node,
      applicationIds: [...(node.applicationIds ?? [])],
      rank: lifecycleNodeRank(node.id),
      routing: false,
    }));
  const nodesById = new Map(visibleNodes.map((node) => [node.id, node]));
  const links = [];
  for (const branch of displayBranches) {
    if (!(branch.targetRank > branch.sourceRank)) continue;
    const chain = [branch.source];
    for (
      let rank = branch.sourceRank + 1;
      rank < branch.targetRank;
      rank += 1
    ) {
      const id = `route:${branch.id}:rank:${rank}`;
      if (!nodesById.has(id))
        nodesById.set(id, {
          id,
          rank,
          branchId: branch.id,
          endpointId: branch.endpointId,
          value: branch.value,
          routing: true,
        });
      chain.push(id);
    }
    chain.push(branch.target);
    const segmentCount = chain.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      links.push({
        id: `${branch.id}:segment:${index}`,
        source: chain[index],
        target: chain[index + 1],
        branchId: branch.id,
        semanticLinkId: branch.semanticLinkId,
        endpointId: branch.endpointId,
        segmentIndex: index,
        segmentCount,
        value: branch.value,
        applicationIds: [...branch.applicationIds],
        color: branch.color,
      });
    }
  }
  return {
    nodes: [...nodesById.values()].sort(lifecycleNodeSort),
    links: links.sort(lifecycleLinkSort),
    displayBranches,
  };
}

export function calculateLifecycleDiagramLayout(
  projectionOrGraph,
  availableWidth,
) {
  const graph = projectionOrGraph?.displayBranches
    ? projectionOrGraph
    : buildLifecycleRoutingGraph(projectionOrGraph);
  const counts = new Map();
  for (const node of graph.nodes ?? [])
    counts.set(node.rank, (counts.get(node.rank) ?? 0) + 1);
  const densestRoutedRank = Math.max(1, ...counts.values());
  const densityHeight =
    LAYOUT_TOP_MARGIN +
    LAYOUT_BOTTOM_MARGIN +
    densestRoutedRank * PER_LANE_VERTICAL_BUDGET +
    Math.max(0, densestRoutedRank - 1) * ROUTED_NODE_PADDING;
  const integerWidth = Math.floor(Number(availableWidth));
  return {
    width: Math.max(
      MINIMUM_SVG_WIDTH,
      Number.isFinite(integerWidth) && integerWidth > 0
        ? integerWidth
        : MINIMUM_SVG_WIDTH,
    ),
    height: Math.max(MINIMUM_SVG_HEIGHT, Math.ceil(densityHeight)),
    nodePadding: ROUTED_NODE_PADDING,
    topMargin: LAYOUT_TOP_MARGIN,
    bottomMargin: LAYOUT_BOTTOM_MARGIN,
  };
}

export const lifecycleNodeSort = (a, b) => {
  const ar = a.rank ?? lifecycleNodeRank(a.id),
    br = b.rank ?? lifecycleNodeRank(b.id);
  if (ar !== br) return ar - br;
  const endpointA =
    endpointOrder.get(a.endpointId ?? endpointIdFromNode(a.id)) ?? 999;
  const endpointB =
    endpointOrder.get(b.endpointId ?? endpointIdFromNode(b.id)) ?? 999;
  if (endpointA !== endpointB) return endpointA - endpointB;
  if (a.routing !== b.routing) return a.routing ? 1 : -1;
  return compareLifecycleIds(
    a.sortKey ?? a.branchId ?? originOrder.get(a.id) ?? a.id,
    b.sortKey ?? b.branchId ?? originOrder.get(b.id) ?? b.id,
  );
};
export const lifecycleLinkSort = (a, b) =>
  (endpointOrder.get(a.endpointId) ?? 999) -
    (endpointOrder.get(b.endpointId) ?? 999) ||
  compareLifecycleIds(a.semanticLinkId, b.semanticLinkId) ||
  compareLifecycleIds(a.branchId, b.branchId) ||
  a.segmentIndex - b.segmentIndex;

export function wrapLifecycleNodeLabel(
  text,
  max = NODE_LABEL_MAX_CHARACTERS_PER_LINE,
) {
  const words = String(text).split(/\s+/u).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length <= 2 ? lines : [lines[0], lines.slice(1).join(" ")];
}

export function adjacentRankSegmentPath(link) {
  const sx = link.source.x1 ?? link.source.x0,
    sy = link.y0;
  const tx = link.target.x0 ?? link.target.x1,
    ty = link.y1;
  const sourceExit = rankCenterX(link.source.rank) + RANK_CORRIDOR_HALF_WIDTH;
  const targetEntry = rankCenterX(link.target.rank) - RANK_CORRIDOR_HALF_WIDTH;
  const c1 = sourceExit + (targetEntry - sourceExit) / 2;
  return [
    `M${sx},${sy}L${sourceExit},${sy}`,
    `C${c1},${sy} ${c1},${ty} ${targetEntry},${ty}`,
    `L${tx},${ty}`,
  ].join("");
}

export function branchHandleCandidates(branchSegments) {
  const preferred =
    branchSegments.find((s) => s.source.routing && s.target.routing) ??
    branchSegments[Math.floor(branchSegments.length / 2)] ??
    branchSegments[0];
  if (!preferred) return [];
  const sourceExit =
    rankCenterX(preferred.source.rank) + RANK_CORRIDOR_HALF_WIDTH;
  const targetEntry =
    rankCenterX(preferred.target.rank) - RANK_CORRIDOR_HALF_WIDTH;
  return [0.5, 0.35, 0.65].map((t) => ({
    branchId: preferred.branchId,
    x: sourceExit + (targetEntry - sourceExit) * t,
    y: (preferred.y0 ?? 0) + ((preferred.y1 ?? 0) - (preferred.y0 ?? 0)) * t,
    r: 22,
  }));
}
