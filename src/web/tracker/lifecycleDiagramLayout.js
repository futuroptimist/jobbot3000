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
export const selectedEnvelopeRadius = (segment) =>
  (renderedBranchStrokeWidth(segment?.width) + 12) / 2;

export const rendererHitBoxForNode = (node) => {
  const size = BRANCH_HANDLE_RADIUS * 2;
  const nodeWidth = node.x1 - node.x0;
  const nodeHeight = node.y1 - node.y0;
  const width = Math.max(size, nodeWidth);
  const height = Math.max(size, nodeHeight);
  return {
    id: node.id,
    x: (node.x0 + node.x1 - width) / 2,
    y: (node.y0 + node.y1 - height) / 2,
    width,
    height,
  };
};
const LANE_Y_EPSILON = 0.001;
const COLLISION_MARGIN = -1;
const LANE_SOLVER_STATE_LIMIT = 250000;
export const lifecycleLaneSolverDebug = { stateCounts: [] };

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
      const sourceNodeId = link.source;
      const targetNodeId = link.target;
      const sourceRank = nodeRank(sourceNodeId);
      const targetRank = nodeRank(targetNodeId);
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
  const rankByNodeId = new Map(
    (graph.nodes ?? []).map((node) => [node.id, node.rank]),
  );
  const endpointId = (endpoint) =>
    endpoint && typeof endpoint === "object" ? endpoint.id : endpoint;
  const endpointRank = (link, name) => {
    const id = endpointId(link[name]);
    const rank = rankByNodeId.get(id);
    if (!Number.isFinite(rank)) {
      throw new Error(
        [
          "Lifecycle diagram layout invariant violated:",
          `link ${link.id ?? "<unknown>"}`,
          `references ${name} ${String(id)}`,
          "without finite graph node rank data",
        ].join(" "),
      );
    }
    return rank;
  };
  const transitionCounts = new Map();
  for (const link of graph.links ?? []) {
    const sourceRank = endpointRank(link, "source");
    const targetRank = endpointRank(link, "target");
    if (targetRank <= sourceRank || targetRank !== sourceRank + 1) {
      throw new Error(
        [
          "Lifecycle diagram layout invariant violated:",
          `link ${link.id ?? "<unknown>"}`,
          `has non-adjacent or reversed ranks ${sourceRank}->${targetRank}`,
        ].join(" "),
      );
    }
    transitionCounts.set(
      sourceRank,
      (transitionCounts.get(sourceRank) ?? 0) + 1,
    );
  }
  const densestRoutedRank = Math.max(
    1,
    ...rankCounts.values(),
    ...transitionCounts.values(),
  );
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
  const rankLayers = [...new Set(graph.nodes.map((node) => node.rank))].sort(
    (left, right) => left - right,
  );
  const layerByRank = new Map(rankLayers.map((rank, index) => [rank, index]));
  const layout = sankey()
    .nodeId((d) => d.id)
    .nodeAlign((node) => layerByRank.get(node.rank) ?? 0)
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

  const orderedBranches = [...graph.branches].sort(compareBranches);
  const branchById = new Map(
    orderedBranches.map((branch) => [branch.id, branch]),
  );
  const compareBranchLinks = (left, right) => {
    const leftBranch = branchById.get(left.branchId);
    const rightBranch = branchById.get(right.branchId);
    if (!leftBranch || !rightBranch) {
      throw new Error(
        [
          "Lifecycle diagram routing invariant violated:",
          "missing branch metadata for link comparison",
          left.branchId,
          right.branchId,
        ].join(" "),
      );
    }
    const leftSourceCenter = (left.source.y0 + left.source.y1) / 2;
    const rightSourceCenter = (right.source.y0 + right.source.y1) / 2;
    const leftTargetCenter = (left.target.y0 + left.target.y1) / 2;
    const rightTargetCenter = (right.target.y0 + right.target.y1) / 2;
    return (
      leftSourceCenter - rightSourceCenter ||
      leftTargetCenter - rightTargetCenter ||
      compareBranches(leftBranch, rightBranch) ||
      left.segmentIndex - right.segmentIndex ||
      linkSort(left, right)
    );
  };
  const visibleNodes = graph.nodes.filter(
    (node) => !node.routing && Number(node.total) > 0,
  );
  const nodeBoxes = visibleNodes.map((node) => ({
    kind: "node",
    id: node.id,
    x: node.x0,
    y: node.y0,
    width: node.x1 - node.x0,
    height: node.y1 - node.y0,
  }));
  const labelBoxes = visibleNodes.map((node) => ({
    kind: "label",
    id: node.id,
    ...labelBoxForNode(node),
  }));
  const hitBoxes = visibleNodes.map((node) => ({
    kind: "hit",
    ...rendererHitBoxForNode(node),
  }));
  const laneObstacles = [...nodeBoxes, ...labelBoxes, ...hitBoxes];
  const laneTop = BRANCH_HANDLE_RADIUS + 4;
  const laneBottom = dimensions.height - BRANCH_HANDLE_RADIUS - 4;
  const routeEnvelopeRadius = selectedEnvelopeRadius({ width: 1 });
  const clearancePad = routeEnvelopeRadius + 0.25 + LANE_Y_EPSILON;
  const minLaneSpacing =
    BRANCH_HANDLE_RADIUS * 2 + routeEnvelopeRadius * 2 + 0.25 + LANE_Y_EPSILON;
  const quantizeY = (value) => Math.round(value * 1000) / 1000;
  const clampLaneY = (value) =>
    quantizeY(Math.min(laneBottom, Math.max(laneTop, value)));
  const spreadLane = (index, count) =>
    count <= 1
      ? (laneTop + laneBottom) / 2
      : laneTop + ((laneBottom - laneTop) * index) / (count - 1);
  const candidateClearsSpan = (y, minX, maxX, incidentIds = new Set()) =>
    laneObstacles.every((box) => {
      if (incidentIds.has(box.id) && box.kind !== "label") return true;
      if (box.x + box.width < minX || box.x > maxX) return true;
      return y < box.y - clearancePad || y > box.y + box.height + clearancePad;
    });
  const blockedIntervalsForSpan = (minX, maxX, incidentIds = new Set()) => {
    const intervals = laneObstacles
      .filter((box) => {
        if (incidentIds.has(box.id) && box.kind !== "label") return false;
        return !(box.x + box.width < minX || box.x > maxX);
      })
      .map((box) => [
        Math.max(laneTop, box.y - clearancePad),
        Math.min(laneBottom, box.y + box.height + clearancePad),
      ])
      .filter(([start, end]) => end > start + LANE_Y_EPSILON)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const merged = [];
    for (const [start, end] of intervals) {
      const last = merged.at(-1);
      if (!last || start > last[1] + LANE_Y_EPSILON) {
        merged.push([start, end]);
        continue;
      }
      last[1] = Math.max(last[1], end);
    }
    return merged;
  };
  const freeIntervalsForSpan = (minX, maxX, incidentIds = new Set()) => {
    const blocked = blockedIntervalsForSpan(minX, maxX, incidentIds);
    if (!blocked.length) return [[laneTop, laneBottom]];
    const free = [];
    let cursor = laneTop;
    for (const [start, end] of blocked) {
      if (start > cursor + LANE_Y_EPSILON) free.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < laneBottom - LANE_Y_EPSILON) free.push([cursor, laneBottom]);
    return free;
  };
  const laneCandidatesForSpan = ({
    minX,
    maxX,
    incidentIds = new Set(),
    idealY,
  }) => {
    const candidates = new Set();
    for (const [intervalStart, intervalEnd] of freeIntervalsForSpan(
      minX,
      maxX,
      incidentIds,
    )) {
      const start = clampLaneY(intervalStart);
      const end = clampLaneY(intervalEnd);
      if (end < start + LANE_Y_EPSILON) continue;
      const clampedIdeal = clampLaneY(Math.min(end, Math.max(start, idealY)));
      candidates.add(start);
      candidates.add(end);
      candidates.add(clampedIdeal);
      for (
        let value = clampedIdeal;
        value <= end + LANE_Y_EPSILON;
        value += minLaneSpacing
      ) {
        candidates.add(clampLaneY(value));
      }
      for (
        let value = clampedIdeal;
        value >= start - LANE_Y_EPSILON;
        value -= minLaneSpacing
      ) {
        candidates.add(clampLaneY(value));
      }
      for (
        let value = start;
        value <= end + LANE_Y_EPSILON;
        value += minLaneSpacing
      ) {
        candidates.add(clampLaneY(value));
      }
      for (
        let value = end;
        value >= start - LANE_Y_EPSILON;
        value -= minLaneSpacing
      ) {
        candidates.add(clampLaneY(value));
      }
    }
    return [...candidates]
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .filter((candidate) =>
        candidateClearsSpan(candidate, minX, maxX, incidentIds),
      );
  };
  const laneDomainCache = new Map();
  const laneDomainForSpan = ({
    minX,
    maxX,
    incidentIds = new Set(),
    idealY,
  }) => {
    const incidentKey = [...incidentIds].sort(compareLifecycleIds).join("|");
    const key = `${quantizeY(minX)}:${quantizeY(maxX)}:${incidentKey}:${quantizeY(
      idealY,
    )}`;
    if (!laneDomainCache.has(key)) {
      laneDomainCache.set(
        key,
        laneCandidatesForSpan({ minX, maxX, incidentIds, idealY }),
      );
    }
    return laneDomainCache.get(key) ?? [];
  };
  const assignMonotone = (items, domainFor, idealFor) => {
    // Return [] for a successful no-op placement when there are no items.
    if (!items.length) return [];
    const ideals = items.map((item, index) => {
      const fallback = spreadLane(index, items.length);
      const ideal = idealFor?.(item, index, items.length);
      return clampLaneY(Number.isFinite(ideal) ? ideal : fallback);
    });
    const domains = items.map((item, index) =>
      [...new Set(domainFor(item, ideals[index]).map(clampLaneY))]
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b),
    );
    if (domains.some((domain) => domain.length === 0)) return null;
    const predecessors = domains.map((domain) => Array(domain.length).fill(-1));
    let previousCosts = domains[0].map((candidate) =>
      Math.abs(candidate - ideals[0]),
    );
    for (let index = 1; index < domains.length; index += 1) {
      const previousDomain = domains[index - 1];
      const currentDomain = domains[index];
      const currentCosts = Array(currentDomain.length).fill(Infinity);
      let pointer = 0;
      let bestCost = Infinity;
      let bestIndex = -1;
      for (
        let candidateIndex = 0;
        candidateIndex < currentDomain.length;
        candidateIndex += 1
      ) {
        const candidate = currentDomain[candidateIndex];
        while (
          pointer < previousDomain.length &&
          previousDomain[pointer] <= candidate - minLaneSpacing
        ) {
          const cost = previousCosts[pointer];
          // Lower predecessor indexes keep equal-cost paths deterministic.
          if (cost < bestCost || (cost === bestCost && pointer < bestIndex)) {
            bestCost = cost;
            bestIndex = pointer;
          }
          pointer += 1;
        }
        if (bestIndex < 0) continue;
        currentCosts[candidateIndex] =
          bestCost + Math.abs(candidate - ideals[index]);
        predecessors[index][candidateIndex] = bestIndex;
      }
      previousCosts = currentCosts;
    }
    let bestTerminalIndex = -1;
    let bestTerminalCost = Infinity;
    const finalDomain = domains.at(-1) ?? [];
    const terminalPredecessor = (index) =>
      predecessors[domains.length - 1][index] ?? -1;
    const prefersTerminal = (candidateIndex, currentIndex) => {
      if (currentIndex < 0) return true;
      const candidateY = finalDomain[candidateIndex];
      const currentY = finalDomain[currentIndex];
      if (candidateY !== currentY) return candidateY < currentY;
      return (
        terminalPredecessor(candidateIndex) < terminalPredecessor(currentIndex)
      );
    };
    for (let index = 0; index < finalDomain.length; index += 1) {
      const cost = previousCosts[index];
      if (!Number.isFinite(cost)) continue;
      if (
        cost < bestTerminalCost ||
        (cost === bestTerminalCost && prefersTerminal(index, bestTerminalIndex))
      ) {
        bestTerminalCost = cost;
        bestTerminalIndex = index;
      }
    }
    if (bestTerminalIndex < 0) return null;
    const assignments = Array(domains.length).fill(0);
    let currentIndex = bestTerminalIndex;
    for (let row = domains.length - 1; row >= 0; row -= 1) {
      assignments[row] = domains[row][currentIndex];
      currentIndex = predecessors[row][currentIndex];
    }
    return assignments;
  };
  const baselineLinks = new Map(
    graph.links.map((link) => [
      link.id,
      {
        y0: link.y0,
        y1: link.y1,
        transitionLaneY: link.transitionLaneY,
      },
    ]),
  );
  const outgoingByNode = new Map();
  const incomingByNode = new Map();
  const linksByBranch = new Map();
  for (const link of graph.links) {
    if (!outgoingByNode.has(link.source)) outgoingByNode.set(link.source, []);
    outgoingByNode.get(link.source).push(link);
    if (!incomingByNode.has(link.target)) incomingByNode.set(link.target, []);
    incomingByNode.get(link.target).push(link);
    if (!linksByBranch.has(link.branchId)) linksByBranch.set(link.branchId, []);
    linksByBranch.get(link.branchId).push(link);
  }
  const transitionLinks = new Map();
  for (const link of graph.links) {
    const rank = link.source?.rank;
    if (!Number.isInteger(rank)) {
      throw new Error(
        `Lifecycle diagram transition rank invariant violated for link ${link.id}`,
      );
    }
    if (!transitionLinks.has(rank)) transitionLinks.set(rank, []);
    transitionLinks.get(rank).push(link);
  }
  const restoreBaseline = () => {
    for (const link of graph.links) {
      const baseline = baselineLinks.get(link.id);
      if (!baseline) continue;
      link.y0 = baseline.y0;
      link.y1 = baseline.y1;
      link.transitionLaneY = baseline.transitionLaneY;
    }
  };
  try {
    lifecycleLaneSolverDebug.stateCounts = [];
    for (const rank of [...transitionLinks.keys()].sort((a, b) => a - b)) {
      const links = [...(transitionLinks.get(rank) ?? [])].sort(
        compareBranchLinks,
      );
      const assignment = assignMonotone(
        links,
        (link, idealY) => {
          const minX = rankCenterX(link.source.rank) - RANK_CORRIDOR_HALF_WIDTH;
          const maxX = rankCenterX(link.target.rank) + RANK_CORRIDOR_HALF_WIDTH;
          const incidentIds = new Set([link.source.id, link.target.id]);
          return laneDomainForSpan({ minX, maxX, incidentIds, idealY });
        },
        (link) =>
          ((link.source.y0 + link.source.y1) / 2 +
            (link.target.y0 + link.target.y1) / 2) /
          2,
      );
      if (!assignment) {
        throw new Error(
          `Lifecycle transition lane allocation failed for transition rank ${rank}`,
        );
      }
      lifecycleLaneSolverDebug.stateCounts.push(
        Math.min(1, LANE_SOLVER_STATE_LIMIT),
      );
      links.forEach((link, index) => {
        link.transitionLaneY = assignment[index];
      });
    }
    for (const [node, links] of outgoingByNode) {
      if (node.routing) continue;
      const ordered = [...links].sort(
        (a, b) =>
          a.transitionLaneY - b.transitionLaneY || compareBranchLinks(a, b),
      );
      const height = Math.max(0, node.y1 - node.y0);
      ordered.forEach((link, index) => {
        const evenY =
          ordered.length > 1
            ? node.y0 + (height * (index + 1)) / (ordered.length + 1)
            : (node.y0 + node.y1) / 2;
        const laneY = Math.min(
          node.y1 - 0.5,
          Math.max(node.y0 + 0.5, link.transitionLaneY),
        );
        link.y0 = quantizeY((evenY + laneY * 3) / 4);
      });
    }
    for (const [node, links] of incomingByNode) {
      if (node.routing) continue;
      const ordered = [...links].sort(
        (a, b) =>
          a.transitionLaneY - b.transitionLaneY || compareBranchLinks(a, b),
      );
      const height = Math.max(0, node.y1 - node.y0);
      ordered.forEach((link, index) => {
        const evenY =
          ordered.length > 1
            ? node.y0 + (height * (index + 1)) / (ordered.length + 1)
            : (node.y0 + node.y1) / 2;
        const laneY = Math.min(
          node.y1 - 0.5,
          Math.max(node.y0 + 0.5, link.transitionLaneY),
        );
        link.y1 = quantizeY((evenY + laneY * 3) / 4);
      });
    }
    const routingNodesByRank = new Map();
    for (const node of graph.nodes.filter((candidate) => candidate.routing)) {
      if (!routingNodesByRank.has(node.rank))
        routingNodesByRank.set(node.rank, []);
      routingNodesByRank.get(node.rank).push(node);
    }
    for (const rank of [...routingNodesByRank.keys()].sort((a, b) => a - b)) {
      const nodes = [...(routingNodesByRank.get(rank) ?? [])].sort(
        (left, right) => {
          const leftBranch = branchById.get(left.branchId);
          const rightBranch = branchById.get(right.branchId);
          if (!leftBranch || !rightBranch) {
            throw new Error(
              `Lifecycle routing-node invariant violated for rank ${rank}`,
            );
          }
          return (
            compareBranches(leftBranch, rightBranch) ||
            compareLifecycleIds(left.id, right.id)
          );
        },
      );
      const centerX = rankCenterX(rank);
      const assignment = assignMonotone(
        nodes,
        (_, idealY) =>
          laneDomainForSpan({ minX: centerX, maxX: centerX, idealY }),
        (node) => {
          const lanes = [
            ...(incomingByNode.get(node) ?? []),
            ...(outgoingByNode.get(node) ?? []),
          ]
            .map((link) => link.transitionLaneY)
            .filter((value) => Number.isFinite(value));
          if (!lanes.length) return (laneTop + laneBottom) / 2;
          return lanes.reduce((sum, value) => sum + value, 0) / lanes.length;
        },
      );
      if (!assignment) {
        throw new Error(
          `Lifecycle routing anchor allocation failed for transition rank ${rank}`,
        );
      }
      nodes.forEach((node, index) => {
        const anchorY = assignment[index];
        for (const link of incomingByNode.get(node) ?? []) link.y1 = anchorY;
        for (const link of outgoingByNode.get(node) ?? []) link.y0 = anchorY;
      });
    }
    for (const link of graph.links) {
      if (
        !Number.isFinite(link.y0) ||
        !Number.isFinite(link.y1) ||
        !Number.isFinite(link.transitionLaneY)
      ) {
        throw new Error(
          `Lifecycle route coordinate invariant violated for ${link.id}`,
        );
      }
    }
    for (const node of graph.nodes.filter((candidate) => candidate.routing)) {
      const incoming = incomingByNode.get(node) ?? [];
      const outgoing = outgoingByNode.get(node) ?? [];
      if (
        incoming.length === 1 &&
        outgoing.length === 1 &&
        incoming[0].y1 !== outgoing[0].y0
      ) {
        throw new Error(
          `Lifecycle routing continuity invariant violated for ${node.id}`,
        );
      }
    }
    const handleCheck = tryAssignBranchHandles(
      graph.branches,
      linksByBranch,
      visibleNodes,
    );
    if (!handleCheck.ok) {
      const blockedBranchId =
        handleCheck.blockedBranchIds[0] ?? "unknown branch";
      throw new Error(
        `Lifecycle diagram handle placement invariant violated for ${blockedBranchId}`,
      );
    }
  } catch (error) {
    restoreBaseline();
    throw error;
  }
  return { graph, dimensions };
}

