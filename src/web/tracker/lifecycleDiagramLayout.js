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
export const BRANCH_STROKE_OPACITY = 0.82;
export const BRANCH_HANDLE_RADIUS = 22;
export const renderedBranchStrokeWidth = () => 3;

export const ENDPOINT_BRANCH_COLORS = Object.freeze({
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

export const ENDPOINT_ORDER = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((item, index) => [item.id, index]),
);
export const TAXONOMY_BY_NODE_ID = new Map(
  [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
  ].map((item) => [item.nodeId, item]),
);
export const MILESTONE_RANKS = new Map(
  LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((item, index) => [
    `milestone:${item.id}`,
    index + 1,
  ]),
);

export const endpointColor = (endpointId) =>
  ENDPOINT_BRANCH_COLORS[endpointId] ?? ENDPOINT_BRANCH_COLORS.unknown;
export const endpointIndex = (endpointId) =>
  ENDPOINT_ORDER.get(endpointId) ?? ENDPOINT_ORDER.get("unknown") ?? 999;
export const nodeRank = (id) => {
  if (String(id).startsWith("origin:")) return 0;
  if (String(id).startsWith("endpoint:")) return 6;
  return MILESTONE_RANKS.get(id) ?? 1;
};
export const taxonomyOrder = (nodeId) =>
  TAXONOMY_BY_NODE_ID.get(nodeId)?.rank ?? 999;
const taxonomyId = (nodeId) => TAXONOMY_BY_NODE_ID.get(nodeId)?.id ?? nodeId;

export const branchSortKey = (branch) =>
  [
    endpointIndex(branch.endpointId),
    branch.sourceRank,
    taxonomyOrder(branch.source),
    branch.targetRank,
    taxonomyOrder(branch.target),
    branch.semanticLinkId,
  ].join("|");

export const compareBranches = (a, b) =>
  endpointIndex(a.endpointId) - endpointIndex(b.endpointId) ||
  a.sourceRank - b.sourceRank ||
  taxonomyOrder(a.source) - taxonomyOrder(b.source) ||
  a.targetRank - b.targetRank ||
  taxonomyOrder(a.target) - taxonomyOrder(b.target) ||
  compareLifecycleIds(a.semanticLinkId, b.semanticLinkId) ||
  compareLifecycleIds(a.id, b.id);

export function buildLifecycleDisplayBranches(projection = {}) {
  const pathByApp = new Map(
    (projection.paths ?? []).map((path) => [String(path.applicationId), path]),
  );
  const branches = [];
  for (const link of projection.links ?? []) {
    const groups = new Map();
    for (const id of [...(link.applicationIds ?? [])]
      .map(String)
      .sort(compareLifecycleIds)) {
      const endpointId = pathByApp.get(id)?.endpoint ?? "unknown";
      if (!groups.has(endpointId)) groups.set(endpointId, []);
      groups.get(endpointId).push(id);
    }
    for (const [endpointId, applicationIds] of groups) {
      const sourceRank = nodeRank(link.source);
      const targetRank = nodeRank(link.target);
      const semanticLinkId = link.id;
      const id = `branch:${semanticLinkId}:endpoint:${endpointId}`;
      const branch = {
        id,
        semanticLinkId,
        source: link.source,
        target: link.target,
        sourceRank,
        targetRank,
        endpointId,
        value: applicationIds.length,
        applicationIds: [...applicationIds],
        color: endpointColor(endpointId),
      };
      branch.sortKey = branchSortKey(branch);
      branches.push(branch);
    }
  }
  return branches.sort(compareBranches);
}

export const nodeSort = (a, b) => {
  const ar = a.routing ? 1 : 0;
  const br = b.routing ? 1 : 0;
  const rankA = a.rank ?? 0;
  const rankB = b.rank ?? 0;
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === 0 || rankA === 6)
    return (
      taxonomyOrder(a.id) - taxonomyOrder(b.id) ||
      ar - br ||
      compareLifecycleIds(a.branchId ?? a.id, b.branchId ?? b.id)
    );
  const medianA = a.routing
    ? endpointIndex(a.endpointId)
    : (a.weightedEndpointMedian ?? 999);
  const medianB = b.routing
    ? endpointIndex(b.endpointId)
    : (b.weightedEndpointMedian ?? 999);
  return (
    (medianA ?? 999) - (medianB ?? 999) ||
    ar - br ||
    compareLifecycleIds(taxonomyId(a.id), taxonomyId(b.id)) ||
    compareLifecycleIds(a.branchId ?? "", b.branchId ?? "") ||
    compareLifecycleIds(a.sortKey ?? a.id, b.sortKey ?? b.id)
  );
};

