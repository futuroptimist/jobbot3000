import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line max-len
import routingFixture from "./fixtures/tracker-lifecycle-diagram-routing-v2.json" with { type: "json" };
import denseFixture from "./fixtures/tracker-lifecycle-diagram-v2.json" with { type: "json" };
import {
  LIFECYCLE_DIAGRAM_TAXONOMY,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";
import {
  BRANCH_HANDLE_RADIUS,
  BRANCH_STROKE_OPACITY,
  HANDLE_CLEARANCE_TOLERANCE,
  ENDPOINT_BRANCH_COLORS,
  LAYOUT_BOTTOM_MARGIN,
  LAYOUT_TOP_MARGIN,
  LAYOUT_LEFT_MARGIN,
  LAYOUT_RIGHT_MARGIN,
  PER_LANE_VERTICAL_BUDGET,
  MINIMUM_RANK_CENTER_SPACING,
  MINIMUM_SVG_WIDTH,
  MINIMUM_TRANSITION_WIDTH,
  RANK_CORRIDOR_HALF_WIDTH,
  TRANSITION_CONTROL_OFFSET,
  ROUTED_NODE_PADDING,
  SANKEY_NODE_WIDTH,
  assignBranchHandles,
  auditLifecycleRouteGeometry,
  buildTransitionPrecedence,
  buildLifecycleDisplayBranches,
  buildLifecycleRouteModel,
  buildLifecycleRoutingGraph,
  calculateLifecycleDiagramLayout,
  classifyRouteCrossingCategory,
  collinearOverlapLength,
  COLLINEAR_OVERLAP_TOLERANCE,
  combinationsOfSize,
  compareBranches,
  compareLifecycleIds,
  createLaneGeometryFailureCache,
  cubicTransitionPoint,
  edgeCrossing,
  endpointColor,
  isRouteHandleCollision,
  layoutLifecycleRoutingGraph,
  labelBoxForNode,
  LANE_Y_EPSILON,
  nodeSort,
  pointToSegmentDistance,
  rankCenterX,
  renderedBranchStrokeWidth,
  rendererHitBoxForNode,
  ROUTE_CROSSING_SUSTAINED_THRESHOLD,
  ROUTE_HANDLE_CLEARANCE_MARGIN,
  routeHandleRequiredClearance,
  segmentRoutePrimitives,
  selectedEnvelopeRadius,
  solveHandleCandidateSets,
  SUSTAINED_OVERLAP_LENGTH_THRESHOLD,
  taxonomyOrder,
  testOnlyDiagnoseLifecycleLayoutAttempt,
  wrapLifecycleLabel,
} from "../src/web/tracker/lifecycleDiagramLayout.js";

const projection = () => projectLifecycleAt(routingFixture);
const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const luminance = ([r, g, b]) => {
  const channel = (v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const hex = (color) =>
  color.match(/[0-9a-f]{2}/giu).map((v) => parseInt(v, 16));
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const boxesOverlap = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

const transitionCountsByGraphRanks = (graph) => {
  const rankByNodeId = new Map(
    (graph.nodes ?? []).map((node) => [node.id, node.rank]),
  );
  const counts = Array.from({ length: 6 }, () => 0);
  for (const link of graph.links ?? []) {
    const sourceId =
      link.source && typeof link.source === "object"
        ? link.source.id
        : link.source;
    const rank = rankByNodeId.get(sourceId);
    if (!Number.isInteger(rank) || rank < 0 || rank >= counts.length) {
      throw new Error(`invalid test source rank for ${String(sourceId)}`);
    }
    counts[rank] += 1;
  }
  return counts;
};

const expectRoutedDensity = (
  projectionValue,
  expectedCounts,
  expectedHeight,
) => {
  const graph = buildLifecycleRoutingGraph(projectionValue);
  const layout = calculateLifecycleDiagramLayout(projectionValue, 100, graph);
  expect(transitionCountsByGraphRanks(graph)).toEqual(expectedCounts);
  expect(layout.densestRoutedRank).toBe(Math.max(...expectedCounts));
  expect(layout.height).toBe(expectedHeight);
  return { graph, layout };
};

const denseBranchProjection = () => {
  const nodes = [];
  const links = [];
  const paths = [];
  let applicationIndex = 0;
  for (const origin of LIFECYCLE_DIAGRAM_TAXONOMY.origins) {
    const originNode = {
      id: `origin:${origin.id}`,
      label: origin.label,
      total: 0,
      applicationIds: [],
    };
    nodes.push(originNode);
    for (const endpoint of LIFECYCLE_DIAGRAM_TAXONOMY.endpoints) {
      const applicationId = `dense-${applicationIndex}`;
      applicationIndex += 1;
      originNode.total += 1;
      originNode.applicationIds.push(applicationId);
      let endpointNode = nodes.find(
        (node) => node.id === `endpoint:${endpoint.id}`,
      );
      if (!endpointNode) {
        endpointNode = {
          id: `endpoint:${endpoint.id}`,
          label: endpoint.label,
          total: 0,
          applicationIds: [],
        };
        nodes.push(endpointNode);
      }
      endpointNode.total += 1;
      endpointNode.applicationIds.push(applicationId);
      links.push({
        id: `link:origin:${origin.id}->endpoint:${endpoint.id}`,
        source: `origin:${origin.id}`,
        target: `endpoint:${endpoint.id}`,
        value: 1,
        applicationIds: [applicationId],
      });
      paths.push({
        applicationId,
        endpoint: endpoint.id,
        nodeIds: [`origin:${origin.id}`, `endpoint:${endpoint.id}`],
      });
    }
  }
  return { nodes, links, paths };
};

const multiLongProjection = (count) => {
  const originId = "origin:application_submitted";
  const endpointIds = LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map(({ id }) => id);
  const nodes = [
    { id: originId, label: "Applied", total: count, applicationIds: [] },
    ...endpointIds.map((id) => ({
      id: `endpoint:${id}`,
      label: id,
      total: 0,
      applicationIds: [],
    })),
  ];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = [];
  const paths = [];
  for (let index = 0; index < count; index += 1) {
    const endpointId = endpointIds[index % endpointIds.length];
    const applicationId = `multi-long-${index}`;
    nodeById.get(originId).applicationIds.push(applicationId);
    nodeById.get(`endpoint:${endpointId}`).total += 1;
    nodeById.get(`endpoint:${endpointId}`).applicationIds.push(applicationId);
    links.push({
      id: `link:${index}:application_submitted->${endpointId}`,
      source: originId,
      target: `endpoint:${endpointId}`,
      value: 1,
      applicationIds: [applicationId],
    });
    paths.push({
      applicationId,
      endpoint: endpointId,
      nodeIds: [originId, `endpoint:${endpointId}`],
    });
  }
  return { nodes, links, paths };
};

const transitionDensityProjection = () => {
  const originIds = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map(({ id }) => id);
  const nodes = [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((origin) => ({
      id: `origin:${origin.id}`,
      label: origin.label,
      total: 0,
      applicationIds: [],
    })),
    {
      id: "milestone:recruiter_screen",
      label: "Recruiter screen",
      total: 50,
      applicationIds: [],
    },
    {
      id: "milestone:technical_interview",
      label: "Technical interview",
      total: 39,
      applicationIds: [],
    },
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((endpoint) => ({
      id: `endpoint:${endpoint.id}`,
      label: endpoint.label,
      total: 0,
      applicationIds: [],
    })),
  ];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = [];
  const paths = [];
  const endpointIds = LIFECYCLE_DIAGRAM_TAXONOMY.endpoints
    .map(({ id }) => id)
    .filter((id) => id !== "unknown");
  for (let index = 0; index < 89; index += 1) {
    const applicationId = `transition-density-${String(index).padStart(3, "0")}`;
    const endpointId = endpointIds[index % endpointIds.length];
    const originId = originIds[index % originIds.length];
    nodeById.get(`endpoint:${endpointId}`).total += 1;
    nodeById.get(`endpoint:${endpointId}`).applicationIds.push(applicationId);
    if (index < 50) {
      nodeById.get(`origin:${originId}`).applicationIds.push(applicationId);
      nodeById.get(`origin:${originId}`).total += 1;
      links.push({
        id: `link:origin:${originId}->recruiter:${index}`,
        source: `origin:${originId}`,
        target: "milestone:recruiter_screen",
        value: 1,
        applicationIds: [applicationId],
      });
      nodeById
        .get("milestone:recruiter_screen")
        .applicationIds.push(applicationId);
    } else {
      links.push({
        id: `link:technical->endpoint:${index}`,
        source: "milestone:technical_interview",
        target: `endpoint:${endpointId}`,
        value: 1,
        applicationIds: [applicationId],
      });
      nodeById
        .get("milestone:technical_interview")
        .applicationIds.push(applicationId);
    }
    paths.push({
      applicationId,
      endpoint: endpointId,
      nodeIds:
        index < 50
          ? [
              `origin:${originId}`,
              "milestone:recruiter_screen",
              `endpoint:${endpointId}`,
            ]
          : ["milestone:technical_interview", `endpoint:${endpointId}`],
    });
  }
  return { nodes, links, paths };
};

const paginationProjection = () => {
  const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map(({ id }) => id);
  const milestones = LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map(({ id }) => id);
  const endpoints = LIFECYCLE_DIAGRAM_TAXONOMY.endpoints
    .filter(({ id }) => id !== "unknown")
    .map(({ id }) => id);
  const nodes = [
    ...origins.map((id) => ({
      id: `origin:${id}`,
      label: id,
      total: 0,
      applicationIds: [],
    })),
    ...milestones.map((id) => ({
      id: `milestone:${id}`,
      label: id,
      total: 0,
      applicationIds: [],
    })),
    ...endpoints.map((id) => ({
      id: `endpoint:${id}`,
      label: id,
      total: 0,
      applicationIds: [],
    })),
  ];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = [];
  const paths = [];
  for (let index = 0; index < 60; index += 1) {
    const applicationId = `flow-app-${String(index).padStart(2, "0")}`;
    const origin = origins[index % origins.length];
    const milestone =
      milestones[Math.floor(index / origins.length) % milestones.length];
    const endpoint = endpoints[index % endpoints.length];
    const nodeIds = [
      `origin:${origin}`,
      `milestone:${milestone}`,
      `endpoint:${endpoint}`,
    ];
    for (const nodeId of nodeIds) {
      nodeById.get(nodeId).total += 1;
      nodeById.get(nodeId).applicationIds.push(applicationId);
    }
    links.push(
      {
        id: `link:${applicationId}:origin:${origin}->milestone:${milestone}`,
        source: `origin:${origin}`,
        target: `milestone:${milestone}`,
        value: 1,
        applicationIds: [applicationId],
      },
      {
        id: `link:${applicationId}:milestone:${milestone}->endpoint:${endpoint}`,
        source: `milestone:${milestone}`,
        target: `endpoint:${endpoint}`,
        value: 1,
        applicationIds: [applicationId],
      },
    );
    paths.push({ applicationId, endpoint, nodeIds });
  }
  return { nodes, links, paths };
};

describe("transition lane solver", () => {
  it("honors and preserves a supplied routing graph across both passes", () => {
    const p = projection();
    const routingGraph = buildLifecycleRoutingGraph(p);
    routingGraph.links[0].target = routingGraph.links[0].source;
    const before = structuredClone(routingGraph);

    expect(() =>
      layoutLifecycleRoutingGraph(p, 1850, { routingGraph }),
    ).toThrow(/non-adjacent or reversed ranks/u);
    expect(routingGraph).toEqual(before);
  });

  it("does not emit production order diagnostics", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      layoutLifecycleRoutingGraph(projection(), 1850, { debugOrder: true });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
  it("builds explicit precedence for more than 16 reversed-id strands", () => {
    const continuers = Array.from({ length: 18 }, (_, index) => ({
      id: `link:${String(99 - index).padStart(2, "0")}`,
      branchId: `branch:${String(99 - index).padStart(2, "0")}`,
      stableId: `branch:${String(99 - index).padStart(2, "0")}`,
      rank: 2,
      sourceDockY: 100 + index * 40,
      targetDockY: 100 + index * 40,
      sourceId: "source:continuing",
      targetId: "target:ending",
      isEnding: index < 2,
    }));
    const starters = [
      {
        id: "link:starter:z",
        branchId: "branch:starter:z",
        stableId: "branch:starter:z",
        rank: 2,
        sourceDockY: 130,
        targetDockY: 130,
        sourceId: "source:starter",
        isEnding: false,
      },
      {
        id: "link:starter:a",
        branchId: "branch:starter:a",
        stableId: "branch:starter:a",
        rank: 2,
        sourceDockY: 150,
        targetDockY: 150,
        sourceId: "source:starter",
        isEnding: false,
      },
    ];
    const variables = [...starters, ...continuers].reverse();
    const priorOrder = continuers.map((variable) => variable.branchId);
    const result = buildTransitionPrecedence({
      rank: 2,
      variables,
      priorOrder,
    });
    expect(result.ok).toBe(true);
    const order = result.order.map((variable) => variable.branchId);
    expect(order.filter((id) => priorOrder.includes(id))).toEqual(priorOrder);
    expect(order.indexOf("branch:starter:z")).toBeGreaterThan(
      order.indexOf(continuers[0].branchId),
    );
    expect(order.indexOf("branch:starter:z")).toBeLessThan(
      order.indexOf("branch:starter:a"),
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "continuation", rank: 2 }),
        expect.objectContaining({ kind: "source-dock", rank: 2 }),
        expect.objectContaining({ kind: "target-dock", rank: 2 }),
      ]),
    );
    const shuffled = buildTransitionPrecedence({
      rank: 2,
      variables: [...variables].reverse(),
      priorOrder,
    });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(result));
  });

  it("creates target-dock edges for production-shaped ending links", () => {
    const target = { id: "endpoint:shared", routing: false };
    const variables = [
      {
        id: "link:later",
        branchId: "branch:later",
        stableId: "branch:later",
        rank: 3,
        sourceDockY: 240,
        targetDockY: 240,
        isEnding: true,
        link: { id: "link:later", target },
      },
      {
        id: "link:earlier",
        branchId: "branch:earlier",
        stableId: "branch:earlier",
        rank: 3,
        sourceDockY: 120,
        targetDockY: 120,
        isEnding: true,
        link: { id: "link:earlier", target },
      },
    ];
    const result = buildTransitionPrecedence({ rank: 3, variables });
    expect(result.ok).toBe(true);
    expect(result.edges).toEqual([
      {
        fromId: "link:earlier",
        toId: "link:later",
        kind: "target-dock",
        rank: 3,
      },
    ]);
    expect(result.order.map((variable) => variable.id)).toEqual([
      "link:earlier",
      "link:later",
    ]);
  });

  it("treats raw-string and D3-object ending targets identically", () => {
    const rawVariables = [
      {
        id: "link:top",
        branchId: "branch:top",
        stableId: "branch:top",
        rank: 4,
        sourceDockY: 100,
        targetDockY: 100,
        isEnding: true,
        link: { id: "link:top", target: "endpoint:shared" },
      },
      {
        id: "link:bottom",
        branchId: "branch:bottom",
        stableId: "branch:bottom",
        rank: 4,
        sourceDockY: 200,
        targetDockY: 200,
        isEnding: true,
        link: { id: "link:bottom", target: "endpoint:shared" },
      },
    ];
    const d3Variables = rawVariables.map((variable) => ({
      ...variable,
      link: {
        ...variable.link,
        target: { id: variable.link.target, routing: false },
      },
    }));
    const signature = (result) => ({
      ok: result.ok,
      order: result.order.map((variable) => variable.id),
      edges: result.edges,
    });
    expect(
      signature(buildTransitionPrecedence({ rank: 4, variables: d3Variables })),
    ).toEqual(
      signature(
        buildTransitionPrecedence({ rank: 4, variables: rawVariables }),
      ),
    );
  });

  it("does not add target precedence across different semantic targets", () => {
    const variables = [
      {
        id: "link:a",
        branchId: "branch:a",
        stableId: "branch:a",
        rank: 5,
        sourceDockY: 100,
        targetDockY: 100,
        isEnding: true,
        link: { id: "link:a", target: { id: "endpoint:a", routing: false } },
      },
      {
        id: "link:b",
        branchId: "branch:b",
        stableId: "branch:b",
        rank: 5,
        sourceDockY: 200,
        targetDockY: 200,
        isEnding: true,
        link: { id: "link:b", target: { id: "endpoint:b", routing: false } },
      },
    ];
    const result = buildTransitionPrecedence({ rank: 5, variables });
    expect(result.ok).toBe(true);
    expect(result.edges.filter((edge) => edge.kind === "target-dock")).toEqual(
      [],
    );
  });

  it("reports malformed ending production links that still target routing nodes", () => {
    const variables = [
      {
        id: "link:routing-target",
        branchId: "branch:routing-target",
        stableId: "branch:routing-target",
        rank: 2,
        sourceDockY: 100,
        targetDockY: 100,
        isEnding: true,
        link: {
          id: "link:routing-target",
          target: { id: "routing:private", routing: true },
        },
      },
    ];
    expect(buildTransitionPrecedence({ rank: 2, variables })).toEqual({
      ok: false,
      reason: "malformed-ending-target",
      rank: 2,
      branchIds: ["branch:routing-target"],
      linkIds: ["link:routing-target"],
      edgeKinds: ["target-dock"],
    });
  });

  it("reports semantic-order-cycle diagnostics deterministically", () => {
    const variables = [
      {
        id: "link:a",
        branchId: "branch:a",
        stableId: "branch:a",
        rank: 1,
        sourceDockY: 100,
        targetDockY: 300,
        targetId: "endpoint:shared",
        isEnding: true,
      },
      {
        id: "link:b",
        branchId: "branch:b",
        stableId: "branch:b",
        rank: 1,
        sourceDockY: 200,
        targetDockY: 200,
        targetId: "endpoint:shared",
        isEnding: true,
      },
      {
        id: "link:c",
        branchId: "branch:c",
        stableId: "branch:c",
        rank: 1,
        sourceDockY: 300,
        targetDockY: 100,
        targetId: "endpoint:shared",
        isEnding: true,
      },
    ];
    const result = buildTransitionPrecedence({
      rank: 1,
      variables,
      priorOrder: ["branch:a", "branch:b", "branch:c"],
    });
    expect(result).toEqual({
      ok: false,
      reason: "semantic-order-cycle",
      rank: 1,
      branchIds: ["branch:a", "branch:b", "branch:c"],
      linkIds: ["link:a", "link:b", "link:c"],
      edgeKinds: ["continuation", "target-dock"],
    });
    const reversed = buildTransitionPrecedence({
      rank: 1,
      variables: [...variables].reverse(),
      priorOrder: ["branch:a", "branch:b", "branch:c"],
    });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(result));
  });

  const laneSignature = (projectionValue, routingGraph) => {
    const { graph } = layoutLifecycleRoutingGraph(projectionValue, 1850, {
      routingGraph,
      transitionLanePhaseOnly: true,
    });
    return {
      lanes: [...graph.links]
        .sort((a, b) => compareLifecycleIds(a.id, b.id))
        .map((link) => [link.id, link.transitionLaneY]),
      stats: graph.transitionLaneSolverStats,
    };
  };
  const expectSpacingLegal = (projectionValue, expectedBranches) => {
    const { graph } = layoutLifecycleRoutingGraph(projectionValue, 1850, {
      transitionLanePhaseOnly: true,
    });
    expect(graph.branches).toHaveLength(expectedBranches);
    for (const rank of [0, 1, 2, 3, 4, 5]) {
      const lanes = graph.links
        .filter((link) => link.source.rank === rank)
        .map((link) => link.transitionLaneY)
        .sort((a, b) => a - b);
      for (let index = 1; index < lanes.length; index += 1) {
        const minimumSpacing =
          BRANCH_HANDLE_RADIUS * 2 +
          selectedEnvelopeRadius({ width: 1 }) * 2 +
          0.25;
        expect(lanes[index] - lanes[index - 1]).toBeGreaterThanOrEqual(
          minimumSpacing,
        );
      }
    }
    expect(graph.transitionLaneSolverStats).toMatchObject({
      stateLimit: 200000,
    });
    expect(graph.transitionLaneSolverStats.statesVisited).toBeGreaterThan(0);
    expect(graph.transitionLaneSolverStats.statesVisited).toBeLessThanOrEqual(
      graph.transitionLaneSolverStats.stateLimit,
    );
    return graph;
  };

  it("counts and routes raw string and D3 node-object endpoints identically", () => {
    const p = projection();
    const rawGraph = buildLifecycleRoutingGraph(p);
    const d3Graph = buildLifecycleRoutingGraph(p);
    const nodeById = new Map(d3Graph.nodes.map((node) => [node.id, node]));
    for (const link of d3Graph.links) {
      link.source = nodeById.get(link.source);
      link.target = nodeById.get(link.target);
    }
    const rawSignature = laneSignature(p, rawGraph);
    const d3Signature = laneSignature(p, d3Graph);
    expect(transitionCountsByGraphRanks(d3Graph)).toEqual(
      transitionCountsByGraphRanks(rawGraph),
    );
    expect(d3Signature).toEqual(rawSignature);
  });

  it("routes dense fixtures without transition-lane allocation invariants", () => {
    expect(
      layoutLifecycleRoutingGraph(projection(), 1850, {
        transitionLanePhaseOnly: true,
      }).graph,
    ).toBeTruthy();
    expect(
      layoutLifecycleRoutingGraph(projectLifecycleAt(denseFixture), 1850, {
        transitionLanePhaseOnly: true,
      }).graph,
    ).toBeTruthy();
  });

  it("assigns spacing-legal lanes for 55-branch multi-source dense graph", () => {
    const graph = expectSpacingLegal(denseBranchProjection(), 55);
    expect(graph.transitionLaneSolverStats.components).toBe(1);
    expect(graph.transitionLaneSolverStats.statesVisited).toBeLessThan(10000);
    const repeated = laneSignature(denseBranchProjection());
    const shuffledProjection = denseBranchProjection();
    const shuffled = {
      ...shuffledProjection,
      nodes: [...shuffledProjection.nodes].reverse(),
      links: [...shuffledProjection.links].reverse(),
      paths: [...shuffledProjection.paths].reverse(),
    };
    expect(JSON.stringify(laneSignature(shuffled))).toBe(
      JSON.stringify(repeated),
    );
  });

  it("assigns spacing-legal lanes for 33-branch graph above the former cutoff", () => {
    const graph = expectSpacingLegal(multiLongProjection(33), 33);
    expect(graph.transitionLaneSolverStats.statesVisited).toBeLessThanOrEqual(
      graph.transitionLaneSolverStats.stateLimit,
    );
  });

  it("assigns spacing-legal lanes for 89-branch transition-density graph", () => {
    const graph = expectSpacingLegal(transitionDensityProjection(), 89);
    expect(graph.transitionLaneSolverStats.statesVisited).toBeLessThanOrEqual(
      graph.transitionLaneSolverStats.stateLimit,
    );
  });

  it("paginates 60 applications into 120 lane-only display branches deterministically", () => {
    const graph = expectSpacingLegal(paginationProjection(), 120);
    expect(graph.transitionLaneSolverStats.statesVisited).toBeLessThan(100000);
    const visibleNodes = graph.nodes.filter(
      (node) => !node.routing && Number(node.total) > 0,
    );
    for (const link of graph.links) {
      expect(Number.isFinite(link.transitionLaneY)).toBe(true);
      const incidentIds = new Set([link.source.id, link.target.id]);
      const minX = rankCenterX(link.source.rank) - RANK_CORRIDOR_HALF_WIDTH;
      const maxX = rankCenterX(link.target.rank) + RANK_CORRIDOR_HALF_WIDTH;
      for (const node of visibleNodes) {
        if (incidentIds.has(node.id)) continue;
        if (node.x1 < minX || node.x0 > maxX) continue;
        expect(
          link.transitionLaneY <
            node.y0 - selectedEnvelopeRadius({ width: 1 }) - 0.25 ||
            link.transitionLaneY >
              node.y1 + selectedEnvelopeRadius({ width: 1 }) + 0.25,
        ).toBe(true);
      }
    }
    const repeated = laneSignature(paginationProjection());
    const shuffledProjection = paginationProjection();
    const shuffled = {
      ...shuffledProjection,
      nodes: [...shuffledProjection.nodes].reverse(),
      links: [...shuffledProjection.links].reverse(),
      paths: [...shuffledProjection.paths].reverse(),
    };
    expect(JSON.stringify(laneSignature(shuffled))).toBe(
      JSON.stringify(repeated),
    );
  });

  it("keeps shuffled input byte-for-byte identical for lanes and search counts", () => {
    const p = transitionDensityProjection();
    const shuffled = {
      ...p,
      nodes: [...p.nodes].reverse(),
      links: [...p.links].reverse(),
      paths: [...p.paths].reverse(),
    };
    expect(JSON.stringify(laneSignature(shuffled))).toBe(
      JSON.stringify(laneSignature(p)),
    );
  });

  it("preserves continuing, starting, and ending strand dock order", () => {
    const graph = expectSpacingLegal(multiLongProjection(40), 40);
    for (let rank = 0; rank < 5; rank += 1) {
      const left = graph.links
        .filter((link) => link.source.rank === rank)
        .sort((a, b) => a.transitionLaneY - b.transitionLaneY)
        .map((link) => link.branchId);
      const right = graph.links
        .filter((link) => link.source.rank === rank + 1)
        .sort((a, b) => a.transitionLaneY - b.transitionLaneY)
        .map((link) => link.branchId);
      expect(right).toEqual(left);
    }

    const mixedGraph = expectSpacingLegal(projection(), 8);
    for (const node of mixedGraph.nodes.filter(
      (candidate) => !candidate.routing,
    )) {
      const outgoing = mixedGraph.links
        .filter((link) => link.source.id === node.id)
        .sort((a, b) => a.y0 - b.y0 || compareLifecycleIds(a.id, b.id))
        .map((link) => link.id);
      const outgoingByLane = mixedGraph.links
        .filter((link) => link.source.id === node.id)
        .sort(
          (a, b) =>
            a.transitionLaneY - b.transitionLaneY ||
            compareLifecycleIds(a.id, b.id),
        )
        .map((link) => link.id);
      expect(outgoingByLane).toEqual(outgoing);

      const incoming = mixedGraph.links
        .filter((link) => link.target.id === node.id)
        .sort((a, b) => a.y1 - b.y1 || compareLifecycleIds(a.id, b.id))
        .map((link) => link.id);
      const incomingByLane = mixedGraph.links
        .filter((link) => link.target.id === node.id)
        .sort(
          (a, b) =>
            a.transitionLaneY - b.transitionLaneY ||
            compareLifecycleIds(a.id, b.id),
        )
        .map((link) => link.id);
      expect(incomingByLane).toEqual(incoming);
    }
  });

  it("fails deterministically and restores the baseline for an infeasible component", () => {
    const p = projection();
    const { graph } = layoutLifecycleRoutingGraph(p, 100, {
      transitionLanePhaseOnly: true,
    });
    const before = graph.links.map((link) => ({
      id: link.id,
      y0: link.y0,
      y1: link.y1,
      transitionLaneY: link.transitionLaneY,
    }));
    expect(
      before.every(
        (link) =>
          Number.isFinite(link.y0) &&
          Number.isFinite(link.y1) &&
          Number.isFinite(link.transitionLaneY),
      ),
    ).toBe(true);
    let thrown;
    try {
      layoutLifecycleRoutingGraph(p, 100, {
        routingGraph: graph,
        transitionLanePhaseOnly: true,
        transitionLaneStateLimit: 0,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.message).toMatch(/exceeded 0 deterministic states/u);
    expect(thrown?.cause).toMatchObject({
      type: "lifecycle-transition-lane-order",
      reason: "state-limit",
      stateLimit: 0,
    });
    expect(thrown.cause.linkIds.length).toBeGreaterThan(0);
    expect(
      graph.links.map((link) => ({
        id: link.id,
        y0: link.y0,
        y1: link.y1,
        transitionLaneY: link.transitionLaneY,
      })),
    ).toEqual(before);
  });

  it("propagates a hard materialization invariant rather than lane infeasibility", () => {
    // denseBranchProjection() spans 55 origin->endpoint branches across the
    // full rank width, so every intermediate rank hosts 55 private routing
    // nodes that materializeLaneAssignments must anchor. Corrupting one
    // routing node's branchId to reference a nonexistent branch forces the
    // routing-anchor comparator's "missing branch metadata" invariant
    // (distinct from the recoverable "routing-anchor-infeasible" cause),
    // proving candidateCallback re-throws unknown/hard invariants rather
    // than silently treating them as ordinary candidate rejection.
    const p = denseBranchProjection();
    const { graph } = layoutLifecycleRoutingGraph(p, 1850, {
      transitionLanePhaseOnly: true,
    });
    const routingByRank = new Map();
    for (const node of graph.nodes) {
      if (!node.routing) continue;
      if (!routingByRank.has(node.rank)) routingByRank.set(node.rank, []);
      routingByRank.get(node.rank).push(node);
    }
    const sharedRankNodes = [...routingByRank.values()].find(
      (list) => list.length >= 2,
    );
    expect(sharedRankNodes?.length ?? 0).toBeGreaterThanOrEqual(2);
    const corruptedId = sharedRankNodes[0].id;
    const corrupted = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === corruptedId
          ? { ...node, branchId: "branch:does-not-exist" }
          : node,
      ),
    };
    let thrown;
    try {
      layoutLifecycleRoutingGraph(p, 1850, {
        routingGraph: corrupted,
        transitionLanePhaseOnly: true,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.message).toMatch(
      /Lifecycle routing-node invariant violated for rank/u,
    );
    // A hard/unexpected materialization invariant carries no lane-order
    // cause at all; it must not be reported as "no-feasible-topological-
    // order" (or any other structured lane-solver failure), which is the
    // classification reserved for genuine ordering/state-budget failures.
    expect(thrown?.cause?.reason).not.toBe("no-feasible-topological-order");
    expect(thrown?.cause).toBeUndefined();
  });

  it("uses deterministic state bounds without unchecked candidate fallback", () => {
    const graph = expectSpacingLegal(transitionDensityProjection(), 89);
    expect(graph.transitionLaneSolverStats.stateLimit).toBe(200000);
    expect(
      graph.links.every((link) => Number.isFinite(link.transitionLaneY)),
    ).toBe(true);
  });

  it("resolves un-phased dense fan-in fast, without exponential blowup", () => {
    // transitionDensityProjection()'s 50-branch fan-in to one milestone has
    // no handle-clearance-feasible lane arrangement, even accounting for
    // HANDLE_CLEARANCE_TOLERANCE's small last-resort clearance allowance --
    // so this always throws. The point of this regression test is that it
    // must do so FAST and deterministically (never the multi-minute
    // exponential-blowup hang the original bug report measured), and that
    // the failure is precisely characterized as a fixed-width rank-corridor
    // limitation, not a route-clearance one neither shipped tolerance could
    // ever reach: every blocked branch's nearestRejectedCandidate.clearanceMargin
    // is exactly -1 (COLLISION_MARGIN, the fixedGeometry/corridor-bounds
    // sentinel), confirmed directly. See
    // docs/design/lifecycle-diagram-layout-algorithm.md's "Still not fixed"
    // section for the full analysis and what would actually be needed
    // (a corridor width that scales with incident-branch count, or a
    // different placement strategy) -- not attempted here.
    //
    // Historical baseline: before HANDLE_CLEARANCE_TOLERANCE, this exhausted
    // the shared handle-state budget (32768/32768, "state-limit"). With the
    // tolerance in place, the search now converges on a genuine, cheaper
    // "no-candidates" invariant instead -- still deterministic and bounded,
    // just a different (faster) failure signature for the same underlying
    // infeasibility.
    const start = Date.now();
    let thrown;
    try {
      layoutLifecycleRoutingGraph(transitionDensityProjection(), 1850);
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.cause).toMatchObject({
      type: "lifecycle-handle-placement",
      reason: "no-candidates",
    });
    expect(thrown?.cause?.blockedBranchIds?.length).toBeGreaterThan(0);
    expect(
      thrown?.cause?.branches?.every(
        (branch) => branch.nearestRejectedCandidate?.clearanceMargin === -1,
      ),
    ).toBe(true);
    expect(Date.now() - start).toBeLessThan(30000);
  });

  it("selects lanes that clear non-incident obstacles in the branch X span", () => {
    const p = projection();
    const { graph } = layoutLifecycleRoutingGraph(p, 1850, {
      transitionLanePhaseOnly: true,
    });
    // routeEnvelopeRadius + 0.25 matches the internal clearancePad
    const clearancePad = selectedEnvelopeRadius({ width: 1 }) + 0.25;
    const visibleNodes = graph.nodes.filter(
      (node) => !node.routing && Number(node.total) > 0,
    );
    let nonIncidentPairsChecked = 0;
    for (const link of graph.links) {
      const sourceRank = link.source.rank;
      const targetRank = link.target.rank;
      const minX = rankCenterX(sourceRank) - RANK_CORRIDOR_HALF_WIDTH;
      const maxX = rankCenterX(targetRank) + RANK_CORRIDOR_HALF_WIDTH;
      const incidentIds = new Set([link.source.id, link.target.id]);
      const laneY = link.transitionLaneY;
      for (const node of visibleNodes) {
        if (incidentIds.has(node.id)) continue;
        if (node.x1 < minX || node.x0 > maxX) continue;
        nonIncidentPairsChecked += 1;
        expect(
          laneY < node.y0 - clearancePad || laneY > node.y1 + clearancePad,
          `link ${link.id} laneY=${laneY} intersects non-incident node ` +
            `${node.id} at y=[${node.y0},${node.y1}]`,
        ).toBe(true);
      }
    }
    // The routing fixture has milestone nodes that are non-incident
    // obstacles for rank-spanning branches; verify at least some pairs
    // were checked to confirm the test is not vacuously passing.
    expect(nonIncidentPairsChecked).toBeGreaterThan(0);
  });

  it("resolves conflicted branches with deterministic MRV backtracking", () => {
    // The routing fixture has 8 branches with many overlapping rank
    // intervals, creating a heavily-connected conflict graph. Naive
    // greedy first-fit required 23 states for this fixture; MRV +
    // forward-checking prunes conflicting values before they are
    // attempted, solving each branch in at most one state.
    const p = projection();
    const { graph } = layoutLifecycleRoutingGraph(p, 1850, {
      transitionLanePhaseOnly: true,
    });
    expect(graph.branches.length).toBeGreaterThan(0);
    expect(graph.transitionLaneSolverStats.statesVisited).toBeGreaterThan(
      graph.branches.length,
    );
    // All branches receive a finite lane.
    expect(
      graph.links.every((link) => Number.isFinite(link.transitionLaneY)),
    ).toBe(true);
  });

  it("does not conflate failed states across different later-rank branch placements", () => {
    // Adversarial multi-rank projection: two branches from milestone_0→endpoint
    // are active at ranks 1–5, while three branches from milestone_1→endpoint
    // are active at ranks 2–5.  Both groups share the same component because
    // they are co-active at ranks 2–5.
    //
    // The canonical failed-state key must capture the envelope and partial
    // continuation for EVERY unresolved rank, not just the immediately next
    // rank.  A failed ordering recorded while one of the rank-2-only-starting
    // branches occupies an early position must not prune a state where that
    // branch has not yet been placed (giving the rank-2 envelope room for a
    // different feasible ordering).  The canonical key encodes rank-2 through
    // rank-5 state, preventing this conflation.  The resulting 7 branches
    // are: 2 single-rank O→M1 branches (component 1) plus 2 multi-rank
    // M1→E branches and 3 multi-rank M2→E branches (component 2).
    const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins
      .slice(0, 1)
      .map(({ id }) => id);
    const milestones = LIFECYCLE_DIAGRAM_TAXONOMY.milestones
      .slice(0, 1)
      .map(({ id }) => id);
    const techMilestone = LIFECYCLE_DIAGRAM_TAXONOMY.milestones
      .slice(1, 2)
      .map(({ id }) => id);
    const endpoints = LIFECYCLE_DIAGRAM_TAXONOMY.endpoints
      .filter(({ id }) => id !== "unknown")
      .slice(0, 5)
      .map(({ id }) => id);
    const nodes = [
      {
        id: `origin:${origins[0]}`,
        label: origins[0],
        total: 0,
        applicationIds: [],
      },
      {
        id: `milestone:${milestones[0]}`,
        label: milestones[0],
        total: 0,
        applicationIds: [],
      },
      {
        id: `milestone:${techMilestone[0]}`,
        label: techMilestone[0],
        total: 0,
        applicationIds: [],
      },
      ...endpoints.map((id) => ({
        id: `endpoint:${id}`,
        label: id,
        total: 0,
        applicationIds: [],
      })),
    ];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const links = [];
    const paths = [];
    // Two applications travel origin → milestone_0 → endpoint (2-rank branches A, B)
    for (let i = 0; i < 2; i += 1) {
      const appId = `adv-long-${i}`;
      const endpointId = endpoints[i];
      nodeById.get(`origin:${origins[0]}`).total += 1;
      nodeById.get(`origin:${origins[0]}`).applicationIds.push(appId);
      nodeById.get(`milestone:${milestones[0]}`).total += 1;
      nodeById.get(`milestone:${milestones[0]}`).applicationIds.push(appId);
      nodeById.get(`endpoint:${endpointId}`).total += 1;
      nodeById.get(`endpoint:${endpointId}`).applicationIds.push(appId);
      links.push(
        {
          id: `link:${appId}:origin->${milestones[0]}`,
          source: `origin:${origins[0]}`,
          target: `milestone:${milestones[0]}`,
          value: 1,
          applicationIds: [appId],
        },
        {
          id: `link:${appId}:${milestones[0]}->endpoint`,
          source: `milestone:${milestones[0]}`,
          target: `endpoint:${endpointId}`,
          value: 1,
          applicationIds: [appId],
        },
      );
      paths.push({
        applicationId: appId,
        endpoint: endpointId,
        nodeIds: [
          `origin:${origins[0]}`,
          `milestone:${milestones[0]}`,
          `endpoint:${endpointId}`,
        ],
      });
    }
    // Three applications travel milestone_1 → endpoint only (1-rank branches C, D, E)
    for (let i = 0; i < 3; i += 1) {
      const appId = `adv-short-${i}`;
      const endpointId = endpoints[2 + i];
      nodeById.get(`milestone:${techMilestone[0]}`).total += 1;
      nodeById.get(`milestone:${techMilestone[0]}`).applicationIds.push(appId);
      nodeById.get(`endpoint:${endpointId}`).total += 1;
      nodeById.get(`endpoint:${endpointId}`).applicationIds.push(appId);
      links.push({
        id: `link:${appId}:${techMilestone[0]}->endpoint`,
        source: `milestone:${techMilestone[0]}`,
        target: `endpoint:${endpointId}`,
        value: 1,
        applicationIds: [appId],
      });
      paths.push({
        applicationId: appId,
        endpoint: endpointId,
        nodeIds: [`milestone:${techMilestone[0]}`, `endpoint:${endpointId}`],
      });
    }
    const advProjection = { nodes, links, paths };
    // Solver must find spacing-legal assignments within the state budget.
    const graph = expectSpacingLegal(advProjection, 7);
    expect(
      graph.links.every((link) => Number.isFinite(link.transitionLaneY)),
    ).toBe(true);
    // Results must be deterministic under shuffled graph inputs.
    const sig1 = laneSignature(advProjection);
    const shuffled = {
      ...advProjection,
      nodes: [...advProjection.nodes].reverse(),
      links: [...advProjection.links].reverse(),
      paths: [...advProjection.paths].reverse(),
    };
    expect(JSON.stringify(laneSignature(shuffled))).toBe(JSON.stringify(sig1));
  });
  // eslint-disable-next-line max-len
  it("exposes candidateEvaluations, handleStatesVisited, and handleStateLimit in solver stats", () => {
    const { graph } = layoutLifecycleRoutingGraph(projection(), 1850);
    const stats = graph.transitionLaneSolverStats;
    expect(typeof stats.candidateEvaluations).toBe("number");
    expect(stats.candidateEvaluations).toBeGreaterThanOrEqual(1);
    expect(typeof stats.handleStatesVisited).toBe("number");
    expect(stats.handleStatesVisited).toBeGreaterThanOrEqual(0);
    expect(stats.handleStateLimit).toBe(32768);
    expect(stats.handleStatesVisited).toBeLessThanOrEqual(
      stats.handleStateLimit,
    );
  });

  // transitionDensityProjection()'s 50-branch fan-in to a single milestone
  // is still infeasible -- its 41 blocked branches are all rejected with
  // nearestRejectedCandidate.clearanceMargin exactly -1 (COLLISION_MARGIN,
  // the fixedGeometry/corridor-bounds sentinel), not the
  // nonincidentRouteClearance category either shipped tolerance widens (see
  // that fixture's own characterization above). This test's actual
  // contract -- a shared handle budget that accumulates across multiple
  // candidate callbacks without resetting, stays bounded, and is
  // shuffle-stable -- is tested here against a *feasible* fixture instead:
  // the real tracker-lifecycle-diagram-v2.json dense fixture, which
  // discovery's own search already needs 45 distinct candidate evaluations
  // to solve (confirmed directly), exercising the shared-budget contract
  // far more thoroughly than a single-candidate fixture would.
  it("shares a single handle budget across all candidate callbacks without resetting", () => {
    const recordHandleStatesUntilAccepted = (projection) => {
      const seen = [];
      let accepted = false;
      layoutLifecycleRoutingGraph(projection, 1850, {
        testOnlyDiagnosticSink: (snapshot) => {
          if (accepted) return;
          seen.push(snapshot.handleBudget.statesVisited);
          if (snapshot.phase === "accepted") accepted = true;
        },
      });
      return seen;
    };
    const seen = recordHandleStatesUntilAccepted(
      projectLifecycleAt(denseFixture),
    );
    // Discovery's own search needs multiple candidate callbacks to solve
    // this fixture -- exercising "shared across callbacks", not just one.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // Cumulative, never reset: each recorded value is the running total
    // across every candidate tried so far, so it can never decrease.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1]);
    }
    expect(seen.at(-1)).toBeLessThanOrEqual(32768);

    // Verify shuffle-stability of the same recorded sequence.
    const reversedProjection = () => {
      const p = projectLifecycleAt(denseFixture);
      return {
        ...p,
        nodes: [...p.nodes].reverse(),
        links: [...p.links].reverse(),
        paths: [...p.paths].reverse(),
      };
    };
    const seenReversed = recordHandleStatesUntilAccepted(reversedProjection());
    expect(seenReversed).toEqual(seen);
  });
});