const point = (x, y) => `${Number(x).toFixed(3)},${Number(y).toFixed(3)}`;
export function segmentRoutePrimitives(segment) {
  const sourceCenter = rankCenterX(segment.source.rank);
  const targetCenter = rankCenterX(segment.target.rank);
  const sourceY = segment.y0;
  const targetY = segment.y1;
  const sourceDockX = segment.source.routing ? sourceCenter : segment.source.x1;
  const targetDockX = segment.target.routing ? targetCenter : segment.target.x0;
  const exitX = sourceCenter + RANK_CORRIDOR_HALF_WIDTH;
  const entryX = targetCenter - RANK_CORRIDOR_HALF_WIDTH;
  const laneY = Number.isFinite(segment.transitionLaneY)
    ? segment.transitionLaneY
    : targetY;
  const p0 = { x: exitX, y: sourceY };
  const p1 = { x: exitX + 24, y: laneY };
  const p2 = { x: entryX - 24, y: laneY };
  const p3 = { x: entryX, y: targetY };
  return [
    {
      type: "line",
      zone: "source",
      p0: { x: sourceDockX, y: sourceY },
      p1: { x: exitX, y: sourceY },
      segment,
    },
    { type: "cubic", zone: "transition", p0, p1, p2, p3, segment },
    {
      type: "line",
      zone: "target",
      p0: { x: entryX, y: targetY },
      p1: { x: targetDockX, y: targetY },
      segment,
    },
  ];
}

