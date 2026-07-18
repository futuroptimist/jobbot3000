import { describe, expect, it } from "vitest";
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
  ENDPOINT_BRANCH_COLORS,
  LAYOUT_LEFT_MARGIN,
  LAYOUT_RIGHT_MARGIN,
  MINIMUM_RANK_CENTER_SPACING,
  MINIMUM_SVG_WIDTH,
  MINIMUM_TRANSITION_WIDTH,
  RANK_CORRIDOR_HALF_WIDTH,
  SANKEY_NODE_WIDTH,
  assignBranchHandles,
  buildLifecycleDisplayBranches,
  buildLifecycleRoutingGraph,
  calculateLifecycleDiagramLayout,
  compareBranches,
  cubicTransitionPoint,
  endpointColor,
  layoutLifecycleRoutingGraph,
  labelBoxForNode,
  nodeSort,
  rankCenterX,
  renderedBranchStrokeWidth,
  rendererHitBoxForNode,
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

describe("lifecycle diagram render-only routing layout", () => {
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

  it("lays out dense fixture with bounded semantic docks and safe handles", () => {
    const { graph } = layoutLifecycleRoutingGraph(
      projectLifecycleAt(denseFixture),
      1850,
    );
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
    for (const handle of handles) {
      expect(Number.isFinite(handle.x), handle.branchId).toBe(true);
      expect(Number.isFinite(handle.y), handle.branchId).toBe(true);
      expect(handle.clearanceMargin, handle.branchId).toBeGreaterThan(0);
      const segments = byBranch.get(handle.branchId);
      const allowed = segments.flatMap((segment) =>
        [0.5, 0.35, 0.65].map((t) => ({
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
        .filter(([branchId]) => branchId !== handle.branchId)
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
});