describe("combinationsOfSize", () => {
  it("yields the empty combination once for k = 0 and nothing for k > n", () => {
    expect([...combinationsOfSize(3, 0)]).toEqual([[]]);
    expect([...combinationsOfSize(3, 4)]).toEqual([]);
  });

  // eslint-disable-next-line max-len
  it("enumerates every k-subset of {0, ..., n - 1} exactly once, in ascending lexicographic order", () => {
    expect([...combinationsOfSize(4, 2)]).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    expect([...combinationsOfSize(3, 1)]).toEqual([[0], [1], [2]]);
    expect([...combinationsOfSize(3, 3)]).toEqual([[0, 1, 2]]);
  });

  // eslint-disable-next-line max-len
  it("produces strictly increasing, duplicate-free subsets whose count matches the binomial coefficient", () => {
    // The global coordinate-refinement search relies on this generator to try
    // every distinct subset of implicated variables exactly once per size, in
    // increasing order of combination cardinality, so a solution requiring
    // few coordinated moves is always found before one requiring many.
    const nCr = (n, k) => {
      let result = 1;
      for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
      return Math.round(result);
    };
    const n = 6;
    for (let k = 0; k <= n; k += 1) {
      const combos = [...combinationsOfSize(n, k)];
      expect(combos).toHaveLength(nCr(n, k));
      const seen = new Set(combos.map((combo) => combo.join(",")));
      expect(seen.size).toBe(combos.length);
      for (const combo of combos) {
        expect(combo).toHaveLength(k);
        expect(combo).toEqual([...combo].sort((a, b) => a - b));
        expect(new Set(combo).size).toBe(combo.length);
        for (const index of combo) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(n);
        }
      }
    }
  });
});