export const linkSort = (a, b) =>
  endpointIndex(a.endpointId) - endpointIndex(b.endpointId) ||
  compareLifecycleIds(a.semanticLinkId, b.semanticLinkId) ||
  compareLifecycleIds(a.branchId, b.branchId) ||
  (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0);

const weightedMedianEndpoint = (nodeId, branches) => {
  const values = [];
  for (const branch of branches) {
    if (branch.source === nodeId || branch.target === nodeId)
      values.push([endpointIndex(branch.endpointId), branch.value]);
  }
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return 999;
  values.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (const [index, value] of values) {
    acc += value;
    if (acc >= total / 2) return index;
  }
  return values.at(-1)?.[0] ?? 999;
};

export function buildLifecycleRoutingGraph(projection = {}) {
  const branches = buildLifecycleDisplayBranches(projection);
  const nodes = new Map();
  for (const node of projection.nodes ?? []) {
    if (!(Number(node.total) > 0)) continue;
    nodes.set(node.id, {
      ...node,
      applicationIds: [...(node.applicationIds ?? [])],
      rank: nodeRank(node.id),
      routing: false,
      weightedEndpointMedian: weightedMedianEndpoint(node.id, branches),
    });
  }
  const links = [];
  for (const branch of branches) {
    if (!(branch.targetRank > branch.sourceRank)) continue;
    nodes.set(
      branch.source,
      nodes.get(branch.source) ?? {
        id: branch.source,
        label: TAXONOMY_BY_NODE_ID.get(branch.source)?.label ?? branch.source,
        rank: branch.sourceRank,
        routing: false,
        total: branch.value,
        applicationIds: [...branch.applicationIds],
      },
    );
    nodes.set(
      branch.target,
      nodes.get(branch.target) ?? {
        id: branch.target,
        label: TAXONOMY_BY_NODE_ID.get(branch.target)?.label ?? branch.target,
        rank: branch.targetRank,
        routing: false,
        total: branch.value,
        applicationIds: [...branch.applicationIds],
      },
    );
    const ids = [branch.source];
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
        sortKey: branch.sortKey,
      });
      ids.push(id);
    }
    ids.push(branch.target);
    const segmentCount = ids.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      links.push({
        id: `${branch.id}:segment:${index}`,
        source: ids[index],
        target: ids[index + 1],
        branchId: branch.id,
        semanticLinkId: branch.semanticLinkId,
        endpointId: branch.endpointId,
        segmentIndex: index,
        segmentCount,
        value: branch.value,
        applicationIds: [...branch.applicationIds],
        color: branch.color,
        sortKey: branch.sortKey,
      });
    }
  }
  return {
    nodes: [...nodes.values()].sort(nodeSort),
    links: links.sort(linkSort),
    branches,
  };
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
  const graph = routingGraph ?? buildLifecycleRoutingGraph(projection);
  const rankCounts = new Map();
  for (const node of graph.nodes ?? []) {
    if (node.routing || Number(node.total) > 0 || Number(node.value) > 0)
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
    densestRoutedRank,
  };
}

export const rankCenterX = (rank) =>
  LAYOUT_LEFT_MARGIN +
  SANKEY_NODE_WIDTH / 2 +
  rank * MINIMUM_RANK_CENTER_SPACING;

