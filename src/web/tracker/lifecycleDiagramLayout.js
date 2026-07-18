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
const MAX_ROUTE_SEARCH_STATES = 8192;
const LANE_Y_EPSILON = 0.001;
const COLLISION_MARGIN = -1;

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

  const orderedBranches = [...graph.branches].sort(compareBranches);
  const visibleNodes = graph.nodes.filter(
    (node) => !node.routing && Number(node.total) > 0,
  );
  const nodeBoxes = visibleNodes.map((node) => ({
    id: node.id,
    x: node.x0,
    y: node.y0,
    width: node.x1 - node.x0,
    height: node.y1 - node.y0,
  }));
  const labelBoxes = visibleNodes.map((node) => ({
    id: node.id,
    ...labelBoxForNode(node),
  }));
  const hitBoxes = visibleNodes.map(rendererHitBoxForNode);
  const fixedBoxes = [...nodeBoxes, ...labelBoxes, ...hitBoxes];
  const laneTop = BRANCH_HANDLE_RADIUS + 4;
  const laneBottom = dimensions.height - BRANCH_HANDLE_RADIUS - 4;
  const routeEnvelopeRadius = selectedEnvelopeRadius({ width: 1 });
  const minLaneSpacing = BRANCH_HANDLE_RADIUS * 2 + routeEnvelopeRadius * 2;
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
  const d3RoutingIdealByNode = new Map(
    graph.nodes
      .filter((node) => node.routing)
      .map((node) => [node, (node.y0 + node.y1) / 2]),
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
  const branchIdealY = (branch) => {
    const links = linksByBranch.get(branch.id) ?? [];
    const values = links
      .flatMap((link) => [
        link.y0,
        link.y1,
        d3RoutingIdealByNode.get(link.source),
        d3RoutingIdealByNode.get(link.target),
      ])
      .filter(Number.isFinite);
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : (laneTop + laneBottom) / 2;
  };
  const quantizeY = (value) => Math.round(value * 1000) / 1000;
  const boxBlocksHorizontalRoute = (box, branch, y) => {
    const startRank = branch.sourceRank;
    const endRank = branch.targetRank;
    const minX = rankCenterX(startRank) - RANK_CORRIDOR_HALF_WIDTH;
    const maxX = rankCenterX(endRank) + RANK_CORRIDOR_HALF_WIDTH;
    if (box.x + box.width < minX || box.x > maxX) return false;
    if (box.id === branch.source || box.id === branch.target) return false;
    return (
      y >= box.y - routeEnvelopeRadius &&
      y <= box.y + box.height + routeEnvelopeRadius
    );
  };
  const branchCandidateYs = (branch) => {
    const values = new Set();
    const add = (value) => {
      if (Number.isFinite(value))
        values.add(quantizeY(Math.min(laneBottom, Math.max(laneTop, value))));
    };
    const ideal = branchIdealY(branch);
    add(ideal);
    for (let y = Math.ceil(laneTop); y <= Math.floor(laneBottom); y += 1)
      add(y);
    for (const box of fixedBoxes) {
      add(box.y - routeEnvelopeRadius - BRANCH_HANDLE_RADIUS - LANE_Y_EPSILON);
      add(
        box.y +
          box.height +
          routeEnvelopeRadius +
          BRANCH_HANDLE_RADIUS +
          LANE_Y_EPSILON,
      );
    }
    return [...values]
      .filter(
        (y) =>
          !fixedBoxes.some((box) => boxBlocksHorizontalRoute(box, branch, y)),
      )
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b);
  };
  const intervalsOverlap = (a, b) =>
    a.sourceRank < b.targetRank && b.sourceRank < a.targetRank;
  const domains = new Map(
    orderedBranches.map((branch) => [branch.id, branchCandidateYs(branch)]),
  );
  const assignments = new Map();
  let exploredStates = 0;
  const searchTracks = () => {
    if (assignments.size === orderedBranches.length) return true;
    if (exploredStates++ > MAX_ROUTE_SEARCH_STATES) return false;
    const next = orderedBranches
      .filter((branch) => !assignments.has(branch.id))
      .map((branch) => {
        const candidates = (domains.get(branch.id) ?? []).filter((candidateY) =>
          orderedBranches.every((peer) => {
            if (peer.id === branch.id || !assignments.has(peer.id)) return true;
            if (!intervalsOverlap(branch, peer)) return true;
            return (
              Math.abs(assignments.get(peer.id) - candidateY) >= minLaneSpacing
            );
          }),
        );
        return { branch, candidates };
      })
      .sort(
        (a, b) =>
          a.candidates.length - b.candidates.length ||
          compareBranches(a.branch, b.branch),
      )[0];
    if (!next || next.candidates.length === 0) return false;
    for (const candidateY of next.candidates) {
      assignments.set(next.branch.id, candidateY);
      if (searchTracks()) return true;
      assignments.delete(next.branch.id);
    }
    return false;
  };
  const restoreBaseline = () => {
    for (const link of graph.links) {
      const baseline = baselineLinks.get(link.id);
      if (!baseline) continue;
      link.y0 = baseline.y0;
      link.y1 = baseline.y1;
      link.transitionLaneY = baseline.transitionLaneY;
    }
  };
  const laneYForLink = (link) =>
    assignments.get(link.branchId) ??
    branchIdealY({
      id: link.branchId,
      sourceRank: link.source.rank,
      targetRank: link.target.rank,
      source: link.source.id,
      target: link.target.id,
    });
  const assignDockLanes = (entries, coordinate) => {
    for (const [node, links] of entries) {
      const ordered = [...links].sort(
        (a, b) => laneYForLink(a) - laneYForLink(b) || linkSort(a, b),
      );
      ordered.forEach((link, index) => {
        const laneY = laneYForLink(link);
        link.transitionLaneY = laneY;
        if (node.routing) {
          link[coordinate] = laneY;
          return;
        }
        const height = Math.max(0, node.y1 - node.y0);
        link[coordinate] =
          ordered.length > 1
            ? node.y0 + (height * (index + 1)) / (ordered.length + 1)
            : (node.y0 + node.y1) / 2;
      });
    }
  };
  const applyTrackGeometry = () => {
    assignDockLanes(outgoingByNode, "y0");
    assignDockLanes(incomingByNode, "y1");
  };
  const assignFallbackTracks = () => {
    for (const branch of orderedBranches) {
      const candidate = (domains.get(branch.id) ?? []).find((candidateY) =>
        orderedBranches.every((peer) => {
          if (peer.id === branch.id || !assignments.has(peer.id)) return true;
          if (!intervalsOverlap(branch, peer)) return true;
          return (
            Math.abs(assignments.get(peer.id) - candidateY) >= minLaneSpacing
          );
        }),
      );
      let selected = candidate;
      if (selected == null) {
        const branchDomain = domains.get(branch.id) ?? [];
        selected = branchDomain.length ? branchDomain[0] : branchIdealY(branch);
      }
      assignments.set(branch.id, selected);
    }
    return true;
  };
  try {
    if (
      !(orderedBranches.length > 32 ? assignFallbackTracks() : searchTracks())
    ) {
      throw new Error(
        `Lifecycle route search exhausted after ${exploredStates} states`,
      );
    }
    applyTrackGeometry();
    let handleCheck = tryAssignBranchHandles(
      graph.branches,
      linksByBranch,
      visibleNodes,
    );
    const countBlockedBranches = (result) =>
      result.ok ? 0 : (result.blockedBranchIds ?? []).length;
    const laneAdjustmentLimit =
      graph.branches.length <= 32
        ? Math.max(1, countBlockedBranches(handleCheck))
        : 0;
    let refinementCount = 0;
    while (!handleCheck.ok && refinementCount < laneAdjustmentLimit) {
      refinementCount += 1;
      const baselineScore = countBlockedBranches(handleCheck);
      let accepted = null;
      for (const branchId of [
        ...handleCheck.blockedBranchIds,
        ...orderedBranches.map(({ id }) => id),
      ]) {
        const currentY = assignments.get(branchId);
        for (const candidateY of domains.get(branchId) ?? []) {
          if (candidateY === currentY) continue;
          const branch = orderedBranches.find(({ id }) => id === branchId);
          const legal = orderedBranches.every((peer) => {
            if (!branch || peer.id === branch.id || !assignments.has(peer.id))
              return true;
            if (!intervalsOverlap(branch, peer)) return true;
            return (
              Math.abs(assignments.get(peer.id) - candidateY) >= minLaneSpacing
            );
          });
          if (!legal) continue;
          assignments.set(branchId, candidateY);
          restoreBaseline();
          applyTrackGeometry();
          const nextCheck = tryAssignBranchHandles(
            graph.branches,
            linksByBranch,
            visibleNodes,
          );
          assignments.set(branchId, currentY);
          restoreBaseline();
          applyTrackGeometry();
          if (countBlockedBranches(nextCheck) < baselineScore) {
            accepted = { branchId, candidateY, result: nextCheck };
            break;
          }
        }
        if (accepted) break;
      }
      if (!accepted) break;
      assignments.set(accepted.branchId, accepted.candidateY);
      restoreBaseline();
      applyTrackGeometry();
      handleCheck = accepted.result;
    }
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

const flattenSegmentRoute = (segment) =>
  segmentRoutePrimitives(segment).flatMap((primitive) =>
    primitive.type === "line"
      ? [{ p0: primitive.p0, p1: primitive.p1, primitive }]
      : flattenLifecycleCubic(primitive).map((edge) => ({
          ...edge,
          primitive,
        })),
  );

const edgeIntersectsRect = (edge, rect) => {
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
          ...flattenSegmentRoute(segment).map((edge) => ({
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
      if (edgeIntersectsRect(edge, expanded))
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
  if ((options.maxStates ?? 8192) <= 0) {
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
  const renderedBranchSamples = [];
  const pushRenderedSample = (branchId, segment, x, y, clearance) => {
    renderedBranchSamples.push({
      branchId,
      sourceId: segment.source.id,
      targetId: segment.target.id,
      endpointId: segment.endpointId,
      x,
      y,
      clearance,
    });
  };
  for (const [branchId, segments] of segmentsByBranch) {
    for (const segment of segments) {
      const renderedWidth = renderedBranchStrokeWidth(segment.width);
      const clearance = BRANCH_HANDLE_RADIUS + (renderedWidth + 12) / 2;
      for (let t = 0; t <= 1.0001; t += 0.025) {
        const ratio = Math.min(1, t);
        const transitionPoint = cubicTransitionPoint(segment, ratio);
        pushRenderedSample(
          branchId,
          segment,
          transitionPoint.x,
          transitionPoint.y,
          clearance,
        );
      }
    }
  }
  const hitBoxes = visibleNodes.map(rendererHitBoxForNode);
  const fixedGeometry = [...nodeBoxes, ...labelBoxes, ...hitBoxes];
  const fixedGeometryBlocksCandidate = (box) =>
    fixedGeometry.some((b) => boxesOverlap(box, b));
  const sampleBucketWidth =
    BRANCH_HANDLE_RADIUS + (renderedBranchStrokeWidth() + 12) / 2;
  const renderedSampleBuckets = new Map();
  for (const sample of renderedBranchSamples) {
    const bucket = Math.floor(sample.x / sampleBucketWidth);
    if (!renderedSampleBuckets.has(bucket))
      renderedSampleBuckets.set(bucket, []);
    renderedSampleBuckets.get(bucket).push(sample);
  }
  const renderedBranchClearanceMargin = (branch, x, y) => {
    let margin = Number.POSITIVE_INFINITY;
    const centerBucket = Math.floor(x / sampleBucketWidth);
    for (
      let bucket = centerBucket - 1;
      bucket <= centerBucket + 1;
      bucket += 1
    ) {
      for (const sample of renderedSampleBuckets.get(bucket) ?? []) {
        if (sample.branchId === branch.id) continue;
        if (
          sample.sourceId === branch.source ||
          sample.sourceId === branch.target ||
          sample.targetId === branch.source ||
          sample.targetId === branch.target
        )
          continue;
        const deltaX = sample.x - x;
        const maxRelevantX =
          sample.clearance + (Number.isFinite(margin) ? margin : 0);
        if (Math.abs(deltaX) > Math.max(sample.clearance, maxRelevantX))
          continue;
        const deltaY = sample.y - y;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        const clearanceSquared = sample.clearance * sample.clearance;
        if (distanceSquared <= clearanceSquared) return COLLISION_MARGIN;
        if (Number.isFinite(margin)) {
          const maxDistance = sample.clearance + margin;
          if (distanceSquared >= maxDistance * maxDistance) continue;
        }
        const candidateMargin = Math.sqrt(distanceSquared) - sample.clearance;
        if (candidateMargin < margin) margin = candidateMargin;
      }
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
  const failedHandleStates = new Set();
  let visitedHandleStates = 0;
  const MAX_HANDLE_SEARCH_STATES = 32768;
  const chooseHandles = () => {
    if (selected.size >= orderedBranches.length) return true;
    if (visitedHandleStates++ >= MAX_HANDLE_SEARCH_STATES) return false;
    const signature = orderedBranches
      .map((branch) => {
        const handle = selected.get(branch.id);
        return handle
          ? `${branch.id}:${handle.x.toFixed(3)},${handle.y.toFixed(3)}`
          : `${branch.id}:`;
      })
      .join("|");
    if (failedHandleStates.has(signature)) return false;
    const branch = [...orderedBranches]
      .filter((candidateBranch) => !selected.has(candidateBranch.id))
      .map((candidateBranch) => {
        const candidates = (candidateSets.get(candidateBranch.id) ?? []).filter(
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
    if (!branch || branch.candidates.length === 0) return false;
    for (const candidate of branch.candidates) {
      selected.set(branch.branch.id, candidate);
      if (chooseHandles()) return true;
      selected.delete(branch.branch.id);
    }
    failedHandleStates.add(signature);
    return false;
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
