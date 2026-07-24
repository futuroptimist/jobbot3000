import { sankey } from "d3-sankey";
import { LIFECYCLE_DIAGRAM_TAXONOMY } from "./lifecycleProjection.js";

const isLifecycleLayoutTestEnvironment = () =>
  typeof process !== "undefined" &&
  (process.env.NODE_ENV === "test" || process.env.VITEST === "true");

export const SANKEY_NODE_WIDTH = 18;
export const MINIMUM_SVG_HEIGHT = 360;
export const LAYOUT_TOP_MARGIN = 64;
export const LAYOUT_BOTTOM_MARGIN = 48;
export const ROUTED_NODE_PADDING = 72;
export const PER_LANE_VERTICAL_BUDGET = 36;
export const NODE_LABEL_MAX_WIDTH = 176;
export const NODE_LABEL_MAX_CHARACTERS_PER_LINE = 22;
export const RANK_CORRIDOR_HALF_WIDTH = 100;
export const TRANSITION_CONTROL_OFFSET = 24;
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

export const buildTransitionPrecedence = ({
  rank,
  variables,
  priorOrder = [],
  projectedEdges = [],
}) => {
  const variableByBranch = new Map(
    variables.map((variable) => [variable.branchId, variable]),
  );
  const compareStableVariables = (left, right) =>
    compareLifecycleIds(left.stableId ?? left.id, right.stableId ?? right.id) ||
    compareLifecycleIds(left.id, right.id);
  const compareDock = (dockFor) => (left, right) => {
    const leftDock = dockFor(left);
    const rightDock = dockFor(right);
    if (
      Number.isFinite(leftDock) &&
      Number.isFinite(rightDock) &&
      Math.abs(leftDock - rightDock) > LANE_Y_EPSILON
    ) {
      return leftDock - rightDock;
    }
    return compareStableVariables(left, right);
  };
  const continuing = priorOrder
    .map((branchId) => variableByBranch.get(branchId))
    .filter(Boolean);
  const continuingIds = new Set(
    continuing.map((variable) => variable.branchId),
  );
  const starting = variables
    .filter((variable) => !continuingIds.has(variable.branchId))
    .sort(compareDock((variable) => variable.sourceDockY));
  const merged = [...continuing];
  for (const starter of starting) {
    let insertAt = merged.length;
    for (let index = 0; index < merged.length; index += 1) {
      const current = merged[index];
      if (
        starter.sourceDockY < current.sourceDockY - LANE_Y_EPSILON ||
        (Math.abs(starter.sourceDockY - current.sourceDockY) <=
          LANE_Y_EPSILON &&
          compareStableVariables(starter, current) < 0)
      ) {
        insertAt = index;
        break;
      }
    }
    merged.splice(insertAt, 0, starter);
  }

  const edges = [];
  const addEdge = (from, to, kind) => {
    if (!from || !to || from.id === to.id) return;
    edges.push({ fromId: from.id, toId: to.id, kind, rank });
  };
  for (let index = 1; index < continuing.length; index += 1) {
    addEdge(continuing[index - 1], continuing[index], "continuation");
  }
  const startingBySource = new Map();
  for (const starter of starting) {
    const sourceId = starter.sourceId ?? starter.link?.source?.id;
    if (!sourceId) continue;
    if (!startingBySource.has(sourceId)) startingBySource.set(sourceId, []);
    startingBySource.get(sourceId).push(starter);
  }
  for (const sourceStarters of startingBySource.values()) {
    sourceStarters.sort(compareDock((variable) => variable.sourceDockY));
    for (let index = 1; index < sourceStarters.length; index += 1) {
      addEdge(sourceStarters[index - 1], sourceStarters[index], "source-dock");
    }
  }
  const variableById = new Map(
    variables.map((variable) => [variable.id, variable]),
  );
  for (const edge of projectedEdges) {
    const from = variableById.get(edge.fromId);
    const to = variableById.get(edge.toId);
    if (from && to) addEdge(from, to, edge.kind);
  }
  const semanticTargetIdFor = (variable) => {
    if (variable.targetId) return variable.targetId;
    const linkTarget = variable.link?.target;
    if (typeof linkTarget === "string") return linkTarget;
    return linkTarget?.id;
  };
  const endingByTarget = new Map();
  for (const variable of variables.filter((candidate) => candidate.isEnding)) {
    if (variable.link?.target?.routing === true) {
      return {
        ok: false,
        reason: "malformed-ending-target",
        rank,
        branchIds: [variable.branchId],
        linkIds: [variable.id],
        edgeKinds: ["target-dock"],
      };
    }
    const targetId = semanticTargetIdFor(variable);
    if (!targetId) continue;
    if (!endingByTarget.has(targetId)) endingByTarget.set(targetId, []);
    endingByTarget.get(targetId).push(variable);
  }
  for (const ending of [...endingByTarget.values()]) {
    ending.sort(compareDock((variable) => variable.targetDockY));
    for (let index = 1; index < ending.length; index += 1) {
      addEdge(ending[index - 1], ending[index], "target-dock");
    }
  }

  const edgeByKey = new Map();
  for (const edge of edges) {
    const key = `${edge.fromId}\0${edge.toId}\0${edge.kind}\0${edge.rank}`;
    edgeByKey.set(key, edge);
  }
  const dedupedEdges = [...edgeByKey.values()].sort(
    (a, b) =>
      compareLifecycleIds(a.fromId, b.fromId) ||
      compareLifecycleIds(a.toId, b.toId) ||
      compareLifecycleIds(a.kind, b.kind),
  );
  const byId = new Map(variables.map((variable) => [variable.id, variable]));
  const activeEdges = dedupedEdges;
  const indegree = new Map(variables.map((variable) => [variable.id, 0]));
  const outgoing = new Map(variables.map((variable) => [variable.id, []]));
  for (const edge of activeEdges) {
    outgoing.get(edge.fromId)?.push(edge.toId);
    indegree.set(edge.toId, (indegree.get(edge.toId) ?? 0) + 1);
  }
  const priorIndex = new Map(priorOrder.map((id, index) => [id, index]));
  const compareReady = (left, right) => {
    const leftPrior = priorIndex.has(left.branchId)
      ? priorIndex.get(left.branchId)
      : Infinity;
    const rightPrior = priorIndex.has(right.branchId)
      ? priorIndex.get(right.branchId)
      : Infinity;
    return (
      leftPrior - rightPrior ||
      left.sourceDockY - right.sourceDockY ||
      left.targetDockY - right.targetDockY ||
      compareStableVariables(left, right)
    );
  };
  const ready = variables
    .filter((variable) => indegree.get(variable.id) === 0)
    .sort(compareReady);
  const order = [];
  while (ready.length) {
    const variable = ready.shift();
    order.push(variable);
    for (const toId of outgoing.get(variable.id) ?? []) {
      indegree.set(toId, indegree.get(toId) - 1);
      if (indegree.get(toId) === 0) {
        ready.push(byId.get(toId));
        ready.sort(compareReady);
      }
    }
  }
  if (order.length === variables.length) {
    return { ok: true, order, edges: activeEdges, merged };
  }
  const cycleIds = [...indegree.entries()]
    .filter(([, count]) => count > 0)
    .map(([id]) => id)
    .sort(compareLifecycleIds);
  const cycleIdSet = new Set(cycleIds);
  const cycleEdges = activeEdges.filter(
    (edge) => cycleIdSet.has(edge.fromId) && cycleIdSet.has(edge.toId),
  );
  const cycleVariables = cycleIds.map((id) => byId.get(id)).filter(Boolean);
  const failure = {
    ok: false,
    reason: "semantic-order-cycle",
    rank,
    branchIds: [
      ...new Set(cycleVariables.map((variable) => variable.branchId)),
    ].sort(compareLifecycleIds),
    linkIds: cycleIds,
    edgeKinds: [...new Set(cycleEdges.map((edge) => edge.kind))].sort(
      compareLifecycleIds,
    ),
  };
  return failure;
};

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

