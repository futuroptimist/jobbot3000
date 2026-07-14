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
export const BRANCH_HANDLE_DIAMETER = 44;
export const LIFECYCLE_ENDPOINT_COLORS = Object.freeze({
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
const endpointOrder = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((item, index) => [item.id, index]),
);
const taxonomyByNodeId = new Map(
  [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
  ].map((item) => [item.nodeId, item]),
);
const milestoneRanks = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((item, index) => [
    item.nodeId,
    index + 1,
  ]),
);

export function lifecycleNodeRank(id) {
  if (String(id).startsWith("origin:")) return 0;
  if (String(id).startsWith("endpoint:")) return 6;
  return milestoneRanks.get(id) ?? 1;
}

export function endpointColor(endpointId) {
  return (
    LIFECYCLE_ENDPOINT_COLORS[endpointId] ?? LIFECYCLE_ENDPOINT_COLORS.unknown
  );
}

export function endpointSortIndex(endpointId) {
  return endpointOrder.get(endpointId) ?? endpointOrder.get("unknown") ?? 999;
}

const endpointFromPath = (path) =>
  path?.endpoint ??
  String(
    (path?.nodeIds ?? []).findLast?.((id) =>
      String(id).startsWith("endpoint:"),
    ) ?? "endpoint:unknown",
  ).replace(/^endpoint:/u, "");

export function buildLifecycleDisplayBranches(projection = {}) {
  const pathsById = new Map(
    (projection.paths ?? []).map((path) => [path.applicationId, path]),
  );
  const branches = [];
  for (const link of projection.links ?? []) {
    const groups = new Map();
    for (const applicationId of [...(link.applicationIds ?? [])].sort(
      compareLifecycleIds,
    )) {
      const endpointId = endpointFromPath(pathsById.get(applicationId));
      if (!groups.has(endpointId)) groups.set(endpointId, []);
      groups.get(endpointId).push(applicationId);
    }
    for (const [endpointId, applicationIds] of groups) {
      const sourceRank = lifecycleNodeRank(link.source);
      const targetRank = lifecycleNodeRank(link.target);
      const sortKey = [
        String(endpointSortIndex(endpointId)).padStart(3, "0"),
        String(sourceRank).padStart(2, "0"),
        link.source,
        String(targetRank).padStart(2, "0"),
        link.target,
        link.id,
      ].join("|");
      branches.push({
        id: `branch:${link.id}:endpoint:${endpointId}`,
        semanticLinkId: link.id,
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

export function buildLifecycleRoutingGraph(projection = {}) {
  const displayBranches = buildLifecycleDisplayBranches(projection);
  const nodes = new Map();
  for (const node of projection.nodes ?? [])
    if (Number(node.total) > 0)
      nodes.set(node.id, {
        ...node,
        rank: lifecycleNodeRank(node.id),
        routing: false,
      });
  const links = [];
  for (const branch of displayBranches) {
    if (!(branch.targetRank > branch.sourceRank))
      throw new Error(`Invalid lifecycle branch ranks: ${branch.id}`);
    let previous = branch.source;
    const routeIds = [];
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
        routing: true,
      });
      routeIds.push(id);
    }
    const chain = [...routeIds, branch.target];
    const segmentCount = chain.length;
    chain.forEach((target, index) => {
      links.push({
        id: `${branch.id}:segment:${index}`,
        source: previous,
        target,
        branchId: branch.id,
        semanticLinkId: branch.semanticLinkId,
        endpointId: branch.endpointId,
        segmentIndex: index,
        segmentCount,
        value: branch.value,
        applicationIds: [...branch.applicationIds],
        color: branch.color,
      });
      previous = target;
    });
  }
  return { nodes: [...nodes.values()], links, displayBranches };
}

export function rankCenterX(rank) {
  return (
    LAYOUT_LEFT_MARGIN +
    SANKEY_NODE_WIDTH / 2 +
    rank * MINIMUM_RANK_CENTER_SPACING
  );
}

export function calculateLifecycleDiagramLayout(
  projection,
  availableWidth,
  routingGraph,
) {
  const integerWidth = Math.floor(Number(availableWidth));
  const sanitizedWidth =
    Number.isFinite(integerWidth) && integerWidth > 0
      ? integerWidth
      : MINIMUM_SVG_WIDTH;
  const graph = routingGraph ?? buildLifecycleRoutingGraph(projection ?? {});
  const rankCounts = new Map();
  for (const node of graph.nodes ?? []) {
    if (node.routing || Number(node.total) > 0)
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

export function wrapLifecycleNodeLabel(
  text,
  maxCharacters = NODE_LABEL_MAX_CHARACTERS_PER_LINE,
) {
  const words = String(text).split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length <= 2 ? lines : [lines[0], lines.slice(1).join(" ")];
}

export function adjacentRankSegmentPath(link) {
  const sx = link.source.x1 ?? link.source.x0;
  const tx = link.target.x0;
  const sy = link.y0;
  const ty = link.y1;
  const sourceExit = rankCenterX(link.source.rank) + RANK_CORRIDOR_HALF_WIDTH;
  const targetEntry = rankCenterX(link.target.rank) - RANK_CORRIDOR_HALF_WIDTH;
  const c1 = sourceExit + (targetEntry - sourceExit) / 3;
  const c2 = targetEntry - (targetEntry - sourceExit) / 3;
  return [
    `M${sx},${sy}`,
    `L${sourceExit},${sy}`,
    `C${c1},${sy} ${c2},${ty} ${targetEntry},${ty}`,
    `L${tx},${ty}`,
  ].join(" ");
}

export function branchHandleCandidates(link) {
  const sourceExit = rankCenterX(link.source.rank) + RANK_CORRIDOR_HALF_WIDTH;
  const targetEntry = rankCenterX(link.target.rank) - RANK_CORRIDOR_HALF_WIDTH;
  return [0.5, 0.35, 0.65].map((t) => ({
    x: sourceExit + (targetEntry - sourceExit) * t,
    y: (link.y0 ?? 0) + ((link.y1 ?? 0) - (link.y0 ?? 0)) * t,
    segmentIndex: link.segmentIndex,
  }));
}

export function taxonomyLabel(nodeId) {
  return taxonomyByNodeId.get(nodeId)?.label ?? nodeId;
}