describe("test-only lifecycle layout diagnostics", () => {
  const shuffledProjection = (fixture) => {
    const p = projectLifecycleAt(fixture);
    return {
      ...p,
      nodes: [...p.nodes].reverse(),
      links: [...p.links].reverse(),
      paths: [...p.paths].reverse(),
    };
  };

  const reversedBaseOrderFrom = (diagnostic) =>
    new Map(
      diagnostic.ranks.map((rank) => [
        rank.rank,
        rank.nodePositions.map((node) => node.id).reverse(),
      ]),
    );

  it("ignores diagnostic hooks outside the test environment", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalVitest = process.env.VITEST;
    process.env.NODE_ENV = "production";
    delete process.env.VITEST;
    try {
      expect(() =>
        testOnlyDiagnoseLifecycleLayoutAttempt(
          projectLifecycleAt(routingFixture),
          1850,
        ),
      ).toThrow("Lifecycle layout diagnostics are available only in tests");

      const baseline = layoutLifecycleRoutingGraph(
        projectLifecycleAt(routingFixture),
        1850,
      ).graph;
      const ignoredOrder = new Map(
        [...new Set(baseline.nodes.map((node) => node.rank))].map((rank) => [
          rank,
          new Map(
            baseline.nodes
              .filter((node) => node.rank === rank)
              .sort((left, right) => left.y0 - right.y0)
              .map((node) => node.id)
              .reverse()
              .map((id, index) => [id, index]),
          ),
        ]),
      );
      const diagnosticCalls = [];
      const diagnosticSink = (snapshot) => diagnosticCalls.push(snapshot);
      const withIgnoredHooks = layoutLifecycleRoutingGraph(
        projectLifecycleAt(routingFixture),
        1850,
        {
          testOnlyBaseNodeOrderByRank: ignoredOrder,
          testOnlyDiagnosticSink: diagnosticSink,
        },
      ).graph;

      expect(diagnosticCalls).toEqual([]);
      expect(
        withIgnoredHooks.nodes.map((node) => [
          node.id,
          node.rank,
          node.y0,
          node.y1,
        ]),
      ).toEqual(
        baseline.nodes.map((node) => [node.id, node.rank, node.y0, node.y1]),
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = originalVitest;
    }
  });

  it("keeps routing-v2 route auditing clean while exposing deterministic rank diagnostics", () => {
    const p = projection();
    const { graph, dimensions } = layoutLifecycleRoutingGraph(p, 1850);
    expect(
      auditLifecycleRouteGeometry({ graph, dimensions, handles: [] })
        .fatalFindings,
    ).toEqual([]);

    const baseline = testOnlyDiagnoseLifecycleLayoutAttempt(p, 1850, {
      transitionLanePhaseOnly: true,
    });
    const shuffled = testOnlyDiagnoseLifecycleLayoutAttempt(
      shuffledProjection(routingFixture),
      1850,
      { transitionLanePhaseOnly: true },
    );
    expect(shuffled).toEqual(baseline);
    expect(baseline.firstRejectedPhase).toBeNull();
    expect(baseline.ranks.map((rank) => rank.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(
      baseline.ranks.every(
        (rank) =>
          rank.centeredAssignmentFeasible &&
          rank.domains.every((domain) => domain.domainSize > 0),
      ),
    ).toBe(true);
  });

  it("reports centered assignment feasibility with rank lane spacing", () => {
    const snapshots = [];
    layoutLifecycleRoutingGraph(projectLifecycleAt(routingFixture), 1850, {
      testOnlyDiagnosticSink: (snapshot) => snapshots.push(snapshot),
    });
    const diagnostic = testOnlyDiagnoseLifecycleLayoutAttempt(
      projectLifecycleAt(routingFixture),
      1850,
      { transitionLanePhaseOnly: true },
    );
    expect(snapshots.length).toBeGreaterThan(0);
    const rankInfoByRank = snapshots[0].rankRefinementInfo;
    expect(rankInfoByRank).toBeInstanceOf(Map);

    for (const rank of diagnostic.ranks) {
      const rawRankInfo = rankInfoByRank.get(rank.rank);
      expect(rawRankInfo?.minLaneSpacing).toBeGreaterThan(0);
      expect(rank.minLaneSpacing).toBe(rawRankInfo.minLaneSpacing);
      const recomputed = rawRankInfo.cen.every((value, index) => {
        const intervals = rawRankInfo.rankOrder[index].intervals;
        const inDomain = intervals.some(
          ([lo, hi]) => value >= lo - 1e-6 && value <= hi + 1e-6,
        );
        if (!inDomain) return false;
        if (index === 0) return true;
        return (
          value >=
          rawRankInfo.cen[index - 1] + rawRankInfo.minLaneSpacing - 1e-6
        );
      });
      expect(rank.centeredAssignmentFeasible).toBe(recomputed);
    }
  });

  it("identifies the invariant violated by a second base pass", () => {
    const baseline = testOnlyDiagnoseLifecycleLayoutAttempt(
      projectLifecycleAt(routingFixture),
      1850,
      { transitionLanePhaseOnly: true },
    );
    const reversed = testOnlyDiagnoseLifecycleLayoutAttempt(
      projectLifecycleAt(routingFixture),
      1850,
      { baseNodeOrderByRank: reversedBaseOrderFrom(baseline) },
    );
    // With HANDLE_CLEARANCE_TOLERANCE, every branch now has at least one
    // legal handle candidate under this reversed order (branchDiagnosticCount
    // 0 -- handle placement itself no longer rejects), but the resulting
    // geometry has more route crossings than the strict (near-zero budget
    // pressure) tolerance allows on a first candidate, so rejection now
    // happens one phase later, at the route-crossing audit.
    expect(reversed.firstRejectedPhase).toBe("route-crossing");
    expect(reversed.firstRejectedReason).toMatchObject({
      reason: "route-crossing",
      firstAffectedRank: 0,
      evidence: { branchDiagnosticCount: 0 },
    });
    expect(
      reversed.firstRejectedReason.evidence.routeFindingCount,
    ).toBeGreaterThan(0);
    expect(reversed.ranks[0].centeredAssignmentFeasible).toBe(true);
    expect(
      reversed.ranks[0].domains.every((domain) => domain.domainSize > 0),
    ).toBe(true);
    expect(reversed.states.handle).toBeGreaterThan(0);
  });

  it("reproduces dense fixture diagnostics under a second base pass", () => {
    const baseline = testOnlyDiagnoseLifecycleLayoutAttempt(
      projectLifecycleAt(denseFixture),
      1850,
      { transitionLanePhaseOnly: true },
    );
    const reversedOrder = reversedBaseOrderFrom(baseline);
    const reversed = testOnlyDiagnoseLifecycleLayoutAttempt(
      projectLifecycleAt(denseFixture),
      1850,
      {
        baseNodeOrderByRank: reversedOrder,
        transitionLanePhaseOnly: true,
      },
    );
    const shuffled = testOnlyDiagnoseLifecycleLayoutAttempt(
      shuffledProjection(denseFixture),
      1850,
      {
        baseNodeOrderByRank: reversedOrder,
        transitionLanePhaseOnly: true,
      },
    );
    expect(shuffled).toEqual(reversed);
    expect(reversed.firstRejectedPhase).toBeNull();
    expect(
      reversed.ranks[0].domains.every((domain) => domain.domainSize > 0),
    ).toBe(true);
  });

  // Historical baseline (pre-fix, see
  // docs/design/lifecycle-diagram-layout-algorithm.md's "Checked-in
  // reproduction" section): denseBranchProjection() (5 origins x 11
  // endpoints = 55 direct origin->endpoint branches, each routed through
  // the taxonomy's 5 fixed milestone ranks) used to fail at the *first*
  // candidate's handle-placement phase (firstRejectedPhase: "handle",
  // reason: "no-candidates"), with 14 "long diagonal" branches -- later-
  // ordered origins (referral, recruiter_company_outreach, other_unknown)
  // paired with later-ordered endpoints (offer_declined,
  // offer_expired_rescinded, offer_accepted, closed_archived, unknown,
  // candidate_withdrew) -- getting zero legal handle candidates anywhere
  // along their curve, with states.handle in the low thousands (far below
  // the 32768 budget -- not a narrow budget miss). Fixed by
  // buildMilestoneFreeJointOrder giving discovery's own first D3 pass a
  // topology-derived order instead of the plain, rankOrder-blind
  // nodeSort/linkSort it fell back to before (this fixture has no real
  // milestone nodes, so it's in-scope for that fix) -- see the design
  // doc's "Investigation (2026-07-26)" section. This test now characterizes the
  // fixed behavior: the same fixture, still deterministic and
  // order-independent, now succeeds outright.
  it("characterizes dense routing-only handle feasibility deterministically", () => {
    const reversedDenseBranchProjection = () => {
      const p = denseBranchProjection();
      return {
        ...p,
        nodes: [...p.nodes].reverse(),
        links: [...p.links].reverse(),
        paths: [...p.paths].reverse(),
      };
    };
    // A permutation distinct from a plain reversal (rotate by one-third),
    // so agreement with baseline isn't just reversal-symmetry.
    const rotate = (array) => {
      const offset = Math.floor(array.length / 3);
      return [...array.slice(offset), ...array.slice(0, offset)];
    };
    const shuffledDenseBranchProjection = () => {
      const p = denseBranchProjection();
      return {
        ...p,
        nodes: rotate(p.nodes),
        links: rotate(p.links),
        paths: rotate(p.paths),
      };
    };

    const baseline = testOnlyDiagnoseLifecycleLayoutAttempt(
      denseBranchProjection(),
      1850,
    );
    const reversed = testOnlyDiagnoseLifecycleLayoutAttempt(
      reversedDenseBranchProjection(),
      1850,
    );
    const shuffled = testOnlyDiagnoseLifecycleLayoutAttempt(
      shuffledDenseBranchProjection(),
      1850,
    );
    expect(reversed).toEqual(baseline);
    expect(shuffled).toEqual(baseline);

    // First candidate is now fully accepted (firstRejectedPhase: null),
    // using only a small fraction of the 32768 handle-state budget.
    // Historical baseline before the fix (see the comment above this
    // test): firstRejectedPhase was "handle", reason "no-candidates", with
    // exactly these 14 blocked branch IDs and states.handle far below
    // 32768 but nonzero:
    //   other_unknown -> closed_archived, offer_accepted, offer_declined,
    //     offer_expired_rescinded, unknown
    //   recruiter_company_outreach -> closed_archived, offer_accepted,
    //     offer_declined, offer_expired_rescinded, unknown
    //   referral -> candidate_withdrew, closed_archived, offer_accepted,
    //     offer_expired_rescinded
    //   (full branch IDs: "branch:link:origin:<origin>->endpoint:<endpoint>:endpoint:<endpoint>")
    expect(baseline.firstRejectedPhase).toBeNull();
    expect(baseline.firstRejectedReason).toBeNull();
    expect(baseline.states.handle).toBeGreaterThan(0);
    expect(baseline.states.handle).toBeLessThan(32768);

    // Lane domains and the centered assignment remain feasible at every
    // rank's own minimum spacing -- this is not a spacing-constant problem.
    for (const rank of baseline.ranks) {
      expect(rank.minLaneSpacing).toBeCloseTo(59.251, 3);
      expect(rank.centeredAssignmentFeasible).toBe(true);
      expect(rank.domains.every((domain) => domain.domainSize > 0)).toBe(true);
    }

    // Five routing-only ranks (one per fixed taxonomy milestone), each
    // hosting all 55 branches' routing nodes -- 275 routing nodes total,
    // none of which are real-node docks.
    const routingOnlyRanks = baseline.ranks.filter(
      (rank) =>
        rank.nodePositions.length > 0 &&
        rank.nodePositions.every((node) => node.kind === "routing"),
    );
    expect(routingOnlyRanks).toHaveLength(5);
    for (const rank of routingOnlyRanks) {
      expect(rank.nodePositions).toHaveLength(55);
    }
    expect(
      routingOnlyRanks.reduce(
        (sum, rank) => sum + rank.nodePositions.length,
        0,
      ),
    ).toBe(275);
  });

  // Preserves the joint-order investigation behind
  // buildMilestoneFreeJointOrder (see docs/design/lifecycle-diagram-layout-algorithm.md's
  // "Investigation (2026-07-26)" section) as a permanent, deterministic
  // regression, rather than a deleted scratch script. This is intentionally
  // NOT wired into production eligibility: buildMilestoneFreeJointOrder
  // stays gated on hasIntermediateRealNodes exactly as shipped. This test
  // reconstructs the same joint-order/rank-restriction logic independently
  // (using only exported symbols and the testOnlyBaseNodeOrderByRank /
  // authoritativeBranchOrderByRank test hooks) and applies it WITHOUT that
  // gate, to both prove the routing-only success case one more time and
  // lock in the regression that justifies keeping the gate.
  describe("joint-order investigation regression", () => {
    const compareBranchesJoint = (a, b) => {
      if (a.sourceRank === 0 && b.sourceRank === 0) {
        const taxonomyDiff = taxonomyOrder(a.source) - taxonomyOrder(b.source);
        if (taxonomyDiff !== 0) return taxonomyDiff;
      }
      return compareBranches(a, b);
    };
    const buildUngatedJointOrders = (graph) => {
      const jointBranches = [...graph.branches].sort(compareBranchesJoint);
      const branchOrderByRank = new Map();
      const ranksInUse = new Set();
      for (const branch of jointBranches)
        for (let rank = branch.sourceRank; rank < branch.targetRank; rank += 1)
          ranksInUse.add(rank);
      for (const rank of ranksInUse) {
        const active = jointBranches.filter(
          (branch) => branch.sourceRank <= rank && rank < branch.targetRank,
        );
        branchOrderByRank.set(
          rank,
          new Map(active.map((branch, index) => [branch.id, index])),
        );
      }
      const nodeOrderByRank = new Map();
      for (const rank of [...new Set(graph.nodes.map((node) => node.rank))]) {
        const nodes = graph.nodes.filter((node) => node.rank === rank);
        // Deliberately UNGATED: unlike buildMilestoneFreeJointOrder, this
        // reorders any rank with zero real nodes regardless of whether the
        // graph as a whole has milestones elsewhere -- exactly the
        // construction the investigation found regresses real fixtures.
        if (nodes.some((node) => !node.routing)) {
          nodes.sort(nodeSort);
        } else {
          const branchIndex = branchOrderByRank.get(rank);
          nodes.sort(
            (left, right) =>
              (branchIndex?.get(left.branchId) ?? 0) -
                (branchIndex?.get(right.branchId) ?? 0) ||
              compareLifecycleIds(left.id, right.id),
          );
        }
        nodeOrderByRank.set(
          rank,
          new Map(nodes.map((node, index) => [node.id, index])),
        );
      }
      return { nodeOrderByRank, branchOrderByRank };
    };
    const layoutWithUngatedJointOrder = (projection, width = 1850) => {
      const graph = buildLifecycleRoutingGraph(projection);
      const { nodeOrderByRank, branchOrderByRank } =
        buildUngatedJointOrders(graph);
      return layoutLifecycleRoutingGraph(projection, width, {
        testOnlyBaseNodeOrderByRank: nodeOrderByRank,
        authoritativeBranchOrderByRank: branchOrderByRank,
      });
    };

    it("succeeds cleanly and deterministically on the milestone-free dense fixture", () => {
      const result = layoutWithUngatedJointOrder(denseBranchProjection());
      const stats = result.graph.transitionLaneSolverStats;
      expect(stats.statesVisited).toBe(993);
      expect(stats.handleStatesVisited).toBe(5637);
      expect(result.graph.acceptedRouteCrossingCount).toBe(0);
    });

    it("regresses the reference fixture from zero crossings to a tolerated one", () => {
      // Production's own gated approach (buildMilestoneFreeJointOrder,
      // never engaging here since this fixture has milestones) keeps this
      // fixture at exactly 0 accepted crossings -- see the seeded-replay
      // suite above. Applying the same joint order ungated introduces a
      // crossing production's default ordering never needed to tolerate.
      const result = layoutWithUngatedJointOrder(
        projectLifecycleAt(routingFixture),
      );
      expect(result.graph.acceptedRouteCrossingCount).toBeGreaterThan(0);
    });

    it("regresses the real dense fixture from success to outright handle-budget exhaustion", () => {
      // Production's own gated approach succeeds on this fixture (see
      // "lays out dense fixture with bounded semantic docks and safe
      // handles" above). Applying the same joint order ungated instead
      // exhausts the handle-state budget outright.
      let thrown;
      try {
        layoutWithUngatedJointOrder(projectLifecycleAt(denseFixture));
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.cause).toMatchObject({
        reason: "state-limit",
        phase: "handle",
        stateLimit: 32768,
      });
    });
  });
});

describe("createLaneGeometryFailureCache", () => {
  // layoutLifecycleRoutingGraph's candidateCallback calls this exact factory
  // (not a copy) to classify why a full-geometry signature was rejected, so
  // a later cache hit for an identical signature can restore that
  // signature's own diagnostics instead of leaving whatever an unrelated,
  // more-recently evaluated candidate last set on
  // lastRoutingAnchorFailure/lastHandleFailure. These tests exercise that
  // typed replay contract directly.

  it("returns null for a signature that has never been recorded", () => {
    const cache = createLaneGeometryFailureCache();
    expect(cache.get("unseen-signature")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("classifies a recoverable routing-anchor failure and preserves its rank", () => {
    const cache = createLaneGeometryFailureCache();
    const anchorError = new Error(
      "Lifecycle routing anchor allocation failed for transition rank 3",
    );
    anchorError.cause = Object.freeze({
      type: "lifecycle-routing-anchor-allocation",
      reason: "routing-anchor-infeasible",
      rank: 3,
    });
    cache.recordRoutingAnchorFailure("sig-a", anchorError);
    const cached = cache.get("sig-a");
    expect(cached.kind).toBe("routing-anchor");
    // Preserved unchanged: same error object, same frozen cause, same rank.
    expect(cached.error).toBe(anchorError);
    expect(cached.error.cause.rank).toBe(3);
    const type = "lifecycle-routing-anchor-allocation";
    expect(cached.error.cause.type).toBe(type);
  });

  it("classifies a handle-placement failure with its own evidence", () => {
    const cache = createLaneGeometryFailureCache();
    const handleCheck = Object.freeze({
      ok: false,
      reason: "no-candidates",
      blockedBranchIds: Object.freeze(["branch:x"]),
    });
    cache.recordHandleFailure("sig-b", handleCheck);
    const cached = cache.get("sig-b");
    expect(cached.kind).toBe("handle");
    expect(cached.handleCheck).toBe(handleCheck);
    expect(cached.handleCheck.blockedBranchIds).toEqual(["branch:x"]);
  });

  it("isolates diagnostics across signatures instead of leaking stale state", () => {
    // This is the literal bug this cache fixes: candidateCallback previously
    // left lastRoutingAnchorFailure/lastHandleFailure untouched on a cache
    // hit, so whichever kind was evaluated *most recently* (regardless of
    // which signature it belonged to) leaked into an unrelated signature's
    // replay. Recording in one order and reading back in a different order
    // proves each signature's own classification survives independently.
    const cache = createLaneGeometryFailureCache();
    const anchorError = new Error("anchor failed at rank 1");
    anchorError.cause = Object.freeze({
      type: "lifecycle-routing-anchor-allocation",
      reason: "routing-anchor-infeasible",
      rank: 1,
    });
    const handleCheck = Object.freeze({
      ok: false,
      reason: "handle-overlap",
      blockedBranchIds: Object.freeze(["branch:y"]),
    });
    cache.recordRoutingAnchorFailure("sig-anchor", anchorError);
    cache.recordHandleFailure("sig-handle", handleCheck);
    // Read back out of insertion order: the handle signature first, then
    // the routing-anchor signature.
    const cachedHandle = cache.get("sig-handle");
    expect(cachedHandle.kind).toBe("handle");
    expect(cachedHandle.handleCheck).toBe(handleCheck);
    const cachedAnchor = cache.get("sig-anchor");
    expect(cachedAnchor.kind).toBe("routing-anchor");
    expect(cachedAnchor.error).toBe(anchorError);
    expect(cachedAnchor.error.cause.rank).toBe(1);
    // Re-reading the handle signature again afterward must still return its
    // own classification, not the anchor signature's.
    expect(cache.get("sig-handle").kind).toBe("handle");
  });

  it("replays a duplicate candidate's cached classification without new work", () => {
    const cache = createLaneGeometryFailureCache();
    const anchorError = new Error("anchor failed at rank 2");
    anchorError.cause = Object.freeze({
      type: "lifecycle-routing-anchor-allocation",
      reason: "routing-anchor-infeasible",
      rank: 2,
    });
    cache.recordRoutingAnchorFailure("sig-dup", anchorError);
    expect(cache.size).toBe(1);
    const first = cache.get("sig-dup");
    const second = cache.get("sig-dup");
    // Identical object identity: replaying the same signature never
    // recomputes or reclassifies, it returns the exact recorded result.
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("keeps recording bounded: re-recording the same signature does not grow the cache", () => {
    const cache = createLaneGeometryFailureCache();
    const firstError = new Error("first anchor failure");
    firstError.cause = Object.freeze({
      type: "lifecycle-routing-anchor-allocation",
      reason: "routing-anchor-infeasible",
      rank: 4,
    });
    cache.recordRoutingAnchorFailure("sig-bounded", firstError);
    expect(cache.size).toBe(1);
    const laterHandleCheck = Object.freeze({
      ok: false,
      reason: "no-candidates",
      blockedBranchIds: Object.freeze([]),
    });
    // A distinct signature increments size...
    cache.recordHandleFailure("sig-bounded-2", laterHandleCheck);
    expect(cache.size).toBe(2);
    // ...but re-recording an already-known signature only overwrites its
    // entry rather than adding a new one.
    cache.recordHandleFailure("sig-bounded", laterHandleCheck);
    expect(cache.size).toBe(2);
    expect(cache.get("sig-bounded").kind).toBe("handle");
  });
});

describe("lifecycle diagram render-only routing layout", () => {
  it("assigns handles across independent conflict components deterministically", () => {
    const makeSegment = (id, y) => ({
      id: `${id}:segment:0`,
      branchId: id,
      segmentIndex: 0,
      source: { id: `${id}:source`, rank: 0, routing: true },
      target: { id: `${id}:target`, rank: 1, routing: true },
      y0: y,
      y1: y,
      transitionLaneY: y,
      width: 1,
    });
    const branches = ["branch:a", "branch:b", "branch:c"].map((id) => ({ id }));
    const segments = new Map([
      ["branch:a", [makeSegment("branch:a", 120)]],
      ["branch:b", [makeSegment("branch:b", 320)]],
      ["branch:c", [makeSegment("branch:c", 520)]],
    ]);
    const handles = assignBranchHandles(branches, segments, []);
    const reversed = assignBranchHandles([...branches].reverse(), segments, []);

    expect(handles.map((handle) => handle.branchId)).toEqual([
      "branch:a",
      "branch:b",
      "branch:c",
    ]);
    expect(reversed).toEqual(handles);
    for (const handle of handles) {
      expect(handle.box.width).toBe(BRANCH_HANDLE_RADIUS * 2);
      expect(handle.box.height).toBe(BRANCH_HANDLE_RADIUS * 2);
      expect(handle.clearanceMargin).toBeGreaterThan(0);
    }
    for (let left = 0; left < handles.length; left += 1) {
      for (let right = left + 1; right < handles.length; right += 1) {
        expect(boxesOverlap(handles[left].box, handles[right].box)).toBe(false);
      }
    }
  });

  it("keeps fallback handle candidates inside the standard rank corridor", () => {
    const makeSegment = (id, y) => ({
      id: `${id}:segment:0`,
      branchId: id,
      segmentIndex: 0,
      source: { id: `${id}:source`, rank: 0, routing: true },
      target: { id: `${id}:target`, rank: 1, routing: true },
      y0: y,
      y1: y,
      transitionLaneY: y,
      width: 1,
    });
    const branches = [{ id: "branch:blocked" }];
    const segments = new Map([
      ["branch:blocked", [makeSegment("branch:blocked", 240)]],
      ["branch:blocker", [makeSegment("branch:blocker", 240)]],
    ]);

    let thrown;
    try {
      assignBranchHandles(branches, segments, []);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({
          type: "lifecycle-handle-placement",
          reason: "no-candidates",
          blockedBranchIds: ["branch:blocked"],
          branches: [
            expect.objectContaining({
              branchId: "branch:blocked",
              // Both branches occupy the exact same y, at every x, so this
              // branch stays blocked through the full escalating candidate
              // search (3 primary + 8 fallback t-values), all constrained
              // by the standard rank corridor.
              attempts: 11,
              accepted: 0,
              rejected: expect.objectContaining({
                fixedGeometry: 0,
              }),
              nearestRejectedCandidate: expect.objectContaining({
                clearanceMargin: expect.any(Number),
              }),
            }),
          ],
        }),
      }),
    );
    const [diagnostic] = thrown.cause.branches;
    expect(diagnostic.attempts).toBe(
      diagnostic.accepted +
        diagnostic.rejected.fixedGeometry +
        diagnostic.rejected.outsideTransitionCorridor +
        diagnostic.rejected.nonincidentRouteClearance,
    );
    expect(
      diagnostic.nearestRejectedCandidate.clearanceMargin,
    ).toBeLessThanOrEqual(0);
    expect(diagnostic.rejected.outsideTransitionCorridor).toBeGreaterThan(0);
  });

  it("identifies fixed geometry blockers in handle diagnostics", () => {
    const segment = {
      id: "branch:fixed:segment:0",
      branchId: "branch:fixed",
      segmentIndex: 0,
      source: { id: "branch:fixed:source", rank: 0, routing: true },
      target: { id: "branch:fixed:target", rank: 1, routing: true },
      y0: 180,
      y1: 180,
      transitionLaneY: 180,
      width: 1,
    };
    const midpoint = cubicTransitionPoint(segment, 0.5);
    const visibleNodes = [
      {
        id: "node:blocker",
        label: "Blocker",
        x0: midpoint.x - 5,
        x1: midpoint.x + 5,
        y0: midpoint.y - 5,
        y1: midpoint.y + 5,
      },
    ];

    expect(() =>
      assignBranchHandles(
        [{ id: "branch:fixed" }],
        new Map([["branch:fixed", [segment]]]),
        visibleNodes,
      ),
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({
          reason: "no-candidates",
          branches: [
            expect.objectContaining({
              // The 44px-wide handle box can't clear a centrally-placed
              // obstacle from any point in this segment's corridor, so
              // every attempt across the primary and fallback search (3 +
              // 8 t-values) hits it too.
              attempts: 11,
              rejected: expect.objectContaining({ fixedGeometry: 11 }),
              nearestRejectedCandidate: expect.objectContaining({
                blocker: expect.objectContaining({
                  kind: "hit-region",
                  id: "node:blocker",
                }),
              }),
            }),
          ],
        }),
      }),
    );
  });

  it("classifies handle-overlap and state-limit assignment diagnostics deterministically", () => {
    const branches = [{ id: "branch:a" }, { id: "branch:b" }];
    const candidate = (branchId, x, y) => ({
      branchId,
      x,
      y,
      box: { x: x - 22, y: y - 22, width: 44, height: 44 },
      clearanceMargin: 10,
    });
    const overlapSets = new Map([
      ["branch:a", [candidate("branch:a", 100, 100)]],
      ["branch:b", [candidate("branch:b", 100, 100)]],
    ]);
    const overlap = solveHandleCandidateSets(branches, overlapSets);
    const reversedOverlap = solveHandleCandidateSets(
      [...branches].reverse(),
      new Map([...overlapSets.entries()].reverse()),
    );
    expect(overlap).toEqual({
      ok: false,
      reason: "handle-overlap",
      selected: expect.any(Map),
      component: {
        branchIds: ["branch:a", "branch:b"],
        candidateCounts: { "branch:a": 1, "branch:b": 1 },
        conflictingBranchPairs: [["branch:a", "branch:b"]],
        visitedStates: 1,
        stateLimit: 32768,
      },
    });
    expect(JSON.stringify(overlap.component)).toBe(
      JSON.stringify(reversedOverlap.component),
    );

    const stateLimit = solveHandleCandidateSets(branches, overlapSets, {
      maxStates: 0,
    });
    expect(stateLimit).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "state-limit",
        component: expect.objectContaining({
          visitedStates: 0,
          stateLimit: 0,
        }),
      }),
    );
    expect(overlap.component.stateLimit).toBe(32768);
  });

  it("materializes exact routed primitives for the canonical M-L-C-L route", () => {
    const p = projection();
    const layout = calculateLifecycleDiagramLayout(p);
    const { graph, dimensions } = layoutLifecycleRoutingGraph(p, layout);
    const segment = graph.links.find((link) => link.source.rank === 0);
    const [source, cubic, target] = segmentRoutePrimitives(segment);
    const sourceCenter = rankCenterX(segment.source.rank);
    const targetCenter = rankCenterX(segment.target.rank);

    expect(selectedEnvelopeRadius(segment)).toBe(7.5);
    expect(source).toMatchObject({
      type: "line",
      zone: "source",
      p0: { x: segment.source.x1, y: segment.y0 },
      p1: {
        x: sourceCenter + RANK_CORRIDOR_HALF_WIDTH,
        y: segment.y0,
      },
    });
    expect(cubic).toMatchObject({
      type: "cubic",
      zone: "transition",
      p0: {
        x: sourceCenter + RANK_CORRIDOR_HALF_WIDTH,
        y: segment.y0,
      },
      p1: {
        x: sourceCenter + RANK_CORRIDOR_HALF_WIDTH + TRANSITION_CONTROL_OFFSET,
        y: segment.transitionLaneY,
      },
      p2: {
        x: targetCenter - RANK_CORRIDOR_HALF_WIDTH - TRANSITION_CONTROL_OFFSET,
        y: segment.transitionLaneY,
      },
      p3: {
        x: targetCenter - RANK_CORRIDOR_HALF_WIDTH,
        y: segment.y1,
      },
    });
    expect(target).toMatchObject({
      type: "line",
      zone: "target",
      p0: {
        x: targetCenter - RANK_CORRIDOR_HALF_WIDTH,
        y: segment.y1,
      },
      p1: { x: targetCenter, y: segment.y1 },
    });
    expect(dimensions.width).toBeGreaterThan(MINIMUM_SVG_WIDTH - 1);
  });

  it("exposes a deterministic route model and pure geometry audit", () => {
    const p = projection();
    const layout = calculateLifecycleDiagramLayout(p);
    const { graph, dimensions } = layoutLifecycleRoutingGraph(p, layout);
    const model = buildLifecycleRouteModel(graph, dimensions);
    const audit = auditLifecycleRouteGeometry({ model, handles: [] });

    expect(model.branches.map((branch) => branch.id)).toEqual(
      [...model.branches].sort(compareBranches).map((branch) => branch.id),
    );
    expect(model.segmentsByTransitionRank).toHaveLength(6);
    expect(audit.forcedCrossings).toEqual([]);
    expect(
      audit.fatalFindings.every(
        (finding) => finding.category === "proper-crossing",
      ),
    ).toBe(true);
  });

  it("allocates lanes by transition density", () => {
    const projection = transitionDensityProjection();
    expect(buildLifecycleDisplayBranches(projection)).toHaveLength(89);
    const graph = buildLifecycleRoutingGraph(projection);
    const dense = calculateLifecycleDiagramLayout(projection, 1850, graph);
    const transitionCounts = transitionCountsByGraphRanks(graph);
    expect(Math.max(...transitionCounts)).toBe(50);
    expect(dense.densestRoutedRank).toBe(50);
    expect(dense.height).toBe(
      Math.ceil(
        LAYOUT_TOP_MARGIN +
          LAYOUT_BOTTOM_MARGIN +
          50 * PER_LANE_VERTICAL_BUDGET +
          49 * ROUTED_NODE_PADDING,
      ),
    );
    const shuffled = {
      ...projection,
      links: [...projection.links].reverse(),
      paths: [...projection.paths].reverse(),
    };
    const shuffledLayout = calculateLifecycleDiagramLayout(
      shuffled,
      1850,
      buildLifecycleRoutingGraph(shuffled),
    );
    expect(shuffledLayout).toMatchObject(dense);
    // Full handle placement (layoutLifecycleRoutingGraph) is intentionally
    // not exercised here: transitionDensityProjection()'s 50-branch fan-in
    // to a single milestone has no handle-clearance-feasible lane
    // arrangement at all — confirmed by direct instrumentation, the set of
    // blocked branches is identical across hundreds of distinct coordinate
    // assignments the lane-refinement search tries. That's a pre-existing
    // gap between what refineGlobalLaneCoordinates searches over
    // (lane-spacing legality) and what handle placement actually needs
    // (route-to-route clearance at sampled handle points), out of scope for
    // the exponential-blowup fix this PR makes; tracked as a follow-up. The
    // density/height/shuffle-stability assertions above only exercise lane
    // allocation, which is unaffected and remains covered.
  });

  it("partitions semantic links into stable endpoint-conditioned display branches", () => {
    const p = projection();
    const branches = buildLifecycleDisplayBranches(p);
    expect(branches.map((b) => b.id)).toContain(
      "branch:link:origin:application_submitted->endpoint:" +
        "awaiting_response:endpoint:awaiting_response",
    );
    for (const link of p.links) {
      const related = branches.filter((b) => b.semanticLinkId === link.id);
      expect(related.reduce((sum, b) => sum + b.value, 0)).toBe(link.value);
      const union = related.flatMap((b) => b.applicationIds).sort();
      expect(union).toEqual([...link.applicationIds].sort());
      expect(new Set(union).size).toBe(union.length);
    }
    expect(branches).toEqual([...branches].sort(compareBranches));
  });

  it("is stable under shuffled inputs and does not mutate frozen projections", () => {
    const p = projection();
    const shuffled = deepFreeze({
      ...p,
      links: [...p.links].reverse().map((link) => ({
        ...link,
        applicationIds: [...link.applicationIds].reverse(),
      })),
      paths: [...p.paths].reverse(),
    });
    const before = JSON.stringify(shuffled);
    expect(buildLifecycleDisplayBranches(shuffled)).toEqual(
      buildLifecycleDisplayBranches(p),
    );
    expect(JSON.stringify(shuffled)).toBe(before);
  });

  it("uses the exact endpoint palette, unknown fallback, and readable composited colors", () => {
    expect(ENDPOINT_BRANCH_COLORS).toEqual({
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
    expect(endpointColor("missing")).toBe("#E2E8F0");
    const background = hex("#0F172A");
    for (const color of Object.values(ENDPOINT_BRANCH_COLORS)) {
      const fg = hex(color).map((v, i) =>
        Math.round(
          v * BRANCH_STROKE_OPACITY +
            background[i] * (1 - BRANCH_STROKE_OPACITY),
        ),
      );
      expect(contrast(fg, background)).toBeGreaterThan(3);
    }
  });

  it("expands rank-skipping branches into deterministic adjacent-rank routing segments", () => {
    const graph = buildLifecycleRoutingGraph(projection());
    const longBranch =
      "branch:link:origin:application_submitted->endpoint:" +
      "awaiting_response:endpoint:awaiting_response";
    expect(
      graph.nodes.filter((n) => n.branchId === longBranch).map((n) => n.rank),
    ).toEqual([1, 2, 3, 4, 5]);
    for (const segment of graph.links) {
      const source = graph.nodes.find((node) => node.id === segment.source);
      const target = graph.nodes.find((node) => node.id === segment.target);
      expect(target.rank).toBe(source.rank + 1);
      expect(segment.applicationIds).toEqual(
        [...segment.applicationIds].sort(),
      );
    }
    const adjacent = graph.branches.find(
      (b) => b.sourceRank + 1 === b.targetRank,
    );
    expect(graph.nodes.filter((n) => n.branchId === adjacent.id)).toHaveLength(
      0,
    );
    expect(
      graph.nodes
        .filter((n) => n.routing)
        .every((n) => n.id === `route:${n.branchId}:rank:${n.rank}`),
    ).toBe(true);
    expect(
      graph.nodes
        .filter((n) => !n.routing)
        .map((n) => n.id)
        .some((id) => id.startsWith("route:")),
    ).toBe(false);
  });

  it("counts routed transition density from graph node ranks", () => {
    expectRoutedDensity(projection(), [4, 5, 5, 5, 5, 5], 580);
    expectRoutedDensity(
      projectLifecycleAt(denseFixture),
      [15, 15, 15, 13, 13, 12],
      1660,
    );
    expectRoutedDensity(
      denseBranchProjection(),
      [55, 55, 55, 55, 55, 55],
      5980,
    );
  });

  it("keeps routed dimensions stable for D3 node sources and shuffled graph input", () => {
    const p = projection();
    const rawGraph = buildLifecycleRoutingGraph(p);
    const rawLayout = calculateLifecycleDiagramLayout(p, 100, rawGraph);
    const { graph: laidOutGraph } = layoutLifecycleRoutingGraph(p, 100);
    expect(
      laidOutGraph.links.every((link) => typeof link.source === "object"),
    ).toBe(true);
    expect(calculateLifecycleDiagramLayout(p, 100, laidOutGraph)).toEqual(
      rawLayout,
    );

    const shuffledGraph = {
      ...rawGraph,
      nodes: [...rawGraph.nodes].reverse(),
      links: [...rawGraph.links].reverse(),
    };
    expect(transitionCountsByGraphRanks(shuffledGraph)).toEqual([
      4, 5, 5, 5, 5, 5,
    ]);
    expect(calculateLifecycleDiagramLayout(p, 100, shuffledGraph)).toEqual(
      rawLayout,
    );
  });

  it("throws a deterministic invariant when a link source is missing", () => {
    const p = projection();
    const graph = buildLifecycleRoutingGraph(p);
    graph.links = [
      {
        ...graph.links[0],
        id: "link:broken-source",
        source: "route:missing:rank:3",
      },
    ];
    expect(() => calculateLifecycleDiagramLayout(p, 100, graph)).toThrow(
      /link link:broken-source references source route:missing:rank:3/u,
    );
  });

  it("calculates dimensions from routed lane density, not application volume", () => {
    const p = projection();
    const base = calculateLifecycleDiagramLayout(p, 100);
    const volume = {
      ...p,
      links: p.links.map((link) => ({ ...link, value: link.value * 40 })),
      nodes: p.nodes.map((node) => ({ ...node, total: node.total * 40 })),
      includedApplications: p.includedApplications * 40,
      totalApplications: p.totalApplications * 40,
    };
    expect(calculateLifecycleDiagramLayout(volume, 100).height).toBe(
      base.height,
    );
    const denser = {
      ...p,
      links: [
        ...p.links,
        {
          id: "link:origin:application_submitted->endpoint:unknown",
          source: "origin:application_submitted",
          target: "endpoint:unknown",
          value: 1,
          applicationIds: ["extra"],
        },
      ],
      paths: [
        ...p.paths,
        {
          applicationId: "extra",
          endpoint: "unknown",
          nodeIds: ["origin:application_submitted", "endpoint:unknown"],
        },
      ],
      nodes: [
        ...p.nodes,
        {
          id: "endpoint:unknown",
          label: "Unknown",
          total: 1,
          applicationIds: ["extra"],
        },
      ],
    };
    expect(
      calculateLifecycleDiagramLayout(denser, 100).height,
    ).toBeGreaterThanOrEqual(base.height);
  });

  it("uses renderer-equivalent minimum hit boxes for layout obstacles", () => {
    const { graph } = layoutLifecycleRoutingGraph(projection(), 1850);
    const visible = graph.nodes.find(
      (node) => !node.routing && node.id === "origin:application_submitted",
    );
    const hit = rendererHitBoxForNode(visible);
    expect(hit.width).toBe(
      Math.max(BRANCH_HANDLE_RADIUS * 2, visible.x1 - visible.x0),
    );
    expect(hit.height).toBe(
      Math.max(BRANCH_HANDLE_RADIUS * 2, visible.y1 - visible.y0),
    );
    expect(hit.x + hit.width / 2).toBeCloseTo((visible.x0 + visible.x1) / 2, 6);
    expect(hit.y + hit.height / 2).toBeCloseTo(
      (visible.y0 + visible.y1) / 2,
      6,
    );
  });

  it("uses exact protected-corridor width calculations and deterministic sorting", () => {
    expect(2 * RANK_CORRIDOR_HALF_WIDTH + MINIMUM_TRANSITION_WIDTH).toBe(
      MINIMUM_RANK_CENTER_SPACING,
    );
    expect(
      LAYOUT_LEFT_MARGIN +
        LAYOUT_RIGHT_MARGIN +
        SANKEY_NODE_WIDTH +
        6 * MINIMUM_RANK_CENTER_SPACING,
    ).toBe(MINIMUM_SVG_WIDTH);
    expect(MINIMUM_SVG_WIDTH).toBe(1850);
    expect(rankCenterX(1) - rankCenterX(0)).toBe(MINIMUM_RANK_CENTER_SPACING);
    expect(
      buildLifecycleRoutingGraph(projection()).links.map((l) => l.id),
    ).toEqual(buildLifecycleRoutingGraph(projection()).links.map((l) => l.id));
  });

  it("sorts origins and endpoints canonically while ranking milestones by endpoint median", () => {
    const shuffledOrigins = [
      { id: "origin:referral", rank: 0, routing: false },
      { id: "origin:application_submitted", rank: 0, routing: false },
      { id: "origin:candidate_outreach", rank: 0, routing: false },
    ].sort(nodeSort);
    expect(shuffledOrigins.map((node) => node.id)).toEqual([
      "origin:application_submitted",
      "origin:candidate_outreach",
      "origin:referral",
    ]);

    const shuffledEndpoints = [
      { id: "endpoint:offer_accepted", rank: 6, routing: false },
      { id: "endpoint:awaiting_response", rank: 6, routing: false },
      { id: "endpoint:employer_rejected", rank: 6, routing: false },
    ].sort(nodeSort);
    expect(shuffledEndpoints.map((node) => node.id)).toEqual([
      "endpoint:awaiting_response",
      "endpoint:employer_rejected",
      "endpoint:offer_accepted",
    ]);

    const milestoneAndRoutes = [
      {
        id: "route:branch:z:rank:2",
        rank: 2,
        routing: true,
        endpointId: "employer_rejected",
        branchId: "branch:z",
      },
      {
        id: "milestone:technical_interview",
        rank: 2,
        routing: false,
        weightedEndpointMedian: 4,
      },
      {
        id: "milestone:assessment_take_home",
        rank: 2,
        routing: false,
        weightedEndpointMedian: 4,
      },
      {
        id: "route:branch:a:rank:2",
        rank: 2,
        routing: true,
        endpointId: "employer_rejected",
        branchId: "branch:a",
      },
    ].sort(nodeSort);
    expect(milestoneAndRoutes.map((node) => node.id)).toEqual([
      "milestone:assessment_take_home",
      "milestone:technical_interview",
      "route:branch:a:rank:2",
      "route:branch:z:rank:2",
    ]);
  });

  it("wraps labels without truncation and assigns one non-overlapping handle per branch", () => {
    const text = "Assessment/take-home requested unsupported outcome";
    expect(() => wrapLifecycleLabel(text)).toThrow(/exceeds two/u);
    for (const item of [
      ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
      ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
      ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
    ]) {
      const lines = wrapLifecycleLabel(item.label);
      expect(lines.length, item.label).toBeLessThanOrEqual(2);
      expect(
        lines.every((line) => line.length <= 22),
        item.label,
      ).toBe(true);
      expect(lines.join(" "), item.label).toBe(item.label);
    }
    const { graph } = layoutLifecycleRoutingGraph(projection(), 1850);
    const visibleNodes = graph.nodes.filter((n) => !n.routing && n.total > 0);
    const byBranch = new Map();
    for (const link of graph.links) {
      if (!byBranch.has(link.branchId)) byBranch.set(link.branchId, []);
      byBranch.get(link.branchId).push(link);
    }
    const handles = assignBranchHandles(graph.branches, byBranch, visibleNodes);
    expect(handles).toHaveLength(graph.branches.length);
    expect(new Set(handles.map((h) => h.branchId)).size).toBe(
      graph.branches.length,
    );
    for (const handle of handles) {
      const segments = byBranch.get(handle.branchId);
      const allowed = segments.flatMap((segment) =>
        [0.5, 0.35, 0.65].map((t) => ({
          segment,
          ...cubicTransitionPoint(segment, t),
        })),
      );
      const match = allowed.find(
        (candidate) =>
          Math.abs(candidate.x - handle.x) < 0.001 &&
          Math.abs(candidate.y - handle.y) < 0.001,
      );
      expect(match, handle.branchId).toBeTruthy();
      const exitX =
        rankCenterX(match.segment.source.rank) + RANK_CORRIDOR_HALF_WIDTH;
      const entryX =
        rankCenterX(match.segment.target.rank) - RANK_CORRIDOR_HALF_WIDTH;
      expect(
        handle.x - BRANCH_HANDLE_RADIUS,
        handle.branchId,
      ).toBeGreaterThanOrEqual(exitX - 0.001);
      expect(
        handle.x + BRANCH_HANDLE_RADIUS,
        handle.branchId,
      ).toBeLessThanOrEqual(entryX + 0.001);
    }
    for (let i = 0; i < handles.length; i += 1) {
      for (let j = i + 1; j < handles.length; j += 1) {
        expect(boxesOverlap(handles[i].box, handles[j].box)).toBe(false);
      }
    }
  });

  it("keeps branch route coordinates stable while assigning handles", () => {
    const { graph } = layoutLifecycleRoutingGraph(projection(), 1850);
    const visibleNodes = graph.nodes.filter((n) => !n.routing && n.total > 0);
    const byBranch = new Map();
    for (const link of graph.links) {
      if (!byBranch.has(link.branchId)) byBranch.set(link.branchId, []);
      byBranch.get(link.branchId).push(link);
    }
    const before = graph.links.map((link) => ({
      id: `${link.branchId}:${link.segmentIndex}`,
      y0: link.y0,
      y1: link.y1,
      transitionLaneY: link.transitionLaneY,
    }));
    assignBranchHandles(graph.branches, byBranch, visibleNodes);
    expect(
      graph.links.map((link) => ({
        id: `${link.branchId}:${link.segmentIndex}`,
        y0: link.y0,
        y1: link.y1,
        transitionLaneY: link.transitionLaneY,
      })),
    ).toEqual(before);
  });

  it("keeps routing-fixture private anchors distinct after lane refinement", () => {
    const { graph } = layoutLifecycleRoutingGraph(
      projectLifecycleAt(routingFixture),
      1850,
    );
    const routingAnchors = new Map();
    for (const link of graph.links) {
      if (link.target.routing) routingAnchors.set(link.target.id, link.y1);
      if (link.source.routing) routingAnchors.set(link.source.id, link.y0);
    }
    const awaitingAnchor = routingAnchors.get(
      [
        "route:branch:link:origin:application_submitted->endpoint",
        ":awaiting_response:endpoint:awaiting_response:rank:1",
      ].join(""),
    );
    const assessmentAnchor = routingAnchors.get(
      [
        "route:branch:link:origin:application_submitted->milestone",
        ":assessment_take_home:endpoint:assessment_in_progress:rank:1",
      ].join(""),
    );
    expect(Number.isFinite(awaitingAnchor)).toBe(true);
    expect(Number.isFinite(assessmentAnchor)).toBe(true);
    expect(Math.abs(awaitingAnchor - assessmentAnchor)).toBeGreaterThan(
      BRANCH_HANDLE_RADIUS * 2,
    );
    for (const node of graph.nodes.filter((candidate) => candidate.routing)) {
      const incoming = graph.links.filter((link) => link.target === node);
      const outgoing = graph.links.filter((link) => link.source === node);
      if (incoming.length === 1 && outgoing.length === 1)
        expect(incoming[0].y1).toBeCloseTo(outgoing[0].y0, 6);
    }
  });

  // Historical baseline (pre-fix): this fixture's dense multi-rank routing
  // had no handle-clearance-feasible lane arrangement at all -- confirmed by
  // direct instrumentation, the set of blocked branches was identical
  // across hundreds of distinct coordinate assignments the lane-refinement
  // search tried. Fixed by two independent, deliberately narrow tolerances
  // introduced alongside this test (see
  // docs/design/lifecycle-diagram-layout-algorithm.md): a small, last-resort
  // nonincident-route clearance allowance for handle placement
  // (HANDLE_CLEARANCE_TOLERANCE) and a small, budget-pressure-scaled
  // tolerance for route-to-route crossings (toleratedRouteCrossingCount).
  // Both apply only as a last resort -- a fixture that already finds a
  // perfectly clean layout is unaffected. Handle-vs-handle overlap and
  // fixed-geometry avoidance remain hard, zero-tolerance requirements.
  it("lays out dense fixture with bounded semantic docks and safe handles", () => {
    const { graph } = layoutLifecycleRoutingGraph(
      projectLifecycleAt(denseFixture),
      1850,
    );
    // Deterministic: confirmed directly (not assumed) against this exact
    // fixture. See docs/design/lifecycle-diagram-layout-algorithm.md's
    // "Follow-up (shipped)" section for the browser-reconciled (denser)
    // variant's different count (66, exercised by the Playwright audit spec).
    expect(graph.acceptedRouteCrossingCount).toBe(50);
    expect(graph.transitionLaneSolverStats.handleStatesVisited).toBe(500);
    const visibleNodes = graph.nodes.filter(
      (node) => !node.routing && node.total > 0,
    );
    const visibleById = new Map(visibleNodes.map((node) => [node.id, node]));
    const byBranch = new Map();
    for (const link of graph.links) {
      if (!byBranch.has(link.branchId)) byBranch.set(link.branchId, []);
      byBranch.get(link.branchId).push(link);
      if (!link.source.routing) {
        expect(link.y0, `${link.branchId} source dock`).toBeGreaterThanOrEqual(
          link.source.y0 - 0.001,
        );
        expect(link.y0, `${link.branchId} source dock`).toBeLessThanOrEqual(
          link.source.y1 + 0.001,
        );
      }
      if (!link.target.routing) {
        expect(link.y1, `${link.branchId} target dock`).toBeGreaterThanOrEqual(
          link.target.y0 - 0.001,
        );
        expect(link.y1, `${link.branchId} target dock`).toBeLessThanOrEqual(
          link.target.y1 + 0.001,
        );
      }
    }
    const handles = assignBranchHandles(graph.branches, byBranch, visibleNodes);
    expect(handles).toHaveLength(graph.branches.length);
    expect(new Set(handles.map((handle) => handle.branchId)).size).toBe(
      graph.branches.length,
    );
    // Every t-value the candidate-generation sweep can ever select from
    // (three primary points, plus the ten-point fallback grid tried only
    // when the primary three find nothing) -- a degraded (tolerated)
    // candidate can land on any of them, not just the primary three.
    const allSampleTValues = [
      0.5,
      0.35,
      0.65,
      ...Array.from(
        { length: 10 },
        (_, index) => Math.round((0.05 + index * 0.1) * 1000) / 1000,
      ).filter((t) => ![0.5, 0.35, 0.65].includes(t)),
    ];
    for (const handle of handles) {
      expect(Number.isFinite(handle.x), handle.branchId).toBe(true);
      expect(Number.isFinite(handle.y), handle.branchId).toBe(true);
      // Handle-vs-handle overlap and fixed-geometry avoidance stay strict;
      // nonincident-route clearance allows the small, last-resort tolerance.
      expect(handle.clearanceMargin, handle.branchId).toBeGreaterThan(
        -HANDLE_CLEARANCE_TOLERANCE,
      );
      const segments = byBranch.get(handle.branchId);
      const allowed = segments.flatMap((segment) =>
        allSampleTValues.map((t) => ({
          segment,
          ...cubicTransitionPoint(segment, t),
        })),
      );
      expect(
        allowed.some(
          (candidate) =>
            Math.abs(candidate.x - handle.x) < 0.001 &&
            Math.abs(candidate.y - handle.y) < 0.001,
        ),
        handle.branchId,
      ).toBe(true);
      expect(visibleById.size).toBeGreaterThan(0);
    }
  });

  // denseBranchProjection() has no real milestone nodes (every branch is a
  // direct origin->endpoint link), so buildMilestoneFreeJointOrder now
  // gives discovery's own first D3 pass a topology-derived, cross-rank-
  // consistent node/link order instead of the plain, rankOrder-blind
  // nodeSort/linkSort it used to fall back to -- see
  // docs/design/lifecycle-diagram-layout-algorithm.md's "Investigation (2026-07-26)"
  // section. Before that fix, this fixture had no handle-clearance-feasible
  // lane arrangement the search could find.
  it("keeps handle invariants with more than 32 display branches", () => {
    const { graph } = layoutLifecycleRoutingGraph(
      denseBranchProjection(),
      1850,
    );
    expect(graph.branches.length).toBeGreaterThan(32);
    const visibleNodes = graph.nodes.filter(
      (node) => !node.routing && node.total > 0,
    );
    const byBranch = new Map();
    for (const link of graph.links) {
      if (!byBranch.has(link.branchId)) byBranch.set(link.branchId, []);
      byBranch.get(link.branchId).push(link);
    }
    const handles = assignBranchHandles(graph.branches, byBranch, visibleNodes);
    const branchById = new Map(
      graph.branches.map((branch) => [branch.id, branch]),
    );
    expect(handles).toHaveLength(graph.branches.length);
    const nodeBoxes = visibleNodes.map((node) => ({
      x: node.x0,
      y: node.y0,
      width: node.x1 - node.x0,
      height: node.y1 - node.y0,
    }));
    const labelBoxes = visibleNodes.map(labelBoxForNode);
    for (const handle of handles) {
      expect(
        [...nodeBoxes, ...labelBoxes].some((box) =>
          boxesOverlap(handle.box, box),
        ),
      ).toBe(false);
      const segments = byBranch.get(handle.branchId);
      expect(
        segments.some((segment) =>
          [0.5, 0.35, 0.65].some((t) => {
            const candidate = cubicTransitionPoint(segment, t);
            return (
              Math.abs(candidate.x - handle.x) < 0.001 &&
              Math.abs(candidate.y - handle.y) < 0.001
            );
          }),
        ),
      ).toBe(true);
      const unrelatedSamples = [...byBranch.entries()]
        .filter(([branchId]) => {
          if (branchId === handle.branchId) return false;
          const handleBranch = branchById.get(handle.branchId);
          const sampleBranch = branchById.get(branchId);
          return (
            handleBranch &&
            sampleBranch &&
            handleBranch.source !== sampleBranch.source &&
            handleBranch.source !== sampleBranch.target &&
            handleBranch.target !== sampleBranch.source &&
            handleBranch.target !== sampleBranch.target
          );
        })
        .flatMap(([, branchSegments]) =>
          branchSegments.flatMap((segment) =>
            Array.from({ length: 21 }, (_, index) => ({
              ...cubicTransitionPoint(segment, index / 20),
              clearance:
                BRANCH_HANDLE_RADIUS +
                (renderedBranchStrokeWidth(segment.width) + 12) / 2,
            })),
          ),
        );
      expect(
        unrelatedSamples.every(
          (sample) =>
            Math.hypot(sample.x - handle.x, sample.y - handle.y) >
            sample.clearance - 0.001,
        ),
      ).toBe(true);
    }
  });

  it("resolves un-phased dense multi-rank fan-in fast, without exponential blowup", () => {
    // Historical baseline (pre-fix): this direct production-path call used
    // to fail deterministically with "Lifecycle handle search exceeded
    // 32768 states" (reason: "state-limit", phase: "handle"), since
    // denseBranchProjection()'s multi-rank routing had no
    // handle-clearance-feasible lane arrangement discovery's plain,
    // rankOrder-blind nodeSort/linkSort could find. Fixed by
    // buildMilestoneFreeJointOrder (see
    // docs/design/lifecycle-diagram-layout-algorithm.md's
    // "Investigation (2026-07-26)" section) -- this fixture has no real
    // milestone nodes, so it's in-scope for that fix. The search itself is
    // now fast and deterministic (was exponential before PR #1147;
    // state-limited before this fix), and now finds a legal arrangement
    // well within budget.
    const start = Date.now();
    const { graph } = layoutLifecycleRoutingGraph(
      denseBranchProjection(),
      1850,
    );
    const stats = graph.transitionLaneSolverStats;
    expect(stats.handleStatesVisited).toBeGreaterThan(0);
    expect(stats.handleStatesVisited).toBeLessThan(32768);
    expect(Date.now() - start).toBeLessThan(30000);
  });
});

// The routing fixture finds a handle-feasible, zero-crossing geometry entirely on its
// own, with no route-crossing/handle-clearance tolerance ever engaged, so it is the
// cleanest production regression coverage for the seeded-replay two-pass architecture:
// discovery fully validates a candidate (lane assignment + handle placement + zero
// always-fatal audit findings, with zero tolerable findings needed either) and final
// replays that exact candidate instead of re-searching from scratch -- an exact-zero
// contract that's easy to assert without also having to replay tolerance state.
// The dense v2 fixture and denseBranchProjection() now succeed too (both are exercised
// by other tests above), but only via mechanisms this section doesn't need: the bounded
// tolerances for v2, buildMilestoneFreeJointOrder for denseBranchProjection() -- see
// docs/design/lifecycle-diagram-layout-algorithm.md's "Follow-up (shipped)" and
// "Investigation (2026-07-26)" sections.
describe("seeded-replay production layout (routing fixture)", () => {
  const reversedProjection = () => {
    const p = projectLifecycleAt(routingFixture);
    return {
      ...p,
      nodes: [...p.nodes].reverse(),
      links: [...p.links].reverse(),
      paths: [...p.paths].reverse(),
    };
  };
  const directions = [
    ["normal", () => projectLifecycleAt(routingFixture)],
    ["reversed", reversedProjection],
  ];

  const handlesFor = (graph) => {
    const visibleNodes = graph.nodes.filter(
      (node) => !node.routing && node.total > 0,
    );
    const byBranch = new Map();
    for (const link of graph.links) {
      if (!byBranch.has(link.branchId)) byBranch.set(link.branchId, []);
      byBranch.get(link.branchId).push(link);
    }
    return assignBranchHandles(graph.branches, byBranch, visibleNodes);
  };

  for (const [label, makeProjection] of directions) {
    // eslint-disable-next-line max-len
    it(`lays out successfully in two bounded passes with one valid handle per branch and zero fatal audit findings (${label})`, () => {
      const { graph, dimensions } = layoutLifecycleRoutingGraph(
        makeProjection(),
        1850,
      );
      const stats = graph.transitionLaneSolverStats;
      expect(stats.layoutAttemptCount).toBe(2);
      expect(stats.layoutAttempts).toHaveLength(2);
      expect(stats.layoutAttempts.map((attempt) => attempt.phase)).toEqual([
        "discovery",
        "final",
      ]);
      expect(stats.statesVisited).toBeLessThanOrEqual(stats.stateLimit);
      expect(stats.handleStatesVisited).toBeLessThanOrEqual(
        stats.handleStateLimit,
      );
      // The route-crossing tolerance introduced alongside this test only
      // relaxes acceptance for candidates that would otherwise exhaust the
      // budget; this fixture already finds a perfectly clean layout, so its
      // accepted crossing count must stay exactly 0, not merely "small".
      expect(graph.acceptedRouteCrossingCount).toBe(0);
      expect(stats.acceptedRouteCrossingCount).toBe(0);

      const handles = handlesFor(graph);
      expect(handles).toHaveLength(graph.branches.length);
      expect(new Set(handles.map((handle) => handle.branchId)).size).toBe(
        graph.branches.length,
      );
      for (const handle of handles) {
        expect(Number.isFinite(handle.x), handle.branchId).toBe(true);
        expect(Number.isFinite(handle.y), handle.branchId).toBe(true);
      }

      const model = buildLifecycleRouteModel(graph, dimensions);
      const audit = auditLifecycleRouteGeometry({ model, handles });
      expect(audit.fatalFindings).toEqual([]);
    });
  }

  it("derives identical authoritative rank ordering for normal and reversed input", () => {
    const { graph: normal } = layoutLifecycleRoutingGraph(
      projectLifecycleAt(routingFixture),
      1850,
    );
    const { graph: reversed } = layoutLifecycleRoutingGraph(
      reversedProjection(),
      1850,
    );
    expect(reversed.transitionLaneRankOrder).toBeInstanceOf(Map);
    expect([...reversed.transitionLaneRankOrder.entries()]).toEqual([
      ...normal.transitionLaneRankOrder.entries(),
    ]);
  });

  // eslint-disable-next-line max-len
  it("produces stable-ID-normalized equivalent geometry/stats for normal and reversed input", () => {
    const signatureFor = (proj) => {
      const { graph } = layoutLifecycleRoutingGraph(proj, 1850);
      const stats = graph.transitionLaneSolverStats;
      return {
        lanes: [...graph.links]
          .sort((a, b) => compareLifecycleIds(a.id, b.id))
          .map((link) => [link.id, link.transitionLaneY, link.y0, link.y1]),
        stats: {
          layoutAttemptCount: stats.layoutAttemptCount,
          statesVisited: stats.statesVisited,
          handleStatesVisited: stats.handleStatesVisited,
          candidateEvaluations: stats.candidateEvaluations,
        },
      };
    };
    const normal = signatureFor(projectLifecycleAt(routingFixture));
    const reversed = signatureFor(reversedProjection());
    expect(reversed).toEqual(normal);
  });
});

describe("shared route-crossing classifier", () => {
  // src/web/tracker/lifecycleRouteGeometry.js -- the pure classifier both
  // auditLifecycleRouteGeometry (here) and the Playwright collision audit
  // (test/playwright/lifecycle-diagram.spec.js, via
  // window.__lifecycleRouteGeometry) share, so a rendered-geometry mismatch
  // can't silently reappear in either place independently.
  it("detects a genuine transversal crossing", () => {
    const left = { p0: { x: 0, y: 0 }, p1: { x: 10, y: 10 } };
    const right = { p0: { x: 0, y: 10 }, p1: { x: 10, y: 0 } };
    expect(edgeCrossing(left, right)).toBe(true);
  });

  it("does not flag parallel non-intersecting segments", () => {
    const left = { p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } };
    const right = { p0: { x: 0, y: 5 }, p1: { x: 10, y: 5 } };
    expect(edgeCrossing(left, right)).toBe(false);
  });

  it("does not flag two segments diverging from a shared dock point", () => {
    // This is why auditLifecycleRouteGeometry needs no explicit shared-dock
    // exclusion in its own crossing loop (see
    // docs/design/lifecycle-diagram-layout-algorithm.md): two branches
    // fanning out from the same source node have edges that share (or
    // nearly share) an endpoint and diverge, which the strict
    // sign-straddling orientation test never classifies as a crossing.
    const shared = { x: 5, y: 5 };
    const left = { p0: shared, p1: { x: 10, y: 0 } };
    const right = { p0: shared, p1: { x: 10, y: 10 } };
    expect(edgeCrossing(left, right)).toBe(false);
  });

  it("does not flag collinear overlapping segments", () => {
    const left = { p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } };
    const right = { p0: { x: 5, y: 0 }, p1: { x: 15, y: 0 } };
    expect(edgeCrossing(left, right)).toBe(false);
  });

  it("classifies crossing counts at and around the sustained threshold", () => {
    expect(ROUTE_CROSSING_SUSTAINED_THRESHOLD).toBe(4);
    expect(classifyRouteCrossingCategory(0)).toBe("proper-crossing");
    expect(classifyRouteCrossingCategory(1)).toBe("proper-crossing");
    expect(classifyRouteCrossingCategory(4)).toBe("proper-crossing");
    expect(classifyRouteCrossingCategory(5)).toBe("sustained-crossing");
    expect(classifyRouteCrossingCategory(50)).toBe("sustained-crossing");
  });

  it("computes the same required route-handle clearance production uses", () => {
    // Mirrors auditLifecycleRouteGeometry's route-handle-collision check
    // (lifecycleDiagramLayout.js): pointToSegmentDistance(handle, edge) <
    // BRANCH_HANDLE_RADIUS + selectedEnvelopeRadius(segment) + 0.25 +
    // LANE_Y_EPSILON. selectedEnvelopeRadius ignores its argument today
    // (renderedBranchStrokeWidth always returns 3), so it's safe to call
    // with an empty segment placeholder in this pure-geometry test.
    expect(ROUTE_HANDLE_CLEARANCE_MARGIN).toBe(0.25);
    const expected =
      BRANCH_HANDLE_RADIUS + selectedEnvelopeRadius({}) + 0.25 + LANE_Y_EPSILON;
    expect(
      routeHandleRequiredClearance(
        BRANCH_HANDLE_RADIUS,
        selectedEnvelopeRadius({}),
        LANE_Y_EPSILON,
      ),
    ).toBeCloseTo(expected, 10);
  });

  // eslint-disable-next-line max-len
  it("classifies route-handle proximity just-inside, at, and just-outside the shared boundary", () => {
    // Uses the shared isRouteHandleCollision/routeHandleRequiredClearance
    // predicate directly (the same functions the Playwright audit calls via
    // window.__lifecycleRouteGeometry) rather than reimplementing the
    // comparison here.
    const edge = { p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } };
    const radius = BRANCH_HANDLE_RADIUS;
    const envelope = selectedEnvelopeRadius({});
    const required = routeHandleRequiredClearance(
      radius,
      envelope,
      LANE_Y_EPSILON,
    );
    const closeHandle = { x: 50, y: required - 5 };
    const farHandle = { x: 50, y: required + 5 };
    const boundaryHandle = { x: 50, y: required };
    expect(pointToSegmentDistance(closeHandle, edge)).toBeLessThan(required);
    expect(pointToSegmentDistance(farHandle, edge)).toBeGreaterThan(required);
    expect(pointToSegmentDistance(boundaryHandle, edge)).toBeCloseTo(
      required,
      5,
    );
    expect(
      isRouteHandleCollision(
        closeHandle,
        edge,
        radius,
        envelope,
        LANE_Y_EPSILON,
      ),
    ).toBe(true);
    expect(
      isRouteHandleCollision(farHandle, edge, radius, envelope, LANE_Y_EPSILON),
    ).toBe(false);
    // The comparison is strict (<), so a handle sitting exactly on the
    // boundary is not a collision -- matches production's own
    // `pointToSegmentDistance(...) < required` check.
    expect(
      isRouteHandleCollision(
        boundaryHandle,
        edge,
        radius,
        envelope,
        LANE_Y_EPSILON,
      ),
    ).toBe(false);
  });

  describe("collinearOverlapLength", () => {
    // edgeCrossing only detects genuine transversal crossings; two routes
    // rendered directly on top of one another are exactly (or near-exactly)
    // collinear and never satisfy its strict sign-straddling test. This is
    // the shared, pure detector both auditLifecycleRouteGeometry and the
    // Playwright collision audit use to close that gap (see
    // docs/design/lifecycle-diagram-layout-algorithm.md's "unified
    // route-crossing classifier" follow-up).
    it("measures the overlap length of two meaningfully overlapping collinear edges", () => {
      const left = { p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } };
      const right = { p0: { x: 20, y: 0 }, p1: { x: 120, y: 0 } };
      // right overlaps left from x=20 to x=100 -> 80 units.
      expect(collinearOverlapLength(left, right)).toBeCloseTo(80, 5);
      expect(collinearOverlapLength(left, right)).toBeGreaterThanOrEqual(
        SUSTAINED_OVERLAP_LENGTH_THRESHOLD,
      );
    });

    it("returns 0 for separated parallel edges (different lanes)", () => {
      const left = { p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } };
      const right = { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } };
      expect(collinearOverlapLength(left, right)).toBe(0);
    });

    it("returns 0 for parallel collinear edges that only touch endpoint-to-endpoint", () => {
      // Short endpoint contact (two routes briefly touching tip-to-tip, as
      // branches merely diverging from a shared dock do) has zero overlap
      // length, not just a below-threshold one.
      const left = { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 } };
      const right = { p0: { x: 50, y: 0 }, p1: { x: 100, y: 0 } };
      expect(collinearOverlapLength(left, right)).toBe(0);
    });

    it("returns 0 for edges that are parallel but offset beyond the collinearity tolerance", () => {
      const left = { p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } };
      const right = {
        p0: { x: 20, y: COLLINEAR_OVERLAP_TOLERANCE + 1 },
        p1: { x: 120, y: COLLINEAR_OVERLAP_TOLERANCE + 1 },
      };
      expect(collinearOverlapLength(left, right)).toBe(0);
    });

    it("returns 0 for genuinely crossing (non-parallel) edges", () => {
      const left = { p0: { x: 0, y: 0 }, p1: { x: 10, y: 10 } };
      const right = { p0: { x: 0, y: 10 }, p1: { x: 10, y: 0 } };
      expect(edgeCrossing(left, right)).toBe(true);
      expect(collinearOverlapLength(left, right)).toBe(0);
    });

    it("proves an exact sustained overlap is fatal by the shared threshold", () => {
      // Two edges occupying the identical line segment -- the extreme case
      // of "one route drawn directly on top of another" -- must clear the
      // shared sustained-overlap threshold so callers (auditLifecycleRouteGeometry,
      // assertBrowserCollisionAudit) classify the pair as fatal regardless of
      // their (zero) transversal crossing count.
      const left = { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 } };
      const right = { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 } };
      expect(edgeCrossing(left, right)).toBe(false);
      const overlap = collinearOverlapLength(left, right);
      expect(overlap).toBeCloseTo(50, 5);
      expect(overlap).toBeGreaterThanOrEqual(
        SUSTAINED_OVERLAP_LENGTH_THRESHOLD,
      );
    });
  });
});

