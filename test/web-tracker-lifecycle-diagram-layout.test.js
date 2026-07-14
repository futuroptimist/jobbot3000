import { describe, expect, it } from "vitest";
import {
  ENDPOINT_COLORS,
  MINIMUM_RANK_CENTER_SPACING,
  MINIMUM_SVG_WIDTH,
  MINIMUM_TRANSITION_WIDTH,
  RANK_CORRIDOR_HALF_WIDTH,
  adjacentRankSegmentPath,
  branchHandleCandidates,
  buildLifecycleDisplayBranches,
  buildLifecycleRoutingGraph,
  calculateLifecycleDiagramLayout,
  endpointColor,
  lifecycleLinkSort,
  rankCenterX,
  wrapLifecycleNodeLabel,
} from "../src/web/tracker/lifecycleDiagramLayout.js";

const projection = Object.freeze({
  nodes: Object.freeze([
    {
      id: "origin:application_submitted",
      label: "Application submitted",
      total: 4,
      applicationIds: Object.freeze(["a1", "a2", "a3", "a4"]),
    },
    {
      id: "milestone:recruiter_screen",
      label: "Recruiter screen",
      total: 1,
      applicationIds: Object.freeze(["a4"]),
    },
    {
      id: "endpoint:awaiting_response",
      label: "Awaiting response",
      total: 2,
      applicationIds: Object.freeze(["a1", "a2"]),
    },
    {
      id: "endpoint:employer_rejected",
      label: "Employer rejected",
      total: 1,
      applicationIds: Object.freeze(["a3"]),
    },
    {
      id: "endpoint:interviewing",
      label: "Interviewing",
      total: 1,
      applicationIds: Object.freeze(["a4"]),
    },
  ]),
  links: Object.freeze([
    {
      id: "origin:application_submitted->endpoint:awaiting_response",
      source: "origin:application_submitted",
      target: "endpoint:awaiting_response",
      value: 2,
      applicationIds: Object.freeze(["a2", "a1"]),
    },
    {
      id: "origin:application_submitted->endpoint:employer_rejected",
      source: "origin:application_submitted",
      target: "endpoint:employer_rejected",
      value: 1,
      applicationIds: Object.freeze(["a3"]),
    },
    {
      id: "origin:application_submitted->milestone:recruiter_screen",
      source: "origin:application_submitted",
      target: "milestone:recruiter_screen",
      value: 1,
      applicationIds: Object.freeze(["a4"]),
    },
    {
      id: "milestone:recruiter_screen->endpoint:interviewing",
      source: "milestone:recruiter_screen",
      target: "endpoint:interviewing",
      value: 1,
      applicationIds: Object.freeze(["a4"]),
    },
  ]),
  paths: Object.freeze([
    {
      applicationId: "a1",
      nodeIds: Object.freeze([
        "origin:application_submitted",
        "endpoint:awaiting_response",
      ]),
    },
    {
      applicationId: "a2",
      nodeIds: Object.freeze([
        "origin:application_submitted",
        "endpoint:awaiting_response",
      ]),
    },
    {
      applicationId: "a3",
      nodeIds: Object.freeze([
        "origin:application_submitted",
        "endpoint:employer_rejected",
      ]),
    },
    {
      applicationId: "a4",
      nodeIds: Object.freeze([
        "origin:application_submitted",
        "milestone:recruiter_screen",
        "endpoint:interviewing",
      ]),
    },
  ]),
});