export function layoutLifecycleRoutingGraph(projection, availableWidth) {
  const graph = buildLifecycleRoutingGraph(projection);
  const dimensions = calculateLifecycleDiagramLayout(
    projection,
    availableWidth,
    graph,
  );
  const layout = sankey()
    .nodeId((d) => d.id)
    .nodeAlign((node) => node.rank)
    .nodeWidth(SANKEY_NODE_WIDTH)
    .nodePadding(ROUTED_NODE_PADDING)
    .nodeSort(nodeSort)
    .linkSort(linkSort)
    .extent([
      [LAYOUT_LEFT_MARGIN, LAYOUT_TOP_MARGIN],
      [
        dimensions.width - LAYOUT_RIGHT_MARGIN,
        dimensions.height - LAYOUT_BOTTOM_MARGIN,
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

  const transitionLinksByRank = new Map();
  for (const link of graph.links) {
    const key = `${link.source.rank}:${link.target.rank}`;
    if (!transitionLinksByRank.has(key)) transitionLinksByRank.set(key, []);
    transitionLinksByRank.get(key).push(link);
  }
  const laneTop = LAYOUT_TOP_MARGIN + PER_LANE_VERTICAL_BUDGET / 2;
  const laneBottom =
    dimensions.height - LAYOUT_BOTTOM_MARGIN - PER_LANE_VERTICAL_BUDGET / 2;
  for (const links of transitionLinksByRank.values()) {
    const ordered = links.sort(
      (a, b) => a.y1 - b.y1 || b.y0 - a.y0 || linkSort(a, b),
    );
    const step =
      ordered.length > 1 ? (laneBottom - laneTop) / (ordered.length - 1) : 0;
    ordered.forEach((link, index) => {
      link.transitionLaneY =
        ordered.length > 1
          ? laneTop + step * index
          : (laneTop + laneBottom) / 2;
    });
  }

  return { graph, dimensions };
}

const point = (x, y) => `${Number(x).toFixed(3)},${Number(y).toFixed(3)}`;
export function adjacentRankSegmentPath(segment) {
  const sourceCenter = rankCenterX(segment.source.rank);
  const targetCenter = rankCenterX(segment.target.rank);
  const sourceY = segment.y0;
  const targetY = segment.y1;
  const sourceDockX = segment.source.routing ? sourceCenter : segment.source.x1;
  const targetDockX = segment.target.routing ? targetCenter : segment.target.x0;
  const exitX = sourceCenter + RANK_CORRIDOR_HALF_WIDTH;
  const entryX = targetCenter - RANK_CORRIDOR_HALF_WIDTH;
  const c1 = exitX + (entryX - exitX) / 3;
  const c2 = entryX - (entryX - exitX) / 3;
  const laneY = Number.isFinite(segment.transitionLaneY)
    ? segment.transitionLaneY
    : targetY;
  return [
    `M${point(sourceDockX, sourceY)}`,
    `L${point(exitX, sourceY)}`,
    [`C${point(c1, laneY)}`, point(c2, laneY), point(entryX, targetY)].join(
      " ",
    ),
    `L${point(targetDockX, targetY)}`,
  ].join("");
}

export function compoundBranchPath(segments) {
  return segments.map(adjacentRankSegmentPath).join("");
}

export function wrapLifecycleLabel(
  text,
  max = NODE_LABEL_MAX_CHARACTERS_PER_LINE,
) {
  const words = String(text).split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  throw new Error(
    `Lifecycle label exceeds two ${max}-character lines: ${text}`,
  );
}

export function labelBoxForNode(node) {
  const lines = wrapLifecycleLabel(node.label);
  const width = NODE_LABEL_MAX_WIDTH;
  const height = lines.length * 16;
  const x = Math.max(0, rankCenterX(node.rank) - width / 2);
  const y = Math.max(0, node.y0 - height - 12);
  return { x, y, width, height, lines };
}

export const cubicTransitionPoint = (segment, t) => {
  const sourceCenter = rankCenterX(segment.source.rank);
  const targetCenter = rankCenterX(segment.target.rank);
  const exitX = sourceCenter + RANK_CORRIDOR_HALF_WIDTH;
  const entryX = targetCenter - RANK_CORRIDOR_HALF_WIDTH;
  const c1 = exitX + (entryX - exitX) / 3;
  const c2 = entryX - (entryX - exitX) / 3;
  const laneY = Number.isFinite(segment.transitionLaneY)
    ? segment.transitionLaneY
    : segment.y1;
  const oneMinus = 1 - t;
  return {
    x:
      oneMinus ** 3 * exitX +
      3 * oneMinus ** 2 * t * c1 +
      3 * oneMinus * t ** 2 * c2 +
      t ** 3 * entryX,
    y:
      oneMinus ** 3 * segment.y0 +
      3 * oneMinus ** 2 * t * laneY +
      3 * oneMinus * t ** 2 * laneY +
      t ** 3 * segment.y1,
  };
};

const boxesOverlap = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
export function assignBranchHandles(
  branches,
  segmentsByBranch,
  visibleNodes = [],
) {
  const handles = [];
  const nodeBoxes = visibleNodes.map((node) => ({
    x: node.x0,
    y: node.y0,
    width: node.x1 - node.x0,
    height: node.y1 - node.y0,
  }));
  const labelBoxes = visibleNodes.map(labelBoxForNode);
  const renderedBranchSamples = [];
  for (const [branchId, segments] of segmentsByBranch) {
    for (const segment of segments) {
      const renderedWidth = renderedBranchStrokeWidth(segment.width);
      const clearance = BRANCH_HANDLE_RADIUS + (renderedWidth + 12) / 2;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        renderedBranchSamples.push({
          branchId,
          ...cubicTransitionPoint(segment, Math.min(1, t)),
          clearance,
        });
      }
    }
  }
  const fixedGeometryBlocksCandidate = (box) =>
    [...nodeBoxes, ...labelBoxes, ...handles.map((h) => h.box)].some((b) =>
      boxesOverlap(box, b),
    );
  const renderedBranchClearanceMargin = (branch, x, y) =>
    renderedBranchSamples.reduce((margin, sample) => {
      if (sample.branchId === branch.id) return margin;
      return Math.min(
        margin,
        Math.hypot(sample.x - x, sample.y - y) - sample.clearance,
      );
    }, Number.POSITIVE_INFINITY);
  const candidateClearsRequiredGeometry = (branch, x, y, box) =>
    !fixedGeometryBlocksCandidate(box) &&
    renderedBranchClearanceMargin(branch, x, y) > 0;
  for (const branch of [...branches].sort(compareBranches)) {
    const segments = [...(segmentsByBranch.get(branch.id) ?? [])].sort(
      (a, b) => a.segmentIndex - b.segmentIndex,
    );
    const preferred =
      segments.find((s) => s.source.routing && s.target.routing) ??
      segments[Math.floor(segments.length / 2)] ??
      segments[0];
    const ordered = [preferred, ...segments.filter((s) => s !== preferred)];
    let chosen;
    let fixedGeometrySafeCandidate;
    for (const segment of ordered) {
      const sourceCenter = rankCenterX(segment.source.rank);
      const targetCenter = rankCenterX(segment.target.rank);
      const exitX = sourceCenter + RANK_CORRIDOR_HALF_WIDTH;
      const entryX = targetCenter - RANK_CORRIDOR_HALF_WIDTH;
      const candidates = [0.5, 0.35, 0.65].map((t) =>
        cubicTransitionPoint(segment, t),
      );
      for (const { x, y } of candidates) {
        const box = {
          x: x - BRANCH_HANDLE_RADIUS,
          y: y - BRANCH_HANDLE_RADIUS,
          width: BRANCH_HANDLE_RADIUS * 2,
          height: BRANCH_HANDLE_RADIUS * 2,
        };
        if (x - BRANCH_HANDLE_RADIUS < exitX) continue;
        if (x + BRANCH_HANDLE_RADIUS > entryX) continue;
        if (fixedGeometryBlocksCandidate(box)) continue;
        const clearanceMargin = renderedBranchClearanceMargin(branch, x, y);
        const candidate = {
          branchId: branch.id,
          x,
          y,
          radius: BRANCH_HANDLE_RADIUS,
          box,
          clearanceMargin,
        };
        fixedGeometrySafeCandidate ??= candidate;
        if (!candidateClearsRequiredGeometry(branch, x, y, box)) continue;
        chosen = candidate;
        break;
      }
      if (chosen) break;
    }
    if (!chosen) chosen = fixedGeometrySafeCandidate;
    if (!chosen)
      throw new Error(
        `Lifecycle diagram handle placement invariant violated for ${branch.id}`,
      );
    handles.push(chosen);
  }
  return handles;
}