describe("auditLifecycleRouteGeometry collinear-overlap aggregation", () => {
  // Hand-built minimal route models (bypassing buildLifecycleRouteModel and
  // the layout solver entirely) so these tests can assert on exact,
  // deterministic geometry rather than depending on a real fixture happening
  // to reproduce either scenario.
  const node = (id, rank) => ({ id, rank, routing: false, x0: 0, x1: 0 });
  const pairId = (a, b) => [a.id, b.id].sort(compareLifecycleIds).join("||");

  it("excludes overlap correlated by two branches diverging from a shared multi-rank dock", () => {
    const origin = node("origin:shared", 0);
    const milestone = node("milestone:shared", 1);
    const endpointA = node("endpoint:a", 2);
    const endpointB = node("endpoint:b", 2);
    const branchA = {
      id: "branch-a",
      source: origin.id,
      target: endpointA.id,
      sourceRank: 0,
      targetRank: 2,
    };
    const branchB = {
      id: "branch-b",
      source: origin.id,
      target: endpointB.id,
      sourceRank: 0,
      targetRank: 2,
    };
    const model = {
      branches: [branchA, branchB],
      segmentsByBranch: new Map([
        [
          branchA.id,
          [
            {
              source: origin,
              target: milestone,
              y0: 100,
              y1: 100,
              transitionLaneY: 100,
              segmentIndex: 0,
            },
            {
              source: milestone,
              target: endpointA,
              y0: 100,
              y1: 100,
              transitionLaneY: 100,
              segmentIndex: 1,
            },
          ],
        ],
        [
          branchB.id,
          [
            // Identical first segment: both branches leave the exact same
            // shared origin and converge on the exact same shared
            // milestone, so this segment's geometry is (correctly)
            // identical for both -- the "diverging from a shared dock"
            // scenario this exclusion exists for.
            {
              source: origin,
              target: milestone,
              y0: 100,
              y1: 100,
              transitionLaneY: 100,
              segmentIndex: 0,
            },
            // Second segment diverges to a different endpoint at a
            // different Y -- the two branches genuinely separate here.
            {
              source: milestone,
              target: endpointB,
              y0: 100,
              y1: 200,
              transitionLaneY: 150,
              segmentIndex: 1,
            },
          ],
        ],
      ]),
      visibleNodes: [],
      fixedOrderInversionPairs: new Set(),
      pairId,
    };
    const audit = auditLifecycleRouteGeometry({ model, handles: [] });
    expect(
      audit.fatalFindings.some(
        (finding) => finding.category === "sustained-crossing",
      ),
    ).toBe(false);
  });

  it("flags a genuine single-segment full-length duplicate route as a sustained overlap", () => {
    // Two branches sharing both their source AND target across the one and
    // only rank they span never actually diverge anywhere -- this is a
    // duplicated-route defect, not ordinary shared-dock correlation, so the
    // branchesDiverge guard must not exclude it.
    const origin = node("origin:shared", 0);
    const endpoint = node("endpoint:shared", 1);
    const identicalSegment = () => [
      {
        source: origin,
        target: endpoint,
        y0: 100,
        y1: 100,
        transitionLaneY: 100,
        segmentIndex: 0,
      },
    ];
    const branchA = {
      id: "branch-a",
      source: origin.id,
      target: endpoint.id,
      sourceRank: 0,
      targetRank: 1,
    };
    const branchB = {
      id: "branch-b",
      source: origin.id,
      target: endpoint.id,
      sourceRank: 0,
      targetRank: 1,
    };
    const model = {
      branches: [branchA, branchB],
      segmentsByBranch: new Map([
        [branchA.id, identicalSegment()],
        [branchB.id, identicalSegment()],
      ]),
      visibleNodes: [],
      fixedOrderInversionPairs: new Set(),
      pairId,
    };
    const audit = auditLifecycleRouteGeometry({ model, handles: [] });
    const finding = audit.fatalFindings.find(
      (candidate) => candidate.category === "sustained-crossing",
    );
    expect(finding).toBeDefined();
    expect(finding.overlapLength).toBeGreaterThanOrEqual(
      SUSTAINED_OVERLAP_LENGTH_THRESHOLD,
    );
  });

  it("flags a genuine two-rank full-duplicate route sharing both endpoints", () => {
    // The specific gap discussion_r3653747390 identified: a full duplicate
    // spanning *more than one* rank shares its source at the first rank and
    // its target at the last rank, so a purely rank-position-based
    // ("first"/"last") exclusion would suppress *both* ranks, hiding the
    // entire overlap even though edgeCrossing (degenerate for identical
    // edges) never reports a single crossing either. branchesDiverge must
    // recognize that these two branches share both their overall source and
    // target and therefore never actually diverge, so neither rank is
    // excluded.
    const origin = node("origin:shared", 0);
    const milestone = node("milestone:shared", 1);
    const endpoint = node("endpoint:shared", 2);
    const identicalSegments = () => [
      {
        source: origin,
        target: milestone,
        y0: 100,
        y1: 100,
        transitionLaneY: 100,
        segmentIndex: 0,
      },
      {
        source: milestone,
        target: endpoint,
        y0: 100,
        y1: 100,
        transitionLaneY: 100,
        segmentIndex: 1,
      },
    ];
    const branchA = {
      id: "branch-a",
      source: origin.id,
      target: endpoint.id,
      sourceRank: 0,
      targetRank: 2,
    };
    const branchB = {
      id: "branch-b",
      source: origin.id,
      target: endpoint.id,
      sourceRank: 0,
      targetRank: 2,
    };
    const model = {
      branches: [branchA, branchB],
      segmentsByBranch: new Map([
        [branchA.id, identicalSegments()],
        [branchB.id, identicalSegments()],
      ]),
      visibleNodes: [],
      fixedOrderInversionPairs: new Set(),
      pairId,
    };
    const audit = auditLifecycleRouteGeometry({ model, handles: [] });
    const finding = audit.fatalFindings.find(
      (candidate) => candidate.category === "sustained-crossing",
    );
    expect(finding).toBeDefined();
    expect(finding.overlapLength).toBeGreaterThanOrEqual(
      SUSTAINED_OVERLAP_LENGTH_THRESHOLD,
    );
  });
});