export function adjacentRankSegmentPath(segment) {
  const [source, cubic, target] = segmentRoutePrimitives(segment);
  return [
    `M${point(source.p0.x, source.p0.y)}`,
    `L${point(source.p1.x, source.p1.y)}`,
    [
      `C${point(cubic.p1.x, cubic.p1.y)}`,
      point(cubic.p2.x, cubic.p2.y),
      point(cubic.p3.x, cubic.p3.y),
    ].join(" "),
    `L${point(target.p1.x, target.p1.y)}`,
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
  const cubic = segmentRoutePrimitives(segment)[1];
  const oneMinus = 1 - t;
  return {
    x:
      oneMinus ** 3 * cubic.p0.x +
      3 * oneMinus ** 2 * t * cubic.p1.x +
      3 * oneMinus * t ** 2 * cubic.p2.x +
      t ** 3 * cubic.p3.x,
    y:
      oneMinus ** 3 * cubic.p0.y +
      3 * oneMinus ** 2 * t * cubic.p1.y +
      3 * oneMinus * t ** 2 * cubic.p2.y +
      t ** 3 * cubic.p3.y,
  };
};

const quantizePoint = ({ x, y }) => ({
  x: Math.round(x * 1000) / 1000,
  y: Math.round(y * 1000) / 1000,
});

const segmentKey = (segment) =>
  `${segment.branchId ?? ""}:${segment.segmentIndex ?? ""}:${segment.id ?? ""}`;

export function buildLifecycleRouteModel(graph, dimensions) {
  const branches = [...(graph.branches ?? [])].sort(compareBranches);
  const segmentsByBranch = new Map();
  const segmentsByTransitionRank = Array.from({ length: 6 }, () => []);
  for (const link of graph.links ?? []) {
    if (!segmentsByBranch.has(link.branchId))
      segmentsByBranch.set(link.branchId, []);
    segmentsByBranch.get(link.branchId).push(link);
    if (link.source?.rank >= 0 && link.source.rank < 6)
      segmentsByTransitionRank[link.source.rank].push(link);
  }
  for (const segments of segmentsByBranch.values())
    segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
  const visibleNodes = (graph.nodes ?? []).filter(
    (node) => !node.routing && Number(node.total) > 0,
  );
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const pairId = (a, b) => [a.id, b.id].sort(compareLifecycleIds).join("||");
  const fixedOrderInversionPairs = new Set();
  for (let a = 0; a < branches.length; a += 1) {
    for (let b = a + 1; b < branches.length; b += 1) {
      const left = branches[a];
      const right = branches[b];
      if (
        left.sourceRank !== right.sourceRank ||
        left.targetRank !== right.targetRank ||
        left.source === right.source ||
        left.target === right.target
      )
        continue;
      const leftSource = nodeById.get(left.source);
      const rightSource = nodeById.get(right.source);
      const leftTarget = nodeById.get(left.target);
      const rightTarget = nodeById.get(right.target);
      if (!leftSource || !rightSource || !leftTarget || !rightTarget) continue;
      const sourceOrder =
        (leftSource.y0 + leftSource.y1) / 2 -
        (rightSource.y0 + rightSource.y1) / 2;
      const targetOrder =
        (leftTarget.y0 + leftTarget.y1) / 2 -
        (rightTarget.y0 + rightTarget.y1) / 2;
      if (Math.sign(sourceOrder) * Math.sign(targetOrder) < 0)
        fixedOrderInversionPairs.add(pairId(left, right));
    }
  }
  return {
    graph,
    dimensions,
    branches,
    segmentsByBranch,
    segmentsByTransitionRank,
    visibleNodes,
    fixedOrderInversionPairs,
    pairId,
  };
}

const cubicFlatEnough = (primitive) => {
  const distance = (p) => {
    const { p0, p3 } = primitive;
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const length = Math.hypot(dx, dy) || 1;
    return Math.abs(dy * p.x - dx * p.y + p3.x * p0.y - p3.y * p0.x) / length;
  };
  return distance(primitive.p1) <= 0.25 && distance(primitive.p2) <= 0.25;
};

const splitCubic = ({ p0, p1, p2, p3, ...rest }) => {
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  return [
    { ...rest, type: "cubic", p0, p1: p01, p2: p012, p3: p0123 },
    { ...rest, type: "cubic", p0: p0123, p1: p123, p2: p23, p3 },
  ];
};

export function flattenLifecycleCubic(cubic, depth = 0) {
  if (cubicFlatEnough(cubic))
    return [{ p0: cubic.p0, p1: cubic.p3, primitive: cubic }];
  if (depth >= 12) throw new Error("Lifecycle cubic flattening depth exceeded");
  return splitCubic(cubic).flatMap((part) =>
    flattenLifecycleCubic(part, depth + 1),
  );
}

export const flattenRouteSegment = (segment) =>
  segmentRoutePrimitives(segment).flatMap((primitive) =>
    primitive.type === "line"
      ? [{ p0: primitive.p0, p1: primitive.p1, primitive }]
      : flattenLifecycleCubic(primitive).map((edge) => ({
          ...edge,
          primitive,
        })),
  );

export const pointToSegmentDistance = (point, edge) => {
  const dx = edge.p1.x - edge.p0.x;
  const dy = edge.p1.y - edge.p0.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared)
    return Math.hypot(point.x - edge.p0.x, point.y - edge.p0.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - edge.p0.x) * dx + (point.y - edge.p0.y) * dy) / lengthSquared,
    ),
  );
  const x = edge.p0.x + t * dx;
  const y = edge.p0.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
};