// Yields every k-element subset of {0, ..., n - 1} as an ascending index
// array, in lexicographic order. Used to enumerate variable-combinations by
// increasing cardinality so a coordinate search can try small coordinated
// moves before large ones without relying on incidental value-sort order.
export function* combinationsOfSize(n, k) {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > n || k < 0) return;
  const combo = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield combo.slice();
    let i = k - 1;
    while (i >= 0 && combo[i] === n - k + i) i -= 1;
    if (i < 0) return;
    combo[i] += 1;
    for (let j = i + 1; j < k; j += 1) combo[j] = combo[i] + (j - i);
  }
}

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
  const resolveLinkEndpointRank = (link, endpointName) => {
    const endpoint = link[endpointName];
    const endpointId =
      endpoint && typeof endpoint === "object" ? endpoint.id : endpoint;
    const rank = rankByNodeId.get(endpointId);
    if (!Number.isInteger(rank)) {
      throw new Error(
        [
          "Lifecycle diagram layout invariant violated:",
          `link ${link.id ?? "<unknown>"}`,
          `references ${endpointName} ${String(endpointId)}`,
          "without valid integer graph node rank data",
        ].join(" "),
      );
    }
    return rank;
  };
  const transitionCounts = new Map();
  for (const link of graph.links ?? []) {
    const sourceRank = resolveLinkEndpointRank(link, "source");
    const targetRank = resolveLinkEndpointRank(link, "target");
    if (targetRank <= sourceRank || targetRank !== sourceRank + 1) {
      throw new Error(
        [
          "Lifecycle diagram layout invariant violated:",
          `link ${link.id ?? "<unknown>"}`,
          `has non-adjacent or reversed ranks ${sourceRank}->${targetRank}`,
        ].join(" "),
      );
    }
    if (sourceRank < 0 || sourceRank >= 6) {
      throw new Error(
        [
          "Lifecycle diagram layout invariant violated:",
          `link ${link.id ?? "<unknown>"}`,
          `has source rank ${sourceRank} outside transition bounds`,
        ].join(" "),
      );
    }
    for (let rank = sourceRank; rank < targetRank; rank += 1)
      transitionCounts.set(rank, (transitionCounts.get(rank) ?? 0) + 1);
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

// Layout-wide cache of full-geometry signatures already proven infeasible by
// layoutLifecycleRoutingGraph's candidateCallback, keyed to the specific
// classification recorded when that signature was first evaluated
// ("routing-anchor" materialization failure or "handle" placement failure)
// plus its evidence. Distinct search paths (different topological orderings
// or coordinate-refinement choices) that happen to land on identical
// committed lane Y values across the whole graph replay the recorded
// classification instead of redoing the doomed materialization or handle
// solve. Exported (rather than kept as a Set literal inline) so its typed
// replay semantics — restoring only the diagnostics that belong to the
// exact geometry being replayed, instead of leaving whatever an unrelated,
// more-recently-evaluated candidate last left behind — can be verified
// directly; candidateCallback below calls this same implementation, not a
// copy. State-limit rejections are never recorded here — budget exhaustion
// is not proof that a geometry is infeasible.
export function createLaneGeometryFailureCache() {
  const results = new Map();
  return {
    get(signature) {
      return results.get(signature) ?? null;
    },
    recordRoutingAnchorFailure(signature, error) {
      results.set(signature, { kind: "routing-anchor", error });
    },
    recordHandleFailure(signature, handleCheck) {
      results.set(signature, { kind: "handle", handleCheck });
    },
    get size() {
      return results.size;
    },
  };
}

export function layoutLifecycleRoutingGraph(
  projection,
  availableWidth,
  options = {},
) {
  const enableTestDiagnostics = isLifecycleLayoutTestEnvironment();
  const testOnlyBaseNodeOrderByRank = enableTestDiagnostics
    ? options.testOnlyBaseNodeOrderByRank
    : null;
  const testOnlyDiagnosticSink = enableTestDiagnostics
    ? options.testOnlyDiagnosticSink
    : null;
  const graph = options.routingGraph ?? buildLifecycleRoutingGraph(projection);
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
    .nodeSort((left, right) => {
      if (testOnlyBaseNodeOrderByRank && left.rank === right.rank) {
        const order = testOnlyBaseNodeOrderByRank.get?.(left.rank);
        if (order) {
          const leftIndex = order.get(left.id);
          const rightIndex = order.get(right.id);
          if (
            Number.isInteger(leftIndex) &&
            Number.isInteger(rightIndex) &&
            leftIndex !== rightIndex
          ) {
            return leftIndex - rightIndex;
          }
        }
      }
      return nodeSort(left, right);
    })
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
  const legalIntervalsForSpan = (minX, maxX, incidentIds = new Set()) => {
    const intervals = [];
    for (const [rawStart, rawEnd] of freeIntervalsForSpan(
      minX,
      maxX,
      incidentIds,
    )) {
      let start = quantizeY(
        Math.ceil((rawStart + LANE_Y_EPSILON) * 1000) / 1000,
      );
      let end = quantizeY(Math.floor((rawEnd - LANE_Y_EPSILON) * 1000) / 1000);
      while (
        start <= end &&
        !candidateClearsSpan(start, minX, maxX, incidentIds)
      ) {
        start = quantizeY(start + 0.001);
      }
      while (
        end >= start &&
        !candidateClearsSpan(end, minX, maxX, incidentIds)
      ) {
        end = quantizeY(end - 0.001);
      }
      if (end < start || end < laneTop || start > laneBottom) continue;
      const last = intervals.at(-1);
      if (last && start <= last[1] + 0.001 + LANE_Y_EPSILON) {
        last[1] = Math.max(last[1], end);
      } else {
        intervals.push([start, end]);
      }
    }
    return intervals;
  };
  const firstLegalAtOrAbove = (intervals, lower) => {
    const min = quantizeY(Math.ceil((lower - LANE_Y_EPSILON) * 1000) / 1000);
    for (const [start, end] of intervals) {
      const candidate = Math.max(start, min);
      if (candidate <= end + LANE_Y_EPSILON) return quantizeY(candidate);
    }
    return null;
  };
  const lastLegalAtOrBelow = (intervals, upper) => {
    const max = quantizeY(Math.floor((upper + LANE_Y_EPSILON) * 1000) / 1000);
    for (let index = intervals.length - 1; index >= 0; index -= 1) {
      const [start, end] = intervals[index];
      const candidate = Math.min(end, max);
      if (candidate >= start - LANE_Y_EPSILON) return quantizeY(candidate);
    }
    return null;
  };
  const legalNearestInEnvelope = (intervals, lower, upper, idealY) => {
    const start = quantizeY(Math.ceil((lower - LANE_Y_EPSILON) * 1000) / 1000);
    const end = quantizeY(Math.floor((upper + LANE_Y_EPSILON) * 1000) / 1000);
    let best = null;
    for (const [intervalStart, intervalEnd] of intervals) {
      const lo = Math.max(intervalStart, start);
      const hi = Math.min(intervalEnd, end);
      if (hi < lo - LANE_Y_EPSILON) continue;
      const candidate = quantizeY(Math.min(hi, Math.max(lo, idealY)));
      if (
        best === null ||
        Math.abs(candidate - idealY) <
          Math.abs(best - idealY) - LANE_Y_EPSILON ||
        (Math.abs(candidate - idealY) <= LANE_Y_EPSILON && candidate < best)
      ) {
        best = candidate;
      }
    }
    return best;
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
    return [...candidates].filter(
      (value) =>
        Number.isFinite(value) &&
        candidateClearsSpan(value, minX, maxX, incidentIds),
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
    const key = `${quantizeY(minX)}:${quantizeY(maxX)}:${incidentKey}:${quantizeY(idealY)}`;
    if (!laneDomainCache.has(key)) {
      laneDomainCache.set(
        key,
        laneCandidatesForSpan({ minX, maxX, incidentIds, idealY }),
      );
    }
    return laneDomainCache.get(key) ?? [];
  };
  const assignMonotone = (items, domainFor, idealFor, onStateVisited) => {
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
        onStateVisited?.();
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
  const transitionLaneSolverStats = {
    components: 0,
    statesVisited: 0,
    stateLimit: options.transitionLaneStateLimit ?? 200000,
    backtracks: 0,
    memoizedFailures: 0,
    candidateEvaluations: 0,
    handleStatesVisited: 0,
    handleStateLimit: 0,
  };
  const sortedUnique = (values) =>
    [...new Set(values.filter(Boolean))].sort(compareLifecycleIds);
  const laneFailureCause = (reason, context = {}) =>
    Object.freeze({
      type: "lifecycle-transition-lane-order",
      reason,
      rank: context.rank ?? null,
      branchIds: Object.freeze(sortedUnique(context.branchIds ?? [])),
      linkIds: Object.freeze(sortedUnique(context.linkIds ?? [])),
      edgeKinds: Object.freeze(sortedUnique(context.edgeKinds ?? [])),
      statesVisited: transitionLaneSolverStats.statesVisited,
      stateLimit: transitionLaneSolverStats.stateLimit,
      backtracks: transitionLaneSolverStats.backtracks,
      memoizedFailures: transitionLaneSolverStats.memoizedFailures,
    });
  // A deterministic solver state is one attempted prefix-variable placement
  // or one fixed-order interval item visit during forward/backward/rebuild.
  // All ordering, coordinate-variant, and handle-refinement work is charged
  // against one aggregate bound so that budget exhaustion remains
  // distinguishable from proving lane or handle infeasibility.
  const recordSolverState = (context = {}) => {
    transitionLaneSolverStats.statesVisited += 1;
    if (
      transitionLaneSolverStats.statesVisited >
      transitionLaneSolverStats.stateLimit
    ) {
      const cause = laneFailureCause("state-limit", context ?? {});
      const firstId = cause.linkIds[0] ?? cause.branchIds[0] ?? "unknown";
      const error = new Error(
        [
          "Lifecycle transition lane allocation exceeded",
          `${transitionLaneSolverStats.stateLimit} deterministic states`,
          cause.rank === null ? "" : `at transition rank ${cause.rank}`,
          `for ${firstId}`,
        ]
          .filter(Boolean)
          .join(" "),
      );
      error.cause = cause;
      throw error;
    }
  };
  const solveTransitionLanes = (links, { candidateCallback } = {}) => {
    const variables = links
      .map((link) => {
        const rank = link.source.rank;
        const exitX = rankCenterX(rank) + RANK_CORRIDOR_HALF_WIDTH;
        const entryX = rankCenterX(link.target.rank) - RANK_CORRIDOR_HALF_WIDTH;
        const controlMinX = exitX + TRANSITION_CONTROL_OFFSET;
        const controlMaxX = entryX - TRANSITION_CONTROL_OFFSET;
        if (controlMinX > controlMaxX + LANE_Y_EPSILON) {
          throw new Error(
            `Lifecycle transition lane control span invariant violated for ${link.id}`,
          );
        }
        // The constant transition lane Y controls the cubic plateau, while
        // clearance is guaranteed across the full source-to-target corridor
        // exercised by the renderer-level obstacle contract.
        const clearanceMinX = rankCenterX(rank) - RANK_CORRIDOR_HALF_WIDTH;
        const clearanceMaxX =
          rankCenterX(link.target.rank) + RANK_CORRIDOR_HALF_WIDTH;
        const incidentIds = new Set([link.source.id, link.target.id]);
        const sourceDockY = Number.isFinite(link.y0)
          ? link.y0
          : (link.source.y0 + link.source.y1) / 2;
        const targetDockY = Number.isFinite(link.y1)
          ? link.y1
          : (link.target.y0 + link.target.y1) / 2;
        const idealY = clampLaneY((sourceDockY + targetDockY) / 2);
        return {
          id: link.id,
          branchId: link.branchId,
          stableId: link.sortKey ?? link.id,
          rank,
          link,
          idealY,
          sourceDockY,
          targetDockY,
          sourceId: branchById.get(link.branchId)?.source ?? link.source?.id,
          targetId: branchById.get(link.branchId)?.target ?? link.target?.id,
          controlMinX,
          controlMaxX,
          minX: clearanceMinX,
          maxX: clearanceMaxX,
          incidentIds,
          intervals: legalIntervalsForSpan(
            clearanceMinX,
            clearanceMaxX,
            incidentIds,
          ),
          isEnding: null,
        };
      })
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          compareLifecycleIds(a.branchId, b.branchId) ||
          compareLifecycleIds(a.id, b.id),
      );
    const variablesByRank = new Map();
    const ranks = new Set();
    for (const variable of variables) {
      if (!variablesByRank.has(variable.rank))
        variablesByRank.set(variable.rank, []);
      variablesByRank.get(variable.rank).push(variable);
      ranks.add(variable.rank);
    }
    const sortedRanks = [...ranks].sort((a, b) => a - b);
    for (const variable of variables) {
      variable.isEnding = !variables.some(
        (candidate) =>
          candidate.branchId === variable.branchId &&
          candidate.rank === variable.rank + 1,
      );
    }

    const branchSpans = new Map();
    for (const branchId of new Set(
      variables.map((variable) => variable.branchId),
    )) {
      const branchVariables = variables
        .filter((variable) => variable.branchId === branchId)
        .sort((a, b) => a.rank - b.rank || compareLifecycleIds(a.id, b.id));
      const first = branchVariables[0];
      const last = branchVariables[branchVariables.length - 1];
      branchSpans.set(branchId, {
        branchId,
        semanticSourceId: first.sourceId,
        semanticTargetId: last.targetId,
        startRank: first.rank,
        endRank: last.rank + 1,
        sourceDockY: first.sourceDockY,
        targetDockY: last.targetDockY,
        stableId: first.stableId ?? first.id,
      });
    }
    const branchPrecedenceEdges = [];
    const addBranchEdges = (groups, dockKey, kind) => {
      for (const group of groups.values()) {
        group.sort(
          (left, right) =>
            left[dockKey] - right[dockKey] ||
            compareLifecycleIds(left.stableId, right.stableId) ||
            compareLifecycleIds(left.branchId, right.branchId),
        );
        for (let index = 1; index < group.length; index += 1) {
          branchPrecedenceEdges.push({
            fromBranchId: group[index - 1].branchId,
            toBranchId: group[index].branchId,
            kind,
          });
        }
      }
    };
    const sourceGroups = new Map();
    const targetGroups = new Map();
    for (const span of branchSpans.values()) {
      if (span.semanticSourceId) {
        if (!sourceGroups.has(span.semanticSourceId))
          sourceGroups.set(span.semanticSourceId, []);
        sourceGroups.get(span.semanticSourceId).push(span);
      }
      if (span.semanticTargetId) {
        if (!targetGroups.has(span.semanticTargetId))
          targetGroups.set(span.semanticTargetId, []);
        targetGroups.get(span.semanticTargetId).push(span);
      }
    }
    // Endpoint order is projected across common active ranks so earlier
    // continuation choices cannot postpone an unavoidable dock conflict.
    addBranchEdges(sourceGroups, "sourceDockY", "source-dock");
    addBranchEdges(targetGroups, "targetDockY", "target-dock");
    // variant: "forward" returns minimum-Y assignment; "backward" returns maximum-Y
    // assignment (null when infeasible from that direction); "centered" (default)
    // returns the DP-centered assignment, falling back to "forward" when needed.
    const assignMonotoneIntervals = (
      items,
      onStateVisited = recordSolverState,
      variant = "centered",
    ) => {
      if (!items.length) return [];
      const forward = [];
      let lower = laneTop;
      for (const item of items) {
        onStateVisited?.();
        const value = firstLegalAtOrAbove(item.intervals, lower);
        if (
          value === null ||
          !candidateClearsSpan(value, item.minX, item.maxX, item.incidentIds)
        )
          return null;
        forward.push(value);
        lower = quantizeY(value + minLaneSpacing + LANE_Y_EPSILON);
      }
      if (variant === "forward") return forward;
      const backward = Array(items.length);
      let upper = laneBottom;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        onStateVisited?.();
        const value = lastLegalAtOrBelow(items[index].intervals, upper);
        if (value === null || value < forward[index] - LANE_Y_EPSILON) {
          return variant === "backward" ? null : forward;
        }
        backward[index] = value;
        upper = quantizeY(value - minLaneSpacing);
      }
      if (variant === "backward") return backward;
      const solved = [];
      let previous = null;
      for (let index = 0; index < items.length; index += 1) {
        onStateVisited?.();
        const lowerBound = Math.max(
          forward[index],
          previous === null
            ? laneTop
            : quantizeY(previous + minLaneSpacing + LANE_Y_EPSILON),
        );
        const upperBound = backward[index];
        const value = legalNearestInEnvelope(
          items[index].intervals,
          lowerBound,
          upperBound,
          items[index].idealY,
        );
        if (value === null) return forward;
        if (
          !Number.isFinite(value) ||
          (previous !== null &&
            value < previous + minLaneSpacing - LANE_Y_EPSILON) ||
          !candidateClearsSpan(
            value,
            items[index].minX,
            items[index].maxX,
            items[index].incidentIds,
          )
        ) {
          // The centered candidate is only a preference; `forward` was
          // already validated above (clearance + spacing) and remains a
          // legal fallback when the ideal-centered value is unusable.
          return forward;
        }
        solved.push(value);
        previous = value;
      }
      return solved;
    };
    // Upfront: malformed ending targets (routing node as production link target)
    for (const variable of variables) {
      if (variable.isEnding && variable.link?.target?.routing === true) {
        const cause = laneFailureCause("malformed-ending-target", {
          rank: variable.rank,
          branchIds: [variable.branchId],
          linkIds: [variable.id],
          edgeKinds: ["target-dock"],
        });
        const error = new Error(
          [
            "Lifecycle transition lane allocation failed:",
            "malformed-ending-target",
            `at transition rank ${variable.rank}`,
            `for ${variable.id}`,
          ].join(" "),
        );
        error.cause = cause;
        throw error;
      }
    }
    const solveGlobal = () => {
      const allBranchIds = [...branchSpans.keys()].sort(compareLifecycleIds);
      if (!allBranchIds.length)
        return {
          assignments: new Map(),
          componentOrderings: new Map(),
          componentMembers: new Map(),
        };

      // Per-rank active branch sets and per-branch variable lookup
      const activeBranchesAtRank = new Map(
        sortedRanks.map((rank) => [
          rank,
          new Set((variablesByRank.get(rank) ?? []).map((v) => v.branchId)),
        ]),
      );
      const variableByBranchAtRank = new Map();
      for (const [rank, rankVars] of variablesByRank) {
        for (const v of rankVars) {
          variableByBranchAtRank.set(`${v.branchId}:${rank}`, v);
        }
      }

      // Build branch-level DAG (only edges between branches with overlapping spans)
      const branchOutgoing = new Map(allBranchIds.map((id) => [id, []]));
      const branchIndegree = new Map(allBranchIds.map((id) => [id, 0]));
      const seenEdges = new Set();
      for (const edge of branchPrecedenceEdges) {
        const fromSpan = branchSpans.get(edge.fromBranchId);
        const toSpan = branchSpans.get(edge.toBranchId);
        if (!fromSpan || !toSpan) continue;
        if (
          fromSpan.startRank >= toSpan.endRank ||
          toSpan.startRank >= fromSpan.endRank
        )
          continue;
        const edgeKey = `${edge.fromBranchId}\0${edge.toBranchId}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        branchOutgoing.get(edge.fromBranchId)?.push(edge.toBranchId);
        branchIndegree.set(
          edge.toBranchId,
          (branchIndegree.get(edge.toBranchId) ?? 0) + 1,
        );
      }

      // Detect precedence cycles via Kahn's topological sort
      {
        const scratch = new Map(branchIndegree);
        const queue = allBranchIds.filter((id) => scratch.get(id) === 0);
        const sorted = [];
        while (queue.length) {
          const id = queue.shift();
          sorted.push(id);
          for (const toId of branchOutgoing.get(id) ?? []) {
            scratch.set(toId, (scratch.get(toId) ?? 0) - 1);
            if (scratch.get(toId) === 0) queue.push(toId);
          }
        }
        if (sorted.length !== allBranchIds.length) {
          const cycleIds = allBranchIds
            .filter((id) => (scratch.get(id) ?? 0) > 0)
            .sort(compareLifecycleIds);
          const cycleVars = cycleIds.flatMap((id) =>
            sortedRanks
              .map((rank) => variableByBranchAtRank.get(`${id}:${rank}`))
              .filter(Boolean),
          );
          const cause = laneFailureCause("semantic-order-cycle", {
            rank: null,
            branchIds: cycleIds,
            linkIds: cycleVars.map((v) => v.id),
            edgeKinds: ["source-dock", "target-dock"],
          });
          const error = new Error(
            [
              "Lifecycle transition lane allocation failed:",
              "semantic-order-cycle",
              `for ${cycleIds[0] ?? "unknown"}`,
            ].join(" "),
          );
          error.cause = cause;
          throw error;
        }
      }

      // Union-find: group branches that share at least one active rank
      const componentParent = new Map(allBranchIds.map((id) => [id, id]));
      const findRoot = (id) => {
        let node = id;
        while (componentParent.get(node) !== node)
          node = componentParent.get(node);
        let cur = id;
        while (cur !== node) {
          const next = componentParent.get(cur);
          componentParent.set(cur, node);
          cur = next;
        }
        return node;
      };
      const unionNodes = (a, b) => {
        const ra = findRoot(a);
        const rb = findRoot(b);
        if (ra !== rb) componentParent.set(ra, rb);
      };
      for (const activeBranches of activeBranchesAtRank.values()) {
        const arr = [...activeBranches];
        for (let i = 1; i < arr.length; i += 1) unionNodes(arr[0], arr[i]);
      }
      const componentMap = new Map();
      for (const id of allBranchIds) {
        const root = findRoot(id);
        if (!componentMap.has(root)) componentMap.set(root, []);
        componentMap.get(root).push(id);
      }

      // Global assignments accumulator; component records for diagnostics.
      const globalAssignments = new Map();
      const componentOrderings = new Map();
      const componentMembers = new Map();

      // Convert component map to an array so recursive index-based traversal works.
      const componentList = [...componentMap.values()];

      // Every active rank's branches all belong to exactly one component (the
      // union-find above groups branches that share a rank), so once every
      // component has committed a centered per-rank assignment this map holds
      // the complete graph's {rankOrder, cen} data — the input global
      // coordinate refinement (below) reads once at the full leaf.
      const rankRefinementInfo = new Map();
      const allLinkIds = allBranchIds.flatMap((id) =>
        sortedRanks
          .map((rank) => variableByBranchAtRank.get(`${id}:${rank}`)?.id)
          .filter(Boolean),
      );

      // Global coordinate refinement: runs once per complete cross-component
      // topology, after the fully-centered globalAssignments has already been
      // rejected by candidateCallback at the base case below. Unlike the
      // former per-component design, this never re-invokes solveFromComponent
      // — candidateCallback is a flat leaf check (materialize geometry, then
      // strict handle placement) — so trying many alternative coordinates
      // here costs one handle-solve per candidate, not a full re-solve of
      // every downstream component. This lets refinement search implicated
      // variables from *any* component jointly, without the exponential
      // blowup that motivated the earlier isLastComponent/MAX_COORD_VARS/
      // coordDepthLimit restrictions (removed).
      const refineGlobalLaneCoordinates = () => {
        const blocked = lastHandleFailure?.blockedBranchIds ?? [];
        const routeBlockerIds = (lastHandleFailure?.branchDiagnostics ?? [])
          .map((diagnostic) => diagnostic?.nearestRejectedCandidate?.blocker)
          .filter((blocker) => blocker?.kind === "route")
          .map((blocker) => blocker.branchId);
        const conflictPairIds = (
          lastHandleFailure?.component?.conflictingBranchPairs ?? []
        ).flat();
        const implicatedIds = new Set([
          ...blocked,
          ...routeBlockerIds,
          ...conflictPairIds,
        ]);
        if (!implicatedIds.size) return false;

        const blockedSet = new Set(blocked);
        // (branchId -> Set<rank>) targeted pairs, narrowed by diagnostics so
        // the search only considers ranks where a move could plausibly help.
        const implicatedPairsByBranch = new Map();

        // Route-blocker diagnostics: specific (branch, rank) pairs — the
        // blocked branch at its handle transition rank, and the blocking
        // route at its own transition rank.
        for (const diagnostic of lastHandleFailure?.branchDiagnostics ?? []) {
          const id = diagnostic?.branchId;
          if (!id) continue;
          const cand = diagnostic.nearestRejectedCandidate;
          if (!cand || cand.blocker?.kind !== "route") continue;
          if (Number.isInteger(cand.transitionRank)) {
            if (!implicatedPairsByBranch.has(id))
              implicatedPairsByBranch.set(id, new Set());
            implicatedPairsByBranch.get(id).add(cand.transitionRank);
          }
          const blockerId = cand.blocker.branchId;
          const blockerRank = cand.blocker.transitionRank;
          if (blockerId && Number.isInteger(blockerRank)) {
            if (!implicatedPairsByBranch.has(blockerId))
              implicatedPairsByBranch.set(blockerId, new Set());
            implicatedPairsByBranch.get(blockerId).add(blockerRank);
          }
        }

        // Route-crossing diagnostics: both branches in a rejected
        // proper-crossing/coincidence finding, at the specific rank the
        // finding occurred — narrower and more actionable than falling
        // through to "every rank this branch is active" below.
        for (const finding of lastHandleFailure?.routeFindings ?? []) {
          const rank = finding.transitionRank;
          if (!Number.isInteger(rank)) continue;
          const ids =
            finding.branchIds ?? (finding.branchId ? [finding.branchId] : []);
          for (const id of ids) {
            if (!implicatedPairsByBranch.has(id))
              implicatedPairsByBranch.set(id, new Set());
            implicatedPairsByBranch.get(id).add(rank);
          }
        }

        // Conflict pairs: both members at every rank where they are
        // co-active, but only for pairs involving a directly-blocked branch.
        for (const [leftId, rightId] of lastHandleFailure?.component
          ?.conflictingBranchPairs ?? []) {
          if (!blockedSet.has(leftId) && !blockedSet.has(rightId)) continue;
          for (const [pId, otherId] of [
            [leftId, rightId],
            [rightId, leftId],
          ]) {
            for (const rank of sortedRanks) {
              const aB = activeBranchesAtRank.get(rank);
              if (aB?.has(pId) && aB?.has(otherId)) {
                if (!implicatedPairsByBranch.has(pId))
                  implicatedPairsByBranch.set(pId, new Set());
                implicatedPairsByBranch.get(pId).add(rank);
              }
            }
          }
        }

        // Fallback: every implicated branch at every rank it is active,
        // when no diagnostic source supplied rank information.
        if (!implicatedPairsByBranch.size) {
          for (const branchId of implicatedIds) {
            const rankSet = new Set();
            for (const rank of sortedRanks) {
              if (activeBranchesAtRank.get(rank)?.has(branchId))
                rankSet.add(rank);
            }
            if (rankSet.size) implicatedPairsByBranch.set(branchId, rankSet);
          }
        }

        // Build a finite critical-value domain for every targeted
        // (branchId, rank) variable: interval boundaries, forward minimum,
        // backward maximum, and nearest-ideal within the neighbour-
        // constrained envelope, plus the centred value itself (so a
        // variable may legally choose to stay put while others move).
        //
        // The envelope is only clamped against a neighbour's centred value
        // when that neighbour is *not* itself implicated. When an adjacent
        // variable is also implicated it may move in the same combination,
        // so clamping against its stale centred value would exclude legal
        // solutions requiring the two to move together; the neighbour's own
        // domain plus the full spacing validation below jointly guarantee
        // correctness regardless of envelope width.
        const vars = [];
        for (const [branchId, rankSet] of implicatedPairsByBranch) {
          for (const rank of rankSet) {
            const info = rankRefinementInfo.get(rank);
            if (!info) continue;
            const { rankOrder, cen } = info;
            const idx = rankOrder.findIndex((v) => v.branchId === branchId);
            if (idx < 0) continue;
            const v = rankOrder[idx];
            const leftNeighborImplicated =
              idx > 0 && implicatedIds.has(rankOrder[idx - 1].branchId);
            const rightNeighborImplicated =
              idx < rankOrder.length - 1 &&
              implicatedIds.has(rankOrder[idx + 1].branchId);
            const lo =
              idx > 0 && !leftNeighborImplicated
                ? quantizeY(cen[idx - 1] + minLaneSpacing + LANE_Y_EPSILON)
                : laneTop;
            const hi =
              idx < rankOrder.length - 1 && !rightNeighborImplicated
                ? quantizeY(cen[idx + 1] - minLaneSpacing)
                : laneBottom;
            const domainSet = new Set([cen[idx]]);
            const yFwd = firstLegalAtOrAbove(v.intervals, lo);
            if (yFwd !== null && yFwd <= hi + LANE_Y_EPSILON)
              domainSet.add(yFwd);
            const yBwd = lastLegalAtOrBelow(v.intervals, hi);
            if (yBwd !== null && yBwd >= lo - LANE_Y_EPSILON)
              domainSet.add(yBwd);
            const yIdeal = legalNearestInEnvelope(
              v.intervals,
              lo,
              hi,
              v.idealY,
            );
            if (yIdeal !== null) domainSet.add(yIdeal);
            for (const [iLo, iHi] of v.intervals) {
              for (const boundary of [iLo, iHi]) {
                const q = quantizeY(boundary);
                if (
                  q >= lo - LANE_Y_EPSILON &&
                  q <= hi + LANE_Y_EPSILON &&
                  candidateClearsSpan(q, v.minX, v.maxX, v.incidentIds)
                )
                  domainSet.add(q);
              }
            }
            const centeredValue = cen[idx];
            // moveAlternatives excludes the centred value itself: a variable
            // included in a refinement combination below is being tested for
            // an actual deviation from centred, not a no-op re-selection of
            // its current value. Sorted by distance from ideal Y so a
            // combination's cartesian search tries the most plausible
            // deviation for each variable first.
            const moveAlternatives = [...domainSet]
              .filter((y) => y !== centeredValue)
              .sort(
                (a, b) =>
                  Math.abs(a - v.idealY) - Math.abs(b - v.idealY) || a - b,
              );
            vars.push({
              key: `${rank}:${idx}`,
              rank,
              idx,
              id: v.id,
              branchId,
              centeredValue,
              moveAlternatives,
            });
          }
        }

        if (!vars.length) return false;

        // Stable base ordering (rank, then branch identity) purely so MRV
        // tie-breaks below are deterministic. Real variable selection is
        // recomputed at every recursion step (see selectVar), mirroring
        // selectBranch() in solveHandleCandidateSets/solveComponent.
        vars.sort(
          (a, b) =>
            a.rank - b.rank || compareLifecycleIds(a.branchId, b.branchId),
        );
        for (const entry of vars) {
          entry.domain = [entry.centeredValue, ...entry.moveAlternatives];
        }

        // A variable with zero legal non-centred alternatives can only ever
        // stay at its centred value, which the caller already tried and
        // rejected before invoking this function, so it is never a decision
        // variable for this search — it simply remains centred throughout.
        const decisionVars = vars.filter((v) => v.moveAlternatives.length > 0);
        if (!decisionVars.length) return false;
        const decisionVarByKey = new Map(decisionVars.map((v) => [v.key, v]));

        // chosenValues always holds a complete assignment for every
        // implicated variable: it starts (and, for any decision variable not
        // yet resolved on the current DFS path, remains) at that variable's
        // centred value. This lets validateFull() below always read a
        // fully-resolved candidate regardless of search depth, and lets
        // valueAt()/spacingLegal() treat every variable uniformly instead of
        // branching on whether it happens to be a decision variable.
        const chosenValues = new Map(vars.map((v) => [v.key, v.centeredValue]));
        // Keys of decision variables resolved on the current DFS path.
        // Neighbour legality checks must not constrain against an
        // unresolved decision variable's default centred value, since it may
        // still move once resolved; the authoritative check is
        // validateFull() at each complete leaf.
        const resolvedKeys = new Set();
        const isPending = (key) =>
          decisionVarByKey.has(key) && !resolvedKeys.has(key);

        const valueAt = (rank, idx) => {
          const key = `${rank}:${idx}`;
          if (chosenValues.has(key)) return chosenValues.get(key);
          return rankRefinementInfo.get(rank).cen[idx];
        };

        const spacingLegal = (rank, idx, y) => {
          const { rankOrder } = rankRefinementInfo.get(rank);
          if (idx > 0) {
            const leftKey = `${rank}:${idx - 1}`;
            if (!isPending(leftKey)) {
              if (y < valueAt(rank, idx - 1) + minLaneSpacing - LANE_Y_EPSILON)
                return false;
            }
          }
          if (idx < rankOrder.length - 1) {
            const rightKey = `${rank}:${idx + 1}`;
            if (!isPending(rightKey)) {
              if (y > valueAt(rank, idx + 1) - minLaneSpacing + LANE_Y_EPSILON)
                return false;
            }
          }
          return true;
        };

        // Forward check: every not-yet-resolved neighbour must retain at
        // least one legal value — its own centred value or a non-centred
        // alternative — given this tentative assignment before descending
        // further.
        const forwardCheckOk = (rank, idx) => {
          for (const neighborIdx of [idx - 1, idx + 1]) {
            const neighborKey = `${rank}:${neighborIdx}`;
            if (!isPending(neighborKey)) continue;
            const neighbor = decisionVarByKey.get(neighborKey);
            const feasible = neighbor.domain.some((y) =>
              spacingLegal(rank, neighborIdx, y),
            );
            if (!feasible) return false;
          }
          return true;
        };

        // Authoritative correctness check at a complete candidate: full
        // per-rank monotone-spacing validation across every active rank in
        // the whole graph (not only the implicated pairs), mirroring the
        // legality guarantee the removed per-component buildFromChosen once
        // provided.
        const validateFull = () => {
          for (const [rank, info] of rankRefinementInfo) {
            const { rankOrder, cen } = info;
            let prev = null;
            for (let i = 0; i < rankOrder.length; i += 1) {
              const key = `${rank}:${i}`;
              const val = chosenValues.has(key)
                ? chosenValues.get(key)
                : cen[i];
              if (prev !== null && val < prev + minLaneSpacing - LANE_Y_EPSILON)
                return false;
              prev = val;
            }
          }
          return true;
        };

        const applyChosenValues = () => {
          for (const entry of decisionVars) {
            globalAssignments.set(entry.id, chosenValues.get(entry.key));
          }
        };
        const revertChosenValues = () => {
          for (const entry of decisionVars) {
            globalAssignments.set(entry.id, entry.centeredValue);
          }
        };

        // Seed dedup with the already-tried, already-rejected all-centred
        // signature so the first (all-centred) DFS leaf is recognized
        // without a wasted handle-solve.
        const triedCoordSigs = new Set([
          allLinkIds.map((id) => globalAssignments.get(id) ?? "").join(","),
        ]);

        // Canonical fingerprint of the decision variables resolved so far on
        // this DFS path, used to prune re-exploration of an equivalent
        // partial assignment reached via a different variable order.
        const failedStates = new Set();
        const stateSignature = () =>
          [...resolvedKeys]
            .sort()
            .map((key) => `${key}:${chosenValues.get(key)}`)
            .join("|");

        // Most-constrained-variable selection: among unresolved decision
        // variables, pick the one with fewest currently-legal domain values
        // (recomputed every call, since earlier choices on this path narrow
        // what remains legal for later ones).
        const selectVar = () => {
          let chosen = null;
          let chosenCount = Infinity;
          for (const entry of decisionVars) {
            if (resolvedKeys.has(entry.key)) continue;
            const legalCount = entry.domain.filter((y) =>
              spacingLegal(entry.rank, entry.idx, y),
            ).length;
            if (legalCount < chosenCount) {
              chosen = entry;
              chosenCount = legalCount;
              if (chosenCount === 0) break;
            }
          }
          return chosen;
        };

        // Unified backtracking DFS directly over variable values (domain is
        // [centeredValue, ...moveAlternatives] per variable), replacing the
        // former subset-then-value enumeration: that approach paid an
        // exponential (2^m, m = movable variables) up-front cost to choose
        // *which* variables would deviate from centred before ever
        // searching their values, which exhausted the shared state budget
        // on dense fixtures long before a coordinated candidate was found.
        // There is no separate move-count budget here: domain order
        // ([centeredValue, ...moveAlternatives]) already means every DFS
        // path tries "stay centred" before any deviation, so backtracking
        // naturally reaches shallow-deviation leaves first — a solution
        // requiring few coordinated moves surfaces before one requiring
        // many, without pre-enumerating which variables move. An earlier
        // version of this search added an explicit per-pass move-count cap
        // (iterative deepening over "how many variables may deviate"); that
        // cap forced most variables to lock in at their centred value
        // before an adjacent decision variable ever got a chance to be
        // explored jointly with it, which made genuinely-coordinated
        // adjacent-pair moves unreachable. Plain MRV + forward-checking +
        // failed-state memoization (mirroring solveComponent below) does
        // not have that failure mode and remains complete because every
        // value of every decision variable stays reachable via ordinary
        // backtracking — there is no depth or combination-size cutoff.
        // Computed once: recordSolverState's context is only ever read when
        // the shared budget is actually exceeded, but every state charge
        // was re-spreading this Set into a fresh array regardless — costly
        // at the state counts a dense fixture's search can reach.
        const implicatedIdsArray = [...implicatedIds];
        const backtrack = () => {
          recordSolverState({
            branchIds: implicatedIdsArray,
            linkIds: allLinkIds,
          });
          const next = selectVar();
          if (!next) {
            if (!validateFull()) return false;
            applyChosenValues();
            const sig = allLinkIds
              .map((id) => globalAssignments.get(id) ?? "")
              .join(",");
            if (triedCoordSigs.has(sig)) {
              revertChosenValues();
              return false;
            }
            triedCoordSigs.add(sig);
            if (candidateCallback(globalAssignments, rankRefinementInfo))
              return true;
            revertChosenValues();
            return false;
          }
          const signature = stateSignature();
          if (failedStates.has(signature)) {
            transitionLaneSolverStats.memoizedFailures += 1;
            return false;
          }
          for (const y of next.domain) {
            recordSolverState({
              branchIds: implicatedIdsArray,
              linkIds: allLinkIds,
            });
            if (!spacingLegal(next.rank, next.idx, y)) continue;
            chosenValues.set(next.key, y);
            resolvedKeys.add(next.key);
            if (forwardCheckOk(next.rank, next.idx) && backtrack()) return true;
            resolvedKeys.delete(next.key);
            chosenValues.set(next.key, next.centeredValue);
            transitionLaneSolverStats.backtracks += 1;
          }
          failedStates.add(signature);
          return false;
        };

        return backtrack();
      };

      // Recursively solve each connected component, then check handle-feasibility.
      // When candidateCallback is provided, it is called with globalAssignments once
      // all components have placed their branches; it returns true to commit (and stop
      // the search) or false to continue searching for a different assignment. If the
      // centred assignment is rejected, global coordinate refinement (above) searches
      // for an alternative before this ordering combination is abandoned.
      const solveFromComponent = (componentIndex) => {
        if (componentIndex >= componentList.length) {
          // All components placed; evaluate this global candidate.
          if (!candidateCallback) return true;
          if (candidateCallback(globalAssignments, rankRefinementInfo))
            return true;
          return refineGlobalLaneCoordinates();
        }

        const componentBranchIds = componentList[componentIndex];
        // Stable component key: lexicographically smallest branch ID
        const compMinId = componentBranchIds.reduce((a, b) =>
          compareLifecycleIds(a, b) < 0 ? a : b,
        );
        const compIndegree = new Map(
          componentBranchIds.map((id) => [id, branchIndegree.get(id) ?? 0]),
        );
        const rankEnvelopes = new Map(sortedRanks.map((r) => [r, null]));
        const globalOrder = [];
        const globalOrderSet = new Set();
        const failedStateKeys = new Set();
        // Track complete orderings exhausted across all coordinate variants so the
        // search never re-explores the same (ordering, variant space) at this level.
        const failedCompleteOrderings = new Set();

        // Minimum deadline for a branch across all its active ranks
        const branchDeadline = (branchId) => {
          let min = Infinity;
          for (const rank of sortedRanks) {
            if (!activeBranchesAtRank.get(rank)?.has(branchId)) continue;
            const v = variableByBranchAtRank.get(`${branchId}:${rank}`);
            if (!v) return null;
            const d = lastLegalAtOrBelow(v.intervals, laneBottom);
            if (d === null) return null;
            if (d < min) min = d;
          }
          return min === Infinity ? null : min;
        };

        // Try placing branchId at every active rank; return envelope updates or null
        const tryPlaceBranch = (branchId) => {
          const updates = [];
          for (const rank of sortedRanks) {
            if (!activeBranchesAtRank.get(rank)?.has(branchId)) continue;
            const v = variableByBranchAtRank.get(`${branchId}:${rank}`);
            if (!v) {
              for (const u of updates) rankEnvelopes.set(u.rank, u.prev);
              return null;
            }
            const prev = rankEnvelopes.get(rank);
            const lower =
              prev === null
                ? laneTop
                : quantizeY(prev + minLaneSpacing + LANE_Y_EPSILON);
            const value = firstLegalAtOrAbove(v.intervals, lower);
            if (
              value === null ||
              !candidateClearsSpan(value, v.minX, v.maxX, v.incidentIds)
            ) {
              for (const u of updates) rankEnvelopes.set(u.rank, u.prev);
              return null;
            }
            updates.push({ rank, prev });
            rankEnvelopes.set(rank, value);
          }
          return updates;
        };

        // Capacity look-ahead: can the remaining unplaced branches still fit?
        const capacityOkForRemainder = () => {
          for (const rank of sortedRanks) {
            const activeBranches = activeBranchesAtRank.get(rank);
            if (!activeBranches?.size) continue;
            const remaining = componentBranchIds.filter(
              (id) => activeBranches.has(id) && !globalOrderSet.has(id),
            );
            if (!remaining.length) continue;
            const envelope = rankEnvelopes.get(rank);
            const lower =
              envelope === null
                ? laneTop
                : quantizeY(envelope + minLaneSpacing + LANE_Y_EPSILON);
            const deadlines = remaining
              .map((id) => {
                const v = variableByBranchAtRank.get(`${id}:${rank}`);
                return v ? lastLegalAtOrBelow(v.intervals, laneBottom) : null;
              })
              .filter((d) => d !== null)
              .sort((a, b) => a - b);
            if (deadlines.length !== remaining.length) return false;
            for (let i = 0; i < deadlines.length; i += 1) {
              if (deadlines[i] + LANE_Y_EPSILON < lower + i * minLaneSpacing)
                return false;
            }
          }
          return true;
        };

        // Canonical failed-state signature: for each rank that still has
        // unplaced active component branches, capture the current envelope
        // and the ordered continuation of already-placed branches active there.
        // State-equivalence invariant: two search states share an identical
        // future subtree iff every unresolved rank has the same envelope
        // (committed Y floor) and the same partial continuation order; the
        // canonical key encodes both so a memoized failure is only reused for
        // truly equivalent states.
        const canonicalStateKey = () => {
          const parts = [];
          for (const rank of sortedRanks) {
            const activeBranches = activeBranchesAtRank.get(rank);
            if (!activeBranches?.size) continue;
            const compActive = componentBranchIds.filter((id) =>
              activeBranches.has(id),
            );
            if (compActive.every((id) => globalOrderSet.has(id))) continue;
            const continuation = globalOrder.filter((id) =>
              activeBranches.has(id),
            );
            const envelope = rankEnvelopes.get(rank);
            parts.push(
              `${rank}:${envelope ?? "null"}:${continuation.join("|")}`,
            );
          }
          return parts.length ? parts.join(";") : null;
        };

        // Pre-collect variable IDs for state-limit error reporting
        const compLinkIds = componentBranchIds.flatMap((id) =>
          sortedRanks
            .map((rank) => variableByBranchAtRank.get(`${id}:${rank}`)?.id)
            .filter(Boolean),
        );
        const search = () => {
          recordSolverState({
            branchIds: componentBranchIds,
            linkIds: compLinkIds,
          });

          // Prune via canonical failed-state memoization
          const key = canonicalStateKey();
          if (key !== null && failedStateKeys.has(key)) {
            transitionLaneSolverStats.memoizedFailures += 1;
            return false;
          }

          if (globalOrder.length === componentBranchIds.length) {
            // Skip orderings whose centred assignment (combined with every
            // downstream component's own search, including one global
            // coordinate-refinement attempt at the full leaf) has already
            // been exhausted.
            const orderingKey = globalOrder.join(",");
            if (failedCompleteOrderings.has(orderingKey)) return false;

            // Compute the centered assignment for this component's active
            // ranks and publish it to the shared rankRefinementInfo map so
            // global coordinate refinement (run once at the full leaf, after
            // every component has committed an ordering) can read it without
            // recomputing. State charges happen only here (one per active
            // rank variable) so the aggregate budget counts ordering
            // evaluations fairly.
            const perRankPC = new Map(); // rank -> {rankOrder, cen}
            for (const rank of sortedRanks) {
              const activeBranches = activeBranchesAtRank.get(rank);
              if (!activeBranches?.size) continue;
              if (!componentBranchIds.some((id) => activeBranches.has(id)))
                continue;
              const rankOrder = globalOrder
                .filter((id) => activeBranches.has(id))
                .map((id) => variableByBranchAtRank.get(`${id}:${rank}`))
                .filter(Boolean);
              if (!rankOrder.length) continue;
              const cen = assignMonotoneIntervals(
                rankOrder,
                recordSolverState,
                "centered",
              );
              if (!cen) {
                failedCompleteOrderings.add(orderingKey);
                return false;
              }
              perRankPC.set(rank, { rankOrder, cen, minLaneSpacing });
            }

            const va = new Map();
            for (const [rank, { rankOrder, cen }] of perRankPC) {
              for (let i = 0; i < rankOrder.length; i += 1)
                va.set(rankOrder[i].id, cen[i]);
              rankRefinementInfo.set(rank, { rankOrder, cen });
            }

            for (const [id, value] of va) globalAssignments.set(id, value);
            if (solveFromComponent(componentIndex + 1)) {
              componentOrderings.set(compMinId, orderingKey);
              componentMembers.set(compMinId, componentBranchIds.slice());
              return true;
            }
            for (const id of va.keys()) globalAssignments.delete(id);
            for (const rank of perRankPC.keys())
              rankRefinementInfo.delete(rank);
            failedCompleteOrderings.add(orderingKey);
            return false;
          }

          if (!capacityOkForRemainder()) return false;

          // Ready branches: indegree 0, not yet placed, sorted by deadline
          // (MRV) first — that ordering is load-bearing for feasibility
          // (it's what keeps this DFS from needing to backtrack across
          // exponentially many orderings) and must not change. Among
          // branches tied on deadline, prefer compareBranches order (the
          // same endpoint-index-first criterion nodeSort/linkSort use for
          // the base d3-sankey layout) before falling back to the finer
          // dock-position tie-break below. Without this, globalOrder (and
          // so rankOrder, which the transition-lane search treats as
          // authoritative) can end up in a different relative order than
          // the base layout for branches the deadline ordering doesn't
          // otherwise distinguish, which is a documented source of route
          // crossings no amount of lane-Y tuning can fix — see
          // docs/design/lifecycle-diagram-layout-algorithm.md.
          //
          // One exception: nodeSort fixes real *origin* (rank 0) node
          // positions by taxonomy order, not endpointIndex — unlike ranks
          // 1-5, where nodeSort's own ordering (weightedEndpointMedian for
          // real milestone nodes, endpointIndex directly for routing nodes)
          // already roughly tracks compareBranches. So two branches that
          // both depart directly from an origin must respect that fixed
          // taxonomy order first; only branches sharing the very same
          // source (where taxonomy order can't discriminate) fall through
          // to compareBranches, which is what resolves sibling-branch
          // crossings at a shared dock. Getting this backwards for the
          // origin case reintroduces crossings between branches from
          // different origins whenever taxonomy order and endpoint-index
          // order disagree (confirmed directly, and confirmed that
          // widening this exception to every rank — not just rank 0 —
          // regresses everything else, since ranks 1-5 need
          // compareBranches first).
          const compareBranchesForGlobalOrder = (left, right) => {
            if (!left || !right) return 0;
            if (left.sourceRank === 0 && right.sourceRank === 0) {
              const taxonomyDiff =
                taxonomyOrder(left.source) - taxonomyOrder(right.source);
              if (taxonomyDiff !== 0) return taxonomyDiff;
            }
            return compareBranches(left, right);
          };
          const ready = componentBranchIds
            .filter(
              (id) => !globalOrderSet.has(id) && compIndegree.get(id) === 0,
            )
            .map((id) => {
              const span = branchSpans.get(id);
              return { id, deadline: branchDeadline(id), span };
            })
            .filter(({ deadline }) => deadline !== null)
            .sort(
              (a, b) =>
                (a.deadline ?? Infinity) - (b.deadline ?? Infinity) ||
                compareBranchesForGlobalOrder(
                  branchById.get(a.id),
                  branchById.get(b.id),
                ) ||
                (a.span?.sourceDockY ?? 0) - (b.span?.sourceDockY ?? 0) ||
                compareLifecycleIds(
                  a.span?.stableId ?? a.id,
                  b.span?.stableId ?? b.id,
                ) ||
                compareLifecycleIds(a.id, b.id),
            );

          if (!ready.length) return false;

          for (const { id: branchId } of ready) {
            const updates = tryPlaceBranch(branchId);
            if (!updates) continue;

            globalOrder.push(branchId);
            globalOrderSet.add(branchId);
            for (const toId of branchOutgoing.get(branchId) ?? []) {
              if (compIndegree.has(toId)) {
                compIndegree.set(toId, (compIndegree.get(toId) ?? 0) - 1);
              }
            }

            if (search()) return true;

            // Backtrack
            for (const toId of branchOutgoing.get(branchId) ?? []) {
              if (compIndegree.has(toId)) {
                compIndegree.set(toId, (compIndegree.get(toId) ?? 0) + 1);
              }
            }
            globalOrderSet.delete(branchId);
            globalOrder.pop();
            for (let i = updates.length - 1; i >= 0; i -= 1) {
              rankEnvelopes.set(updates[i].rank, updates[i].prev);
            }
            transitionLaneSolverStats.backtracks += 1;
          }

          // Record the canonical failed state so equivalent future searches
          // can be pruned without re-exploring.
          if (key !== null) failedStateKeys.add(key);

          return false;
        };

        // Upfront infeasibility check: a branch whose deadline is null has
        // no legal Y at some active rank regardless of ordering (see
        // branchDeadline above). The `ready` filter below drops such a
        // branch from consideration entirely, so completion
        // (globalOrder.length === componentBranchIds.length) becomes
        // permanently unreachable once one exists — the recursive MRV search
        // would otherwise explore every permutation of the remaining
        // placeable branches before exhausting the shared state budget and
        // misreporting a proven infeasibility as budget exhaustion. Detect
        // it here, before recursing, so the failure is immediate and
        // deterministic instead.
        for (const branchId of componentBranchIds) {
          if (branchDeadline(branchId) !== null) continue;
          const linkIds = sortedRanks
            .map(
              (rank) => variableByBranchAtRank.get(`${branchId}:${rank}`)?.id,
            )
            .filter(Boolean);
          const cause = laneFailureCause("no-feasible-topological-order", {
            rank: null,
            branchIds: [branchId],
            linkIds,
          });
          const firstId = cause.linkIds[0] ?? cause.branchIds[0] ?? "unknown";
          const error = new Error(
            [
              "Lifecycle transition lane allocation failed",
              `after ${transitionLaneSolverStats.statesVisited} deterministic states`,
              `for ${firstId}`,
            ].join(" "),
          );
          error.cause = cause;
          throw error;
        }

        return search();
      };

      if (!solveFromComponent(0)) {
        const allBranchIds = componentList.flat();
        const cause = laneFailureCause("no-feasible-topological-order", {
          rank: null,
          branchIds: allBranchIds,
          linkIds: allBranchIds.flatMap((id) =>
            sortedRanks
              .map((rank) => variableByBranchAtRank.get(`${id}:${rank}`)?.id)
              .filter(Boolean),
          ),
        });
        const firstId = cause.linkIds[0] ?? cause.branchIds[0] ?? "unknown";
        const error = new Error(
          [
            "Lifecycle transition lane allocation failed",
            `after ${transitionLaneSolverStats.statesVisited} deterministic states`,
            `for ${firstId}`,
          ].join(" "),
        );
        error.cause = cause;
        throw error;
      }

      return {
        assignments: globalAssignments,
        componentOrderings,
        componentMembers,
      };
    };
    return solveGlobal();
  };

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
  // Materialize a lane-assignment map onto graph link geometry.
  // Throws on geometry invariant violations; called inside the candidate callback.
  const materializeLaneAssignments = (assignments, rankRefinementInfo) => {
    for (const link of graph.links) {
      const laneY = assignments.get(link.id);
      if (!Number.isFinite(laneY)) {
        throw new Error(
          `Lifecycle transition lane allocation failed for ${link.id}`,
        );
      }
      link.transitionLaneY = laneY;
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
      const rankNodes = routingNodesByRank.get(rank) ?? [];
      const nodeIdealY = (node) => {
        const lanes = [
          ...(incomingByNode.get(node) ?? []),
          ...(outgoingByNode.get(node) ?? []),
        ]
          .map((link) => link.transitionLaneY)
          .filter((value) => Number.isFinite(value));
        if (!lanes.length) return (laneTop + laneBottom) / 2;
        return lanes.reduce((sum, value) => sum + value, 0) / lanes.length;
      };
      const idealByNode = new Map(
        rankNodes.map((node) => [node, nodeIdealY(node)]),
      );
      // Order routing nodes at this rank by their branch's position in
      // rankOrder — the same authoritative, globally-consistent per-rank
      // order the lane-coordinate search (refineGlobalLaneCoordinates) uses
      // and keeps crossing-free by construction — rather than the unrelated
      // static branch comparator this used before. assignMonotone enforces
      // strictly increasing Y in *array* order, so whichever order this
      // sort produces becomes each node's final relative position: sorting
      // by branch identity/endpoint instead of by rankOrder let the anchor
      // assignment invert the relative order the search already established
      // at the branches' non-routing ranks. See
      // docs/design/lifecycle-diagram-layout-algorithm.md — this fix only
      // holds once globalOrder's own DFS tie-break (in solveFromComponent)
      // prefers compareBranches order too; applied alone it previously
      // regressed the total crossing count on the routing fixture from 5 to
      // 10 by disagreeing with the base d3-sankey layout more than
      // compareBranches did. The ideal-Y-based ordering below is a fallback
      // only for a rank rankRefinementInfo has no entry for (should not
      // happen in practice, since every routing-node rank is also a
      // transition-lane rank); compareBranches remains only as a final
      // deterministic tie-break.
      const branchIndexAtRank = (branchId) => {
        const info = rankRefinementInfo?.get(rank);
        if (!info) return null;
        const idx = info.rankOrder.findIndex((v) => v.branchId === branchId);
        return idx < 0 ? null : idx;
      };
      const routingNodes = [...rankNodes].sort((left, right) => {
        const leftBranch = branchById.get(left.branchId);
        const rightBranch = branchById.get(right.branchId);
        if (!leftBranch || !rightBranch) {
          throw new Error(
            `Lifecycle routing-node invariant violated for rank ${rank}`,
          );
        }
        const leftIndex = branchIndexAtRank(left.branchId);
        const rightIndex = branchIndexAtRank(right.branchId);
        if (
          leftIndex !== null &&
          rightIndex !== null &&
          leftIndex !== rightIndex
        ) {
          return leftIndex - rightIndex;
        }
        return (
          idealByNode.get(left) - idealByNode.get(right) ||
          compareBranches(leftBranch, rightBranch) ||
          compareLifecycleIds(left.id, right.id)
        );
      });
      // Real (non-routing) nodes at this same rank have their own y0/y1
      // already fixed by d3-sankey's initial layout — but assignMonotone
      // above only ever saw routing nodes, so it could place one anywhere
      // in the lane space with no awareness that a real node's position
      // constrains where it may legally sit relative to it. Candidate
      // *domains* already exclude a real node's box as an obstacle
      // (laneDomainForSpan/candidateClearsSpan below), so a routing-node
      // anchor was never placed *on top of* a real node — but nothing
      // stopped it landing on the *wrong side* of one relative to the
      // order the lane-coordinate search intends, which is a route
      // crossing no amount of domain-obstacle-avoidance catches (confirmed
      // directly: a routing-node anchor ended up below a real milestone
      // node whose own incident branch needed to be above it). Folding real
      // nodes in as fixed (singleton-domain) entries in the same monotone
      // assignment makes their relative order an explicit constraint
      // routing nodes must respect, using the exact same DP that already
      // guarantees monotone spacing among routing nodes alone. See
      // docs/design/lifecycle-diagram-layout-algorithm.md.
      const realNodesAtRank = graph.nodes.filter(
        (node) => !node.routing && node.rank === rank,
      );
      const realNodeY = new Map(
        realNodesAtRank.map((node) => [node, (node.y0 + node.y1) / 2]),
      );
      const entries = [
        ...routingNodes.map((node) => ({ node, fixed: false })),
        ...realNodesAtRank.map((node) => ({ node, fixed: true })),
      ].sort(
        (a, b) =>
          (a.fixed ? realNodeY.get(a.node) : idealByNode.get(a.node)) -
          (b.fixed ? realNodeY.get(b.node) : idealByNode.get(b.node)),
      );
      const centerX = rankCenterX(rank);
      const assignment = assignMonotone(
        entries,
        (entry, idealY) =>
          entry.fixed
            ? [clampLaneY(realNodeY.get(entry.node))]
            : laneDomainForSpan({ minX: centerX, maxX: centerX, idealY }),
        (entry) =>
          entry.fixed ? realNodeY.get(entry.node) : idealByNode.get(entry.node),
      );
      if (!assignment) {
        // Routing-anchor feasibility depends on the incident links' lane Y
        // values (the anchor's ideal is their average), so a miss here is a
        // deliberately recoverable, candidate-specific failure — a different
        // lane-coordinate candidate for the same ordering may anchor this
        // rank successfully. Tag it distinctly from the hard invariants
        // below so candidateCallback can classify it instead of treating it
        // as an unexpected geometry bug.
        const anchorError = new Error(
          `Lifecycle routing anchor allocation failed for transition rank ${rank}`,
        );
        anchorError.cause = Object.freeze({
          type: "lifecycle-routing-anchor-allocation",
          reason: "routing-anchor-infeasible",
          rank,
        });
        throw anchorError;
      }
      entries.forEach((entry, index) => {
        if (entry.fixed) return;
        const anchorY = assignment[index];
        for (const link of incomingByNode.get(entry.node) ?? [])
          link.y1 = anchorY;
        for (const link of outgoingByNode.get(entry.node) ?? [])
          link.y0 = anchorY;
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
  };

  let lastHandleFailure = null;
  let lastHandleRouteEdgeCount = null;
  // Latest deliberately recoverable routing-anchor materialization failure
  // (see the "lifecycle-routing-anchor-allocation" cause above), retained so
  // the final error can surface it instead of a generic topology-cycle
  // message when every candidate failed materialization before ever
  // reaching handle placement. Kept distinct from lastHandleFailure because
  // the two describe different phases of a candidate's evaluation.
  let lastRoutingAnchorFailure = null;
  let candidateEvaluations = 0;
  // Each candidateCallback invocation does a full handle-placement check —
  // roughly O(branches^2) route-clearance work over every flattened route
  // segment — orders of magnitude more expensive than one backtracking
  // step charged against the shared transitionLaneSolverStats state
  // budget, and its cost varies enormously by fixture (dense multi-rank
  // routing multiplies the number of segments checked). This is bounded
  // deterministically rather than by wall-clock time: tryAssignBranchHandles
  // charges handleBudget for the generation pass itself (see its own
  // comment), on top of the existing per-candidate backtracking charge, so
  // a fixture whose geometry can never clear handle placement exhausts the
  // shared 32768-state budget after a bounded number of full generation
  // passes — independent of machine speed — instead of retrying expensive
  // work indefinitely.
  const handleBudget = { statesVisited: 0, stateLimit: 32768 };
  // See createLaneGeometryFailureCache() above for why a typed cache (rather
  // than a plain membership Set) is required: on a cache hit the callback
  // must still restore lastRoutingAnchorFailure/lastHandleFailure to
  // describe *this* geometry before returning, otherwise
  // refineGlobalLaneCoordinates() (which reads lastHandleFailure immediately
  // after a rejection) and the outer error classification would act on
  // whatever an unrelated, more-recently evaluated candidate last left
  // behind.
  const geometryFailureCache = createLaneGeometryFailureCache();

  const throwHandleStateLimitExceeded = () => {
    restoreBaseline();
    const handleError = new Error(
      `Lifecycle handle search exceeded ${handleBudget.stateLimit} states`,
    );
    handleError.cause = Object.freeze({
      type: "lifecycle-transition-lane-order",
      phase: "handle",
      reason: "state-limit",
      rank: null,
      branchIds: Object.freeze([]),
      linkIds: Object.freeze([]),
      edgeKinds: Object.freeze([]),
      statesVisited: handleBudget.statesVisited,
      stateLimit: handleBudget.stateLimit,
      backtracks: 0,
      memoizedFailures: 0,
      routeEdgeCount: lastHandleRouteEdgeCount,
    });
    throw handleError;
  };

  // Candidate evaluation callback: materialize the lane assignment, check
  // handle-feasibility, and return true to commit or false to continue the
  // search. Each call restores link geometry to the baseline before
  // materializing so that a failed candidate cannot corrupt later tries.
  const candidateCallback = (globalAssignments, rankRefinementInfo) => {
    restoreBaseline();
    candidateEvaluations += 1;
    const geometrySignature = [...globalAssignments.entries()]
      .sort(([a], [b]) => compareLifecycleIds(a, b))
      .map(([id, y]) => `${id}=${y}`)
      .join(",");
    const cachedResult = geometryFailureCache.get(geometrySignature);
    if (cachedResult) {
      // Replay this exact geometry's own recorded classification rather than
      // leaving whatever an intervening, unrelated candidate last set.
      if (cachedResult.kind === "routing-anchor") {
        lastRoutingAnchorFailure = cachedResult.error;
        lastHandleFailure = null;
      } else {
        lastHandleFailure = cachedResult.handleCheck;
        lastRoutingAnchorFailure = null;
      }
      return false;
    }
    try {
      materializeLaneAssignments(globalAssignments, rankRefinementInfo);
    } catch (error) {
      if (error.cause?.type === "lifecycle-routing-anchor-allocation") {
        // Recoverable, candidate-specific failure: retain the evidence for
        // final-error diagnostics, clear any stale handle-placement failure
        // from an earlier (unrelated) candidate so refineGlobalLaneCoordinates
        // does not act on diagnostics that do not describe this leaf, and
        // let the search continue with another candidate.
        lastRoutingAnchorFailure = error;
        lastHandleFailure = null;
        if (testOnlyDiagnosticSink) {
          testOnlyDiagnosticSink({
            phase: "routing-anchor",
            reason: error.cause,
            rankRefinementInfo,
            graph,
            handleBudget,
            transitionLaneSolverStats,
          });
        }
        geometryFailureCache.recordRoutingAnchorFailure(
          geometrySignature,
          error,
        );
        return false;
      }
      // Hard or unexpected materialization invariant (incomplete/non-finite
      // lane assignment, missing routing-branch mapping, non-finite route
      // coordinates, or a routing-continuity violation): propagate
      // immediately with its original evidence rather than silently
      // rejecting the candidate as if it were ordinary infeasibility. Never
      // cached — it is not a recoverable, candidate-specific rejection.
      throw error;
    }
    // Materialization succeeded: this candidate is no longer implicated by
    // an earlier routing-anchor failure.
    lastRoutingAnchorFailure = null;
    if (options.transitionLanePhaseOnly && enableTestDiagnostics) {
      testOnlyDiagnosticSink?.({
        phase: "accepted",
        rankRefinementInfo,
        graph,
        handleBudget,
        transitionLaneSolverStats,
      });
      // Test-only lane-phase exit: accept the first geometrically valid assignment.
      return true;
    }
    const handleCheck = tryAssignBranchHandles(
      graph.branches,
      linksByBranch,
      visibleNodes,
      { sharedBudget: handleBudget },
    );
    lastHandleRouteEdgeCount = handleCheck.routeEdgeCount ?? null;
    if (handleCheck.ok) {
      // Handle placement only checks each branch's own handle box against
      // fixed geometry, other branches' routes, and other handles — it has
      // no notion of two different branches' *routes* crossing or
      // coinciding with one another at a shared rank. Route-level safety is
      // a distinct, stricter contract (the same one
      // auditLifecycleRouteGeometry enforces for the renderer and the
      // Playwright collision audit exercises end-to-end), so a
      // handle-feasible candidate must still pass it before being accepted.
      // Without this, improving branch ordering elsewhere (see
      // docs/design/lifecycle-diagram-layout-algorithm.md) can shift which
      // candidate clears the handle-box check without any guarantee it's
      // actually crossing-free — confirmed directly: one fixture "passed"
      // handle placement on its very first (centered) candidate while
      // auditing that same geometry found 33 fatal route crossings.
      // Charged against the same shared budget as generation (see
      // tryAssignBranchHandles), scaled the same way (routeEdges squared)
      // since the audit's own cost is comparably driven by edge count — its
      // pairwise crossing check is O(edges-within-rank^2).
      if (handleBudget.statesVisited >= handleBudget.stateLimit)
        throwHandleStateLimitExceeded();
      const auditRouteEdgeCount = handleCheck.routeEdgeCount ?? 1;
      handleBudget.statesVisited += Math.max(
        1,
        Math.round((auditRouteEdgeCount * auditRouteEdgeCount) / 8450),
      );
      const routeAudit = auditLifecycleRouteGeometry({
        graph,
        dimensions,
        handles: handleCheck.handles,
      });
      if (routeAudit.fatalFindings.length === 0) {
        if (testOnlyDiagnosticSink) {
          testOnlyDiagnosticSink({
            phase: "accepted",
            rankRefinementInfo,
            graph,
            handleBudget,
            transitionLaneSolverStats,
          });
        }
        return true;
      }
      const blockedBranchIds = [
        ...new Set(
          routeAudit.fatalFindings.flatMap(
            (finding) =>
              finding.branchIds ?? (finding.branchId ? [finding.branchId] : []),
          ),
        ),
      ].sort(compareLifecycleIds);
      const routeFailure = {
        ok: false,
        reason: "route-crossing",
        blockedBranchIds,
        branchDiagnostics: [],
        routeFindings: routeAudit.fatalFindings,
      };
      lastHandleFailure = routeFailure;
      if (testOnlyDiagnosticSink) {
        testOnlyDiagnosticSink({
          phase: "route-crossing",
          reason: routeFailure,
          rankRefinementInfo,
          graph,
          handleBudget,
          transitionLaneSolverStats,
        });
      }
      geometryFailureCache.recordHandleFailure(geometrySignature, routeFailure);
      return false;
    }
    if (handleCheck.reason === "state-limit") {
      // Handle budget exhausted: stop the lane search immediately so the
      // budget-limit is reported rather than misreported as lane
      // infeasibility. Not cached — exhaustion is not proof of infeasibility.
      throwHandleStateLimitExceeded();
    }
    lastHandleFailure = handleCheck;
    if (testOnlyDiagnosticSink) {
      testOnlyDiagnosticSink({
        phase: "handle",
        reason: handleCheck,
        rankRefinementInfo,
        graph,
        handleBudget,
        transitionLaneSolverStats,
      });
    }
    geometryFailureCache.recordHandleFailure(geometrySignature, handleCheck);
    return false;
  };

  let laneResult;
  try {
    laneResult = solveTransitionLanes(graph.links, { candidateCallback });
  } catch (error) {
    // Ensure link geometry is fully restored. Recoverable routing-anchor
    // materialization failures are caught and classified inside the
    // callback; hard/unexpected materialization invariants are re-thrown
    // from the callback unchanged; errors reaching here come from the lane
    // solver itself (state-limit, no-feasible-order, etc.) or an
    // unrecovered hard invariant.
    restoreBaseline();
    // When all orderings × coordinate variants were lane-feasible but handle
    // placement failed for every one, report the structured handle failure
    // rather than lane infeasibility.
    if (
      error.cause?.reason === "no-feasible-topological-order" &&
      lastHandleFailure
    ) {
      throw handlePlacementError(lastHandleFailure);
    }
    // Exhaustive search proved every viable candidate failed routing-anchor
    // materialization (no candidate ever reached handle placement): surface
    // that deterministic evidence instead of the generic topology-cycle
    // message, which would misattribute the cause.
    if (
      error.cause?.reason === "no-feasible-topological-order" &&
      lastRoutingAnchorFailure
    ) {
      throw lastRoutingAnchorFailure;
    }
    // The lane-state budget was exhausted before search completed: keep
    // "state-limit" as the primary reason, but attach the latest
    // routing-anchor rejection as diagnostic context for why candidates
    // kept failing before the budget ran out.
    if (error.cause?.reason === "state-limit" && lastRoutingAnchorFailure) {
      error.cause = Object.freeze({
        ...error.cause,
        routingAnchorEvidence: lastRoutingAnchorFailure.cause,
      });
    }
    throw error;
  }

  // The callback committed a valid lane assignment (already materialized on the graph).
  transitionLaneSolverStats.components = laneResult.componentMembers.size;
  transitionLaneSolverStats.candidateEvaluations = candidateEvaluations;
  transitionLaneSolverStats.handleStatesVisited = handleBudget.statesVisited;
  transitionLaneSolverStats.handleStateLimit = handleBudget.stateLimit;
  graph.transitionLaneSolverStats = Object.freeze({
    ...transitionLaneSolverStats,
  });
  return { graph, dimensions };
}

export function testOnlyDiagnoseLifecycleLayoutAttempt(
  projection,
  availableWidth,
  options = {},
) {
  if (!isLifecycleLayoutTestEnvironment()) {
    throw new Error("Lifecycle layout diagnostics are available only in tests");
  }
  const snapshots = [];
  const diagnosticComplete = Symbol("lifecycle-layout-diagnostic-complete");
  const orderByRank = options.baseNodeOrderByRank
    ? new Map(
        [...options.baseNodeOrderByRank].map(([rank, ids]) => [
          rank,
          new Map(ids.map((id, index) => [id, index])),
        ]),
      )
    : undefined;
  const quantizedIntervalValueCount = (intervals) =>
    intervals.reduce((sum, [lo, hi]) => {
      const start = Math.ceil((lo - LANE_Y_EPSILON) * 1000);
      const end = Math.floor((hi + LANE_Y_EPSILON) * 1000);
      return sum + Math.max(0, end - start + 1);
    }, 0);
  const intervalContains = (intervals, value) =>
    intervals.some(
      ([lo, hi]) =>
        value >= lo - LANE_Y_EPSILON && value <= hi + LANE_Y_EPSILON,
    );
  const structuredReason = (phase, reason, ranks = []) => {
    if (!reason) return null;
    const affectedRanks = [
      reason.rank,
      ...(reason.routeFindings ?? []).map((finding) => finding.rank),
      ...(reason.branchDiagnostics ?? []).map((diagnostic) => diagnostic.rank),
    ].filter((rank) => Number.isFinite(rank));
    if (!affectedRanks.length && reason.blockedBranchIds?.length) {
      const blocked = new Set(reason.blockedBranchIds);
      for (const rank of ranks) {
        if (rank.branchOrder.some((branchId) => blocked.has(branchId))) {
          affectedRanks.push(rank.rank);
        }
      }
    }
    return {
      reason: reason.reason ?? String(reason),
      firstAffectedRank: affectedRanks.length
        ? Math.min(...affectedRanks)
        : null,
      evidence: {
        type: reason.type ?? null,
        blockedBranchIds: reason.blockedBranchIds ?? [],
        routeFindingCount: reason.routeFindings?.length ?? 0,
        branchDiagnosticCount: reason.branchDiagnostics?.length ?? 0,
      },
    };
  };
  const summarize = ({
    phase,
    reason,
    rankRefinementInfo,
    graph,
    handleBudget,
    transitionLaneSolverStats,
  }) => {
    const ranks = [...rankRefinementInfo.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rank, info]) => {
        const branchOrder = info.rankOrder.map((entry) => entry.branchId);
        const centeredAssignmentFeasible = info.cen.every((value, index) => {
          if (!Number.isFinite(value)) return false;
          if (!intervalContains(info.rankOrder[index].intervals, value))
            return false;
          if (index === 0) return true;
          return (
            value >=
            info.cen[index - 1] + (info.minLaneSpacing ?? 0) - LANE_Y_EPSILON
          );
        });
        return {
          rank,
          branchOrder,
          nodePositions: graph.nodes
            .filter((node) => node.rank === rank)
            .sort(
              (left, right) =>
                (left.y0 + left.y1) / 2 - (right.y0 + right.y1) / 2 ||
                Number(left.routing) - Number(right.routing) ||
                compareLifecycleIds(left.id, right.id),
            )
            .map((node) => ({
              id: node.id,
              kind: node.routing ? "routing" : "real",
              routing: Boolean(node.routing),
              y0: node.y0,
              y1: node.y1,
            })),
          domains: info.rankOrder.map((entry, index) => ({
            linkId: entry.id,
            branchId: entry.branchId,
            intervalCount: entry.intervals.length,
            domainSize: quantizedIntervalValueCount(entry.intervals),
            centeredY: info.cen[index],
            centeredInDomain: intervalContains(
              entry.intervals,
              info.cen[index],
            ),
          })),
          centeredAssignmentFeasible,
        };
      });
    snapshots.push({
      firstRejectedPhase: phase === "accepted" ? null : phase,
      firstRejectedReason:
        phase === "accepted" ? null : structuredReason(phase, reason, ranks),
      ranks,
      states: {
        transition: transitionLaneSolverStats.statesVisited,
        handle: handleBudget.statesVisited,
      },
    });
  };
  try {
    layoutLifecycleRoutingGraph(projection, availableWidth, {
      ...options,
      testOnlyBaseNodeOrderByRank: orderByRank,
      testOnlyDiagnosticSink: (snapshot) => {
        if (!snapshots.length) {
          summarize(snapshot);
          throw diagnosticComplete;
        }
      },
    });
  } catch (error) {
    if (!snapshots.length) {
      const cause = error.cause;
      const firstRejectedPhase = (() => {
        if (typeof cause?.phase === "string") return cause.phase;
        if (cause?.type === "lifecycle-handle-placement") {
          return cause.reason === "route-crossing"
            ? "route-crossing"
            : "handle";
        }
        if (cause?.type === "lifecycle-routing-anchor-allocation") {
          return "routing-anchor";
        }
        if (cause?.reason === "state-limit") return "transition";
        return "throw";
      })();
      snapshots.push({
        firstRejectedPhase,
        firstRejectedReason: structuredReason(firstRejectedPhase, cause) ?? {
          reason: error.message,
          firstAffectedRank: null,
          evidence: {},
        },
        ranks: [],
        states: {
          transition:
            firstRejectedPhase === "handle"
              ? null
              : (error.cause?.statesVisited ?? null),
          handle:
            firstRejectedPhase === "handle"
              ? (error.cause?.statesVisited ?? null)
              : null,
        },
      });
    }
    if (error === diagnosticComplete) return snapshots[0];
  }
  return snapshots[0];
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
  const p1 = { x: exitX + TRANSITION_CONTROL_OFFSET, y: laneY };
  const p2 = { x: entryX - TRANSITION_CONTROL_OFFSET, y: laneY };
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

const deepFreezePlain = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreezePlain(child);
  return Object.freeze(value);
};

export const solveHandleCandidateSets = (
  branches,
  candidateSets,
  { maxStates = 32768, sharedBudget = null } = {},
) => {
  const orderedBranches = [...branches].sort(compareBranches);
  const branchById = new Map(
    orderedBranches.map((branch) => [branch.id, branch]),
  );
  const candidateConflicts = new Map(
    orderedBranches.map((branch) => [branch.id, new Set()]),
  );
  for (let leftIndex = 0; leftIndex < orderedBranches.length; leftIndex += 1) {
    const left = orderedBranches[leftIndex];
    const leftCandidates = candidateSets.get(left.id) ?? [];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < orderedBranches.length;
      rightIndex += 1
    ) {
      const right = orderedBranches[rightIndex];
      const rightCandidates = candidateSets.get(right.id) ?? [];
      if (
        leftCandidates.some((leftCandidate) =>
          rightCandidates.some((rightCandidate) =>
            boxesOverlap(leftCandidate.box, rightCandidate.box),
          ),
        )
      ) {
        candidateConflicts.get(left.id).add(right.id);
        candidateConflicts.get(right.id).add(left.id);
      }
    }
  }
  const conflictingBranchPairs = [...candidateConflicts.entries()]
    .flatMap(([left, rights]) =>
      [...rights]
        .filter((right) => compareLifecycleIds(left, right) < 0)
        .map((right) => [left, right]),
    )
    .sort(
      (a, b) =>
        compareLifecycleIds(a[0], b[0]) || compareLifecycleIds(a[1], b[1]),
    );
  const components = [];
  const seen = new Set();
  for (const branch of orderedBranches) {
    if (seen.has(branch.id)) continue;
    const stack = [branch.id];
    const component = [];
    seen.add(branch.id);
    while (stack.length) {
      const id = stack.pop();
      const branch = branchById.get(id);
      if (branch) component.push(branch);
      for (const next of candidateConflicts.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component.sort(compareBranches));
  }
  const selected = new Map();
  const budget = sharedBudget ?? { statesVisited: 0, stateLimit: maxStates };
  const componentSummary = (component) => ({
    branchIds: component.map((branch) => branch.id).sort(compareLifecycleIds),
    candidateCounts: Object.fromEntries(
      component
        .map((branch) => [branch.id, candidateSets.get(branch.id)?.length ?? 0])
        .sort(([a], [b]) => compareLifecycleIds(a, b)),
    ),
    conflictingBranchPairs: conflictingBranchPairs.filter(([left, right]) =>
      component.some((branch) => branch.id === left || branch.id === right),
    ),
    visitedStates: budget.statesVisited,
    stateLimit: budget.stateLimit,
  });
  const solveComponent = (component) => {
    const assignments = new Map();
    const failedStates = new Set();
    const legalCandidatesFor = (branch) =>
      (candidateSets.get(branch.id) ?? []).filter((candidate) =>
        [...assignments.values()].every(
          (handle) => !boxesOverlap(candidate.box, handle.box),
        ),
      );
    const stateSignature = () =>
      [...assignments.entries()]
        .sort(([a], [b]) => compareLifecycleIds(a, b))
        .map(([id, handle]) => `${id}:${handle.x}:${handle.y}`)
        .join("|");
    const selectBranch = () => {
      let chosen = null;
      let chosenCandidates = null;
      for (const branch of component) {
        if (assignments.has(branch.id)) continue;
        const candidates = legalCandidatesFor(branch);
        if (
          !chosen ||
          candidates.length < chosenCandidates.length ||
          (candidates.length === chosenCandidates.length &&
            compareBranches(branch, chosen) < 0)
        ) {
          chosen = branch;
          chosenCandidates = candidates;
        }
      }
      return chosen ? { branch: chosen, candidates: chosenCandidates } : null;
    };
    const backtrack = () => {
      if (assignments.size === component.length) return true;
      const signature = stateSignature();
      if (failedStates.has(signature)) return false;
      const next = selectBranch();
      if (!next) return assignments.size === component.length;
      if (next.candidates.length === 0) {
        failedStates.add(signature);
        return false;
      }
      for (const candidate of next.candidates) {
        if (budget.statesVisited >= budget.stateLimit) return "state-limit";
        budget.statesVisited += 1;
        assignments.set(next.branch.id, candidate);
        let forwardOk = true;
        for (const branch of component) {
          if (
            !assignments.has(branch.id) &&
            legalCandidatesFor(branch).length === 0
          ) {
            forwardOk = false;
            break;
          }
        }
        const result = forwardOk ? backtrack() : false;
        if (result === true) return true;
        assignments.delete(next.branch.id);
        if (result === "state-limit") return result;
      }
      failedStates.add(signature);
      return false;
    };
    const solved = backtrack();
    return solved === true ? assignments : solved;
  };
  for (const component of components.sort((a, b) =>
    compareBranches(a[0], b[0]),
  )) {
    const solved = solveComponent(component);
    if (solved === "state-limit")
      return {
        ok: false,
        reason: "state-limit",
        selected,
        component: componentSummary(component),
      };
    if (!solved)
      return {
        ok: false,
        reason: "handle-overlap",
        selected,
        component: componentSummary(component),
      };
    for (const [branchId, handle] of solved) selected.set(branchId, handle);
  }
  return { ok: true, selected };
};

const handlePlacementError = (result) => {
  const branchId = result.blockedBranchIds?.[0] ?? "unknown branch";
  const error = new Error(
    `Lifecycle diagram handle placement invariant violated for ${branchId}`,
  );
  error.cause = deepFreezePlain({
    type: "lifecycle-handle-placement",
    reason: result.reason,
    blockedBranchIds: [...(result.blockedBranchIds ?? [])].sort(
      compareLifecycleIds,
    ),
    branches: [...(result.branchDiagnostics ?? [])],
    component: result.component ?? null,
  });
  return error;
};

const tryAssignBranchHandles = (
  branches,
  segmentsByBranch,
  visibleNodes = [],
  { sharedBudget = null } = {},
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
  const fixedGeometry = [
    ...nodeBoxes.map((box, index) => ({
      ...box,
      kind: "node",
      id: visibleNodes[index]?.id,
    })),
    ...labelBoxes.map((box, index) => ({
      ...box,
      kind: "label",
      id: visibleNodes[index]?.id,
    })),
    ...hitBoxes.map((box, index) => ({
      ...box,
      kind: "hit-region",
      id: visibleNodes[index]?.id,
    })),
  ];
  const fixedGeometryBlockerForCandidate = (box) =>
    fixedGeometry
      .filter((candidate) => boxesOverlap(box, candidate))
      .sort(
        (a, b) =>
          compareLifecycleIds(a.kind, b.kind) ||
          compareLifecycleIds(a.id ?? "", b.id ?? ""),
      )[0] ?? null;
  const renderedBranchClearance = (branch, x, y) => {
    let best = { margin: Number.POSITIVE_INFINITY, blocker: null };
    for (const edge of routeEdges) {
      if (edge.branchId === branch.id) continue;
      const required =
        BRANCH_HANDLE_RADIUS + edge.envelopeRadius + 0.25 + LANE_Y_EPSILON;
      const distance = pointToSegmentDistance({ x, y }, edge);
      const margin = distance - required;
      if (
        margin < best.margin - LANE_Y_EPSILON ||
        (Math.abs(margin - best.margin) <= LANE_Y_EPSILON &&
          compareLifecycleIds(edge.branchId, best.blocker?.branchId ?? "") < 0)
      ) {
        best = {
          margin,
          blocker: {
            kind: "route",
            id: edge.segmentId,
            branchId: edge.branchId,
            segmentId: edge.segmentId,
            transitionRank: edge.transitionRank,
            zone: edge.zone,
          },
        };
      }
    }
    return best;
  };
  const quantizedCandidate = (value) => Number(value.toFixed(3));
  const orderedBranches = [...branches].sort(compareBranches);
  // Candidate generation below is genuinely O(branches * routeEdges):
  // renderedBranchClearance scans every flattened route edge for every
  // (branch, t-sample) candidate point examined. That real cost was never
  // charged against sharedBudget at all before this fix — only the later
  // per-candidate backtracking in solveHandleCandidateSets was — so a
  // caller that keeps invoking this function against geometry that always
  // yields zero or conflicting candidates could repeat this expensive
  // generation an unbounded number of times for free (this is what the
  // wall-clock deadline this fix removes used to paper over). An ordinary
  // fixture legitimately needs on the order of a hundred-plus full
  // generation passes before refineGlobalLaneCoordinates finds a working
  // coordinate assignment (measured directly: 161 passes for one small,
  // 8-routeEdge-order fixture) — nowhere near "a handful" — so charging
  // routeEdgeCount linearly (~520 for that fixture) exhausts the whole
  // budget in ~63 tries, well short of the ~161 actually needed, and
  // regresses a previously-passing test. Charging its *square* instead
  // keeps small fixtures cheap enough for hundreds of tries while still
  // making a dense fixture's much larger routeEdges (thousands) dominate
  // the budget after only a handful of passes — i.e. the charge grows
  // faster than the fixture's real per-pass cost does, which is what
  // deterministically bounds worst-case wall-clock time for a dense,
  // infeasible fixture without starving an ordinary one that just needs
  // many cheap tries.
  const routeEdgeCount = routeEdges.length;
  const generationCost = Math.max(
    1,
    Math.round((routeEdgeCount * routeEdgeCount) / 8450),
  );
  if (sharedBudget) {
    if (sharedBudget.statesVisited >= sharedBudget.stateLimit) {
      return {
        ok: false,
        reason: "state-limit",
        blockedBranchIds: [],
        branchDiagnostics: [],
        candidateSets: new Map(),
        routeEdgeCount,
      };
    }
    sharedBudget.statesVisited += generationCost;
  }
  const candidateSets = new Map();
  const branchDiagnostics = new Map();
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
    const diagnostic = {
      branchId: branch.id,
      segmentsExamined: orderedSegments.length,
      attempts: 0,
      accepted: 0,
      rejected: {
        fixedGeometry: 0,
        outsideTransitionCorridor: 0,
        nonincidentRouteClearance: 0,
      },
      nearestRejectedCandidate: null,
    };
    const rememberRejected = (candidate) => {
      if (
        !diagnostic.nearestRejectedCandidate ||
        candidate.clearanceMargin >
          diagnostic.nearestRejectedCandidate.clearanceMargin ||
        (candidate.clearanceMargin ===
          diagnostic.nearestRejectedCandidate.clearanceMargin &&
          (compareLifecycleIds(
            candidate.segmentId,
            diagnostic.nearestRejectedCandidate.segmentId,
          ) < 0 ||
            (candidate.segmentId ===
              diagnostic.nearestRejectedCandidate.segmentId &&
              (candidate.t < diagnostic.nearestRejectedCandidate.t ||
                (candidate.t === diagnostic.nearestRejectedCandidate.t &&
                  compareLifecycleIds(
                    candidate.blocker?.id ?? "",
                    diagnostic.nearestRejectedCandidate.blocker?.id ?? "",
                  ) < 0)))))
      ) {
        diagnostic.nearestRejectedCandidate = candidate;
      }
    };
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
        diagnostic.attempts += 1;
        const baseRejected = {
          segmentId: segmentKey(segment),
          segmentIndex: segment.segmentIndex,
          transitionRank: segment.source?.rank,
          t,
          x: quantizedCandidate(x),
          y: quantizedCandidate(y),
        };
        const fixedBlocker = fixedGeometryBlockerForCandidate(box);
        if (fixedBlocker) {
          diagnostic.rejected.fixedGeometry += 1;
          rememberRejected({
            ...baseRejected,
            clearanceMargin: COLLISION_MARGIN,
            blocker: {
              kind: fixedBlocker.kind,
              id: fixedBlocker.id,
              branchId: null,
              segmentId: null,
              transitionRank: null,
              zone: null,
            },
          });
          continue;
        }
        if (
          x - BRANCH_HANDLE_RADIUS < exitX ||
          x + BRANCH_HANDLE_RADIUS > entryX
        ) {
          diagnostic.rejected.outsideTransitionCorridor += 1;
          rememberRejected({
            ...baseRejected,
            clearanceMargin: COLLISION_MARGIN,
            blocker: {
              kind: "corridor-bounds",
              id: `${segment.source?.rank}->${segment.target?.rank}`,
              branchId: null,
              segmentId: null,
              transitionRank: segment.source?.rank,
              zone: "transition-corridor",
            },
          });
          continue;
        }
        const clearance = renderedBranchClearance(branch, x, y);
        const clearanceMargin = clearance.margin;
        if (clearanceMargin > 0) {
          diagnostic.accepted += 1;
          candidates.push({
            branchId: branch.id,
            x,
            y,
            radius: BRANCH_HANDLE_RADIUS,
            box,
            clearanceMargin,
          });
        } else {
          diagnostic.rejected.nonincidentRouteClearance += 1;
          rememberRejected({
            ...baseRejected,
            clearanceMargin: quantizedCandidate(clearanceMargin),
            blocker: clearance.blocker,
          });
        }
      }
    }
    candidateSets.set(
      branch.id,
      candidates.sort(
        (a, b) =>
          b.clearanceMargin - a.clearanceMargin || a.y - b.y || a.x - b.x,
      ),
    );
    branchDiagnostics.set(branch.id, diagnostic);
  }
  const blockedBranchIds = orderedBranches
    .filter((branch) => !(candidateSets.get(branch.id)?.length > 0))
    .map((branch) => branch.id);
  if (blockedBranchIds.length)
    return {
      ok: false,
      reason: "no-candidates",
      blockedBranchIds,
      branchDiagnostics: blockedBranchIds.map((id) =>
        branchDiagnostics.get(id),
      ),
      candidateSets,
      routeEdgeCount,
    };
  const handleAssignment = solveHandleCandidateSets(
    orderedBranches,
    candidateSets,
    { sharedBudget },
  );
  if (!handleAssignment.ok)
    return {
      ok: false,
      reason: handleAssignment.reason,
      blockedBranchIds: orderedBranches
        .filter((branch) => !handleAssignment.selected.has(branch.id))
        .map((branch) => branch.id),
      branchDiagnostics: orderedBranches.map((branch) =>
        branchDiagnostics.get(branch.id),
      ),
      candidateSets,
      component: handleAssignment.component,
      routeEdgeCount,
    };
  return {
    ok: true,
    handles: orderedBranches.map((branch) =>
      handleAssignment.selected.get(branch.id),
    ),
    candidateSets,
    routeEdgeCount,
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
  throw handlePlacementError(result);
}