describe("lifecycle diagram layout routing", () => {
  it("partitions links by terminal endpoint with stable ids and colors", () => {
    const branches = buildLifecycleDisplayBranches(projection);
    expect(branches.map((b) => b.id)).toEqual([
      "branch:origin:application_submitted->endpoint:awaiting_response:endpoint:awaiting_response",
      "branch:origin:application_submitted->milestone:recruiter_screen:endpoint:interviewing",
      "branch:milestone:recruiter_screen->endpoint:interviewing:endpoint:interviewing",
      "branch:origin:application_submitted->endpoint:employer_rejected:endpoint:employer_rejected",
    ]);
    expect(branches[0]).toMatchObject({
      value: 2,
      applicationIds: ["a1", "a2"],
      color: "#60A5FA",
    });
    expect(endpointColor("missing")).toBe(ENDPOINT_COLORS.unknown);
    expect(projection.links[0].applicationIds).toEqual(["a2", "a1"]);
  });

  it("preserves sum, disjointness, and union invariants", () => {
    const branches = buildLifecycleDisplayBranches(projection);
    for (const link of projection.links) {
      const related = branches.filter(
        (branch) => branch.semanticLinkId === link.id,
      );
      expect(related.reduce((sum, branch) => sum + branch.value, 0)).toBe(
        link.value,
      );
      expect(
        new Set(related.flatMap((branch) => branch.applicationIds)),
      ).toEqual(new Set(link.applicationIds));
    }
  });

  it("expands rank-skipping branches through deterministic private routing nodes", () => {
    const graph = buildLifecycleRoutingGraph(projection);
    const routeIds = graph.nodes
      .filter(
        (node) => node.routing && node.branchId.includes("awaiting_response"),
      )
      .map((node) => node.id);
    expect(routeIds).toEqual(
      [1, 2, 3, 4, 5].map((rank) =>
        [
          "route:branch:origin:application_submitted->endpoint:awaiting_response",
          `:endpoint:awaiting_response:rank:${rank}`,
        ].join(""),
      ),
    );
    for (const link of graph.links) {
      const source = graph.nodes.find((node) => node.id === link.source);
      const target = graph.nodes.find((node) => node.id === link.target);
      expect(target.rank).toBe(source.rank + 1);
      expect(link.applicationIds).toEqual([...link.applicationIds].sort());
    }
    expect(
      graph.nodes.filter(
        (node) =>
          node.routing &&
          node.branchId.includes("recruiter_screen:endpoint:interviewing"),
      ).length,
    ).toBe(0);
  });

  it("calculates routed density height independent of application volume", () => {
    const graph = buildLifecycleRoutingGraph(projection);
    const layout = calculateLifecycleDiagramLayout(graph, 100);
    expect(layout.width).toBe(MINIMUM_SVG_WIDTH);
    const volumeProjection = {
      ...projection,
      links: projection.links.map((link) => ({
        ...link,
        value: link.value * 100,
      })),
    };
    expect(
      calculateLifecycleDiagramLayout(
        buildLifecycleRoutingGraph(volumeProjection),
        100,
      ).height,
    ).toBe(layout.height);
  });

  it("documents protected-corridor width and finite adjacent paths", () => {
    expect(MINIMUM_RANK_CENTER_SPACING).toBe(
      2 * RANK_CORRIDOR_HALF_WIDTH + MINIMUM_TRANSITION_WIDTH,
    );
    expect(MINIMUM_SVG_WIDTH).toBe(1850);
    const link = {
      source: { rank: 0, x1: rankCenterX(0) + 9 },
      target: { rank: 1, x0: rankCenterX(1) - 9 },
      y0: 10,
      y1: 40,
    };
    expect(adjacentRankSegmentPath(link)).not.toMatch(/NaN|Infinity/u);
  });

  it("keeps ordering, label wrapping, and handles deterministic", () => {
    const graph = buildLifecycleRoutingGraph(projection);
    expect(
      [...graph.links].sort(lifecycleLinkSort).map((link) => link.id),
    ).toEqual(graph.links.map((link) => link.id));
    expect(
      wrapLifecycleNodeLabel(
        "Assessment take home requested for candidate",
      ).join(" "),
    ).toBe("Assessment take home requested for candidate");
    const segment = {
      branchId: "b",
      source: { rank: 1, routing: true },
      target: { rank: 2, routing: true },
      y0: 10,
      y1: 20,
    };
    const handles = branchHandleCandidates([segment]);
    expect(handles).toHaveLength(3);
    expect(handles[0]).toMatchObject({ branchId: "b", r: 22 });
  });
});