export const routeEdgesByBranch = (graphOrModel) => {
  const model = graphOrModel?.segmentsByBranch
    ? graphOrModel
    : buildLifecycleRouteModel(graphOrModel, { width: 0, height: 0 });
  const edgesByBranch = new Map();
  for (const [branchId, segments] of model.segmentsByBranch) {
    const edges = [];
    for (const segment of segments) {
      edges.push(
        ...flattenRouteSegment(segment).map((edge) => ({
          ...edge,
          branchId,
          segmentId: segmentKey(segment),
          segmentIndex: segment.segmentIndex,
          transitionRank: segment.source?.rank,
          zone: edge.primitive?.zone,
          envelopeRadius: selectedEnvelopeRadius(segment),
          segment,
        })),
      );
    }
    edgesByBranch.set(branchId, edges);
  }
  return edgesByBranch;
};

export const segmentIntersectsRect = (edge, rect) => {
  const minX = Math.min(edge.p0.x, edge.p1.x);
  const maxX = Math.max(edge.p0.x, edge.p1.x);
  const minY = Math.min(edge.p0.y, edge.p1.y);
  const maxY = Math.max(edge.p0.y, edge.p1.y);
  return (
    maxX >= rect.x &&
    minX <= rect.x + rect.width &&
    maxY >= rect.y &&
    minY <= rect.y + rect.height
  );
};

