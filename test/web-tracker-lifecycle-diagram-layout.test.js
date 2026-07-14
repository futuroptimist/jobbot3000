import { describe, expect, it } from "vitest";
import {
  ENDPOINT_COLORS,
  MINIMUM_RANK_CENTER_SPACING,
  MINIMUM_SVG_WIDTH,
  MINIMUM_TRANSITION_WIDTH,
  RANK_CORRIDOR_HALF_WIDTH,
  assignBranchHandles,
  buildLifecycleDisplayBranches,
  buildLifecycleRoutingGraph,
  calculateLifecycleDiagramLayout,
  rankCorridor,
  wrapLifecycleNodeLabel,
} from "../src/web/tracker/lifecycleDiagramLayout.js";

const projection = Object.freeze({
  nodes: Object.freeze([
    Object.freeze({ id: "origin:application_submitted", total: 25 }),
    Object.freeze({ id: "milestone:recruiter_screen", total: 2 }),
    Object.freeze({ id: "milestone:technical_interview", total: 1 }),
    Object.freeze({ id: "milestone:assessment_take_home", total: 1 }),
    Object.freeze({ id: "endpoint:awaiting_response", total: 20 }),
    Object.freeze({ id: "endpoint:interviewing", total: 2 }),
    Object.freeze({ id: "endpoint:assessment_in_progress", total: 1 }),
    Object.freeze({ id: "endpoint:employer_rejected", total: 2 }),
  ]),
  links: Object.freeze([
    Object.freeze({
      id: "link:origin:application_submitted->endpoint:awaiting_response",
      source: "origin:application_submitted",
      target: "endpoint:awaiting_response",
      value: 20,
      applicationIds: Object.freeze(
        Array.from(
          { length: 20 },
          (_, i) => `app-${String(i + 1).padStart(2, "0")}`,
        ),
      ),
    }),
    Object.freeze({
      id: "link:origin:application_submitted->milestone:recruiter_screen",
      source: "origin:application_submitted",
      target: "milestone:recruiter_screen",
      value: 2,
      applicationIds: Object.freeze(["app-24", "app-25"]),
    }),
  ]),
  paths: Object.freeze([
    ...Array.from({ length: 20 }, (_, i) =>
      Object.freeze({
        applicationId: `app-${String(i + 1).padStart(2, "0")}`,
        endpoint: "awaiting_response",
        nodeIds: Object.freeze([]),
      }),
    ),
    Object.freeze({
      applicationId: "app-24",
      endpoint: "interviewing",
      nodeIds: Object.freeze([]),
    }),
    Object.freeze({
      applicationId: "app-25",
      endpoint: "interviewing",
      nodeIds: Object.freeze([]),
    }),
  ]),
});

describe("lifecycle diagram render-only routing layout", () => {
  it("partitions links by terminal endpoint with stable IDs, sums, colors, and order", () => {
    const branches = buildLifecycleDisplayBranches(projection);
    expect(branches.map((b) => b.id)).toEqual([
      [
        "branch:link:origin:application_submitted->endpoint:awaiting_response",
        "endpoint:awaiting_response",
      ].join(":"),
      "branch:link:origin:application_submitted->milestone:recruiter_screen:endpoint:interviewing",
    ]);
    expect(branches.map((b) => [b.value, b.color])).toEqual([
      [20, "#60A5FA"],
      [2, "#C084FC"],
    ]);
    expect(new Set(branches.flatMap((b) => b.applicationIds)).size).toBe(22);
    expect(
      buildLifecycleDisplayBranches({
        ...projection,
        links: [...projection.links].reverse(),
      }).map((b) => b.id),
    ).toEqual(branches.map((b) => b.id));
  });

  it("keeps frozen projection input unchanged", () => {
    expect(() => buildLifecycleDisplayBranches(projection)).not.toThrow();
    expect(Object.isFrozen(projection.links[0].applicationIds)).toBe(true);
  });

  it("uses exact endpoint palette and unknown fallback", () => {
    expect(ENDPOINT_COLORS).toMatchObject({
      awaiting_response: "#60A5FA",
      interviewing: "#C084FC",
      assessment_in_progress: "#FACC15",
      employer_rejected: "#FB7185",
      unknown: "#E2E8F0",
    });
    const [branch] = buildLifecycleDisplayBranches({
      nodes: [],
      links: [
        {
          id: "link:x",
          source: "origin:application_submitted",
          target: "endpoint:unknown",
          applicationIds: ["missing"],
        },
      ],
      paths: [],
    });
    expect(branch.color).toBe("#E2E8F0");
  });

  it("inserts deterministic private routing nodes for skipped ranks and adjacent segments", () => {
    const graph = buildLifecycleRoutingGraph(projection);
    const branch = graph.branches[0];
    expect(
      graph.nodes
        .filter((n) => n.routing && n.branchId === branch.id)
        .map((n) => n.rank),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      graph.nodes.filter(
        (n) => n.routing && n.branchId === graph.branches[1].id,
      ),
    ).toHaveLength(0);
    for (const segment of graph.links) {
      const source = graph.nodes.find((n) => n.id === segment.source);
      const target = graph.nodes.find((n) => n.id === segment.target);
      expect(target.rank).toBe(source.rank + 1);
      expect(segment.applicationIds).toEqual(
        [...segment.applicationIds].sort(),
      );
    }
    expect(graph.nodes.filter((n) => !n.routing).map((n) => n.id)).toEqual(
      projection.nodes.map((n) => n.id),
    );
  });

  it("calculates height from visible plus routing lane density, not app volume", () => {
    const graph = buildLifecycleRoutingGraph(projection);
    const dimensions = calculateLifecycleDiagramLayout(graph, 1);
    expect(dimensions.width).toBe(MINIMUM_SVG_WIDTH);
    expect(dimensions.height).toBeGreaterThanOrEqual(360);
    const doubled = calculateLifecycleDiagramLayout(
      {
        ...graph,
        branches: graph.branches.map((b) => ({ ...b, value: b.value * 10 })),
      },
      1,
    );
    expect(doubled.height).toBe(dimensions.height);
  });

  it("exposes exact protected corridor calculations", () => {
    expect(MINIMUM_RANK_CENTER_SPACING).toBe(
      2 * RANK_CORRIDOR_HALF_WIDTH + MINIMUM_TRANSITION_WIDTH,
    );
    expect(MINIMUM_SVG_WIDTH).toBe(1850);
    expect(rankCorridor(0).right - rankCorridor(0).left).toBe(200);
  });

  it("wraps labels without truncating and assigns one non-overlapping handle per branch", () => {
    const label = "Assessment/take-home requested";
    expect(wrapLifecycleNodeLabel(label).join(" ")).toBe(label);
    const handles = assignBranchHandles(
      [
        { id: "a", sortKey: "a" },
        { id: "b", sortKey: "b" },
      ],
      new Map([
        [
          "a",
          [
            {
              branchId: "a",
              source: { rank: 1 },
              target: { rank: 2 },
              y0: 10,
              y1: 10,
            },
          ],
        ],
        [
          "b",
          [
            {
              branchId: "b",
              source: { rank: 2 },
              target: { rank: 3 },
              y0: 80,
              y1: 80,
            },
          ],
        ],
      ]),
    );
    expect(handles).toHaveLength(2);
    expect(
      Math.hypot(handles[0].x - handles[1].x, handles[0].y - handles[1].y),
    ).toBeGreaterThanOrEqual(44);
  });
});