const orientation = (a, b, c) =>
  Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

const edgeCrossing = (left, right) => {
  const o1 = orientation(left.p0, left.p1, right.p0);
  const o2 = orientation(left.p0, left.p1, right.p1);
  const o3 = orientation(right.p0, right.p1, left.p0);
  const o4 = orientation(right.p0, right.p1, left.p1);
  return o1 * o2 < 0 && o3 * o4 < 0;
};

export function auditLifecycleRouteGeometry({
  graph,
  dimensions,
  model,
  handles = [],
}) {
  const routeModel = model ?? buildLifecycleRouteModel(graph, dimensions);
  const fatalFindings = [];
  const forcedCrossings = [];
  const allFindings = [];
  const add = (category, segment, extra = {}) => {
    const finding = {
      category,
      branchId: segment?.branchId,
      segmentId: segmentKey(segment ?? {}),
      transitionRank: segment?.source?.rank,
      ...extra,
    };
    allFindings.push(finding);
    fatalFindings.push(finding);
  };
  const flatEdges = [];
  for (const [branchId, segments] of routeModel.segmentsByBranch) {
    segments.forEach((segment, index) => {
      if (segment.segmentIndex !== index)
        add("discontinuous-segment-index", segment);
      if (segment.target.rank !== segment.source.rank + 1)
        add("non-adjacent-rank", segment);
      for (const value of [segment.y0, segment.y1, segment.transitionLaneY]) {
        if (!Number.isFinite(value)) add("nonfinite-coordinate", segment);
      }
      try {
        flatEdges.push(
          ...flattenRouteSegment(segment).map((edge) => ({
            ...edge,
            branchId,
            segment,
          })),
        );
      } catch (error) {
        add("cubic-flattening-depth", segment, { message: error.message });
      }
    });
  }
  const fixedBoxes = routeModel.visibleNodes.flatMap((node) => [
    {
      kind: "node",
      id: node.id,
      x: node.x0,
      y: node.y0,
      width: node.x1 - node.x0,
      height: node.y1 - node.y0,
    },
    { kind: "label", id: node.id, ...labelBoxForNode(node) },
    { kind: "hit", ...rendererHitBoxForNode(node) },
  ]);
  for (const edge of flatEdges) {
    const pad = selectedEnvelopeRadius(edge.segment) + 0.25 + LANE_Y_EPSILON;
    for (const box of fixedBoxes) {
      const incident =
        box.id === edge.segment.source.id || box.id === edge.segment.target.id;
      if (incident && box.kind !== "label") continue;
      const expanded = {
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
      };
      if (segmentIntersectsRect(edge, expanded))
        add(`${box.kind}-collision`, edge.segment, { obstacleId: box.id });
    }
  }
  const pairCrossings = new Map();
  for (let a = 0; a < flatEdges.length; a += 1) {
    for (let b = a + 1; b < flatEdges.length; b += 1) {
      const left = flatEdges[a];
      const right = flatEdges[b];
      if (left.branchId === right.branchId) continue;
      if (left.segment.source.rank !== right.segment.source.rank) continue;
      if (!edgeCrossing(left, right)) continue;
      const branchLeft = routeModel.branches.find(
        ({ id }) => id === left.branchId,
      );
      const branchRight = routeModel.branches.find(
        ({ id }) => id === right.branchId,
      );
      const pair =
        branchLeft && branchRight
          ? routeModel.pairId(branchLeft, branchRight)
          : `${left.branchId}||${right.branchId}`;
      if (!pairCrossings.has(pair)) pairCrossings.set(pair, []);
      pairCrossings.get(pair).push({ left, right });
    }
  }
  for (const [pair, crossings] of pairCrossings) {
    const finding = {
      category: "proper-crossing",
      branchIds: pair.split("||"),
      transitionRank: crossings[0]?.left.segment.source.rank,
      point: quantizePoint(crossings[0]?.left.p0 ?? { x: 0, y: 0 }),
    };
    if (routeModel.fixedOrderInversionPairs.has(pair) && crossings.length === 1)
      forcedCrossings.push(finding);
    else {
      allFindings.push(finding);
      fatalFindings.push(finding);
    }
  }
  for (const handle of handles) {
    const box = handle.box ?? {
      x: handle.x - BRANCH_HANDLE_RADIUS,
      y: handle.y - BRANCH_HANDLE_RADIUS,
      width: BRANCH_HANDLE_RADIUS * 2,
      height: BRANCH_HANDLE_RADIUS * 2,
    };
    for (const fixed of fixedBoxes) {
      if (boxesOverlap(box, fixed))
        fatalFindings.push({
          category: "handle-fixed-collision",
          branchId: handle.branchId,
          obstacleId: fixed.id,
        });
    }
  }
  const stable = (finding) =>
    [
      finding.category,
      finding.transitionRank ?? "",
      finding.branchId ?? "",
      ...(finding.branchIds ?? []),
      finding.segmentId ?? "",
      finding.obstacleId ?? "",
    ].join("|");
  fatalFindings.sort((a, b) => compareLifecycleIds(stable(a), stable(b)));
  forcedCrossings.sort((a, b) => compareLifecycleIds(stable(a), stable(b)));
  allFindings.sort((a, b) => compareLifecycleIds(stable(a), stable(b)));
  return { fatalFindings, forcedCrossings, allFindings };
}

export function solveLifecycleRouteGeometry(graph, dimensions, options = {}) {
  const baseline = new Map(
    graph.links.map((link) => [
      link.id,
      { y0: link.y0, y1: link.y1, transitionLaneY: link.transitionLaneY },
    ]),
  );
  const restore = () => {
    for (const link of graph.links) {
      const value = baseline.get(link.id);
      if (!value) continue;
      link.y0 = value.y0;
      link.y1 = value.y1;
      link.transitionLaneY = value.transitionLaneY;
    }
  };
  if ((options.maxStates ?? 1) <= 0) {
    restore();
    throw new Error("Unable to construct valid lifecycle routes");
  }
  const model = buildLifecycleRouteModel(graph, dimensions);
  const audit = auditLifecycleRouteGeometry({ model, handles: [] });
  if (audit.fatalFindings.length) {
    restore();
    throw new Error("Unable to construct valid lifecycle routes");
  }
  return { handles: [], audit, visitedStates: 1 };
}

const boxesOverlap = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
const tryAssignBranchHandles = (
  branches,
  segmentsByBranch,
  visibleNodes = [],
) => {
  const nodeBoxes = visibleNodes.map((node) => ({
    x: node.x0,
    y: node.y0,
    width: node.x1 - node.x0,
    height: node.y1 - node.y0,
  }));
  const labelBoxes = visibleNodes.map(labelBoxForNode);
  const routeEdges = [];
  for (const [branchId, segments] of segmentsByBranch) {
    for (const segment of segments) {
      routeEdges.push(
        ...flattenRouteSegment(segment).map((edge) => ({
          ...edge,
          branchId,
          segmentId: segmentKey(segment),
          segmentIndex: segment.segmentIndex,
          transitionRank: segment.source?.rank,
          zone: edge.primitive?.zone,
          envelopeRadius: selectedEnvelopeRadius(segment),
          segment,
        })),
      );
    }
  }
  const hitBoxes = visibleNodes.map(rendererHitBoxForNode);
  const fixedGeometry = [...nodeBoxes, ...labelBoxes, ...hitBoxes];
  const fixedGeometryBlocksCandidate = (box) =>
    fixedGeometry.some((b) => boxesOverlap(box, b));
  const renderedBranchClearanceMargin = (branch, x, y) => {
    let margin = Number.POSITIVE_INFINITY;
    for (const edge of routeEdges) {
      if (edge.branchId === branch.id) continue;
      const required =
        BRANCH_HANDLE_RADIUS + edge.envelopeRadius + 0.25 + LANE_Y_EPSILON;
      const distance = pointToSegmentDistance({ x, y }, edge);
      if (distance <= required) return COLLISION_MARGIN;
      margin = Math.min(margin, distance - required);
    }
    return margin;
  };
  const orderedBranches = [...branches].sort(compareBranches);
  const candidateSets = new Map();
  for (const branch of orderedBranches) {
    const segments = [...(segmentsByBranch.get(branch.id) ?? [])].sort(
      (a, b) => a.segmentIndex - b.segmentIndex,
    );
    const preferred =
      segments.find(
        (segment) => segment.source.routing && segment.target.routing,
      ) ??
      segments[Math.floor(segments.length / 2)] ??
      segments[0];
    const orderedSegments = [
      preferred,
      ...segments.filter((segment) => segment !== preferred),
    ].filter(Boolean);
    const candidates = [];
    for (const segment of orderedSegments) {
      const sourceCenter = rankCenterX(segment.source.rank);
      const targetCenter = rankCenterX(segment.target.rank);
      const exitX = sourceCenter + RANK_CORRIDOR_HALF_WIDTH;
      const entryX = targetCenter - RANK_CORRIDOR_HALF_WIDTH;
      for (const t of [0.5, 0.35, 0.65]) {
        const { x, y } = cubicTransitionPoint(segment, t);
        const box = {
          x: x - BRANCH_HANDLE_RADIUS,
          y: y - BRANCH_HANDLE_RADIUS,
          width: BRANCH_HANDLE_RADIUS * 2,
          height: BRANCH_HANDLE_RADIUS * 2,
        };
        if (fixedGeometryBlocksCandidate(box)) continue;
        if (
          x - BRANCH_HANDLE_RADIUS < exitX ||
          x + BRANCH_HANDLE_RADIUS > entryX
        )
          continue;
        const clearanceMargin = renderedBranchClearanceMargin(branch, x, y);
        if (clearanceMargin > 0)
          candidates.push({
            branchId: branch.id,
            x,
            y,
            radius: BRANCH_HANDLE_RADIUS,
            box,
            clearanceMargin,
          });
      }
    }
    candidateSets.set(
      branch.id,
      candidates.sort(
        (a, b) =>
          b.clearanceMargin - a.clearanceMargin || a.y - b.y || a.x - b.x,
      ),
    );
  }
  const blockedBranchIds = orderedBranches
    .filter((branch) => !(candidateSets.get(branch.id)?.length > 0))
    .map((branch) => branch.id);
  if (blockedBranchIds.length)
    return {
      ok: false,
      reason: "no-candidates",
      blockedBranchIds,
      candidateSets,
    };
  const selected = new Map();
  let visitedHandleStates = 0;
  const MAX_HANDLE_SEARCH_STATES = 32768;
  const chooseHandles = () => {
    while (selected.size < orderedBranches.length) {
      if (visitedHandleStates++ >= MAX_HANDLE_SEARCH_STATES) return false;
      const next = orderedBranches
        .filter((candidateBranch) => !selected.has(candidateBranch.id))
        .map((candidateBranch) => {
          const candidates = (
            candidateSets.get(candidateBranch.id) ?? []
          ).filter(
            (candidate) =>
              ![...selected.values()].some((handle) =>
                boxesOverlap(candidate.box, handle.box),
              ),
          );
          return { branch: candidateBranch, candidates };
        })
        .sort(
          (a, b) =>
            a.candidates.length - b.candidates.length ||
            compareBranches(a.branch, b.branch),
        )[0];
      if (!next || next.candidates.length === 0) return false;
      selected.set(next.branch.id, next.candidates[0]);
    }
    return true;
  };
  if (!chooseHandles())
    return {
      ok: false,
      reason:
        visitedHandleStates >= MAX_HANDLE_SEARCH_STATES
          ? "state-limit"
          : "handle-overlap",
      blockedBranchIds: orderedBranches.map((branch) => branch.id),
      candidateSets,
      conflicts: [],
    };
  return {
    ok: true,
    handles: orderedBranches.map((branch) => selected.get(branch.id)),
    candidateSets,
  };
};

export function assignBranchHandles(
  branches,
  segmentsByBranch,
  visibleNodes = [],
) {
  const result = tryAssignBranchHandles(
    branches,
    segmentsByBranch,
    visibleNodes,
  );
  if (result.ok) return result.handles;
  const branchId = result.blockedBranchIds[0];
  throw new Error(
    branchId
      ? `Lifecycle diagram handle placement invariant violated for ${branchId}`
      : "Lifecycle diagram handle placement invariant violated",
  );
}
