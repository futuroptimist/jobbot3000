import { describe, expect, it } from "vitest";

import {
  LIFECYCLE_ENDPOINT_COLORS,
  MINIMUM_RANK_CENTER_SPACING,
  RANK_CORRIDOR_HALF_WIDTH,
  MINIMUM_TRANSITION_WIDTH,
  buildLifecycleDisplayBranches,
  buildLifecycleRoutingGraph,
  calculateLifecycleDiagramLayout,
  rankCenterX,
  wrapLifecycleNodeLabel,
} from "../src/web/tracker/lifecycleDiagramLayout.js";

const projection = Object.freeze({
  nodes: Object.freeze([
    Object.freeze({
      id: "origin:application_submitted",
      label: "Application submitted",
      total: 25,
    }),
    Object.freeze({
      id: "milestone:recruiter_screen",
      label: "Recruiter screen",
      total: 2,
    }),
    Object.freeze({
      id: "endpoint:awaiting_response",
      label: "Awaiting response",
      total: 20,
    }),
    Object.freeze({
      id: "endpoint:interviewing",
      label: "Interviewing",
      total: 2,
    }),
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
        nodeIds: Object.freeze([
          "origin:application_submitted",
          "endpoint:awaiting_response",
        ]),
      }),
    ),
    Object.freeze({
      applicationId: "app-24",
      endpoint: "interviewing",
      nodeIds: Object.freeze([
        "origin:application_submitted",
        "milestone:recruiter_screen",
        "endpoint:interviewing",
      ]),
    }),
    Object.freeze({
      applicationId: "app-25",
      endpoint: "interviewing",
      nodeIds: Object.freeze([
        "origin:application_submitted",
        "milestone:recruiter_screen",
        "endpoint:interviewing",
      ]),
    }),
  ]),
});

describe("lifecycle diagram layout routing", () => {
  it("partitions links into stable endpoint-conditioned display branches", () => {
    const branches = buildLifecycleDisplayBranches(projection);
    expect(branches.map((branch) => branch.id)).toEqual([
      [
        "branch:link:origin:application_submitted->endpoint:awaiting_response",
        "endpoint:awaiting_response",
      ].join(":"),
      [
        "branch:link:origin:application_submitted->milestone:recruiter_screen",
        "endpoint:interviewing",
      ].join(":"),
    ]);
    expect(branches[0]).toMatchObject({
      value: 20,
      color: "#60A5FA",
      endpointId: "awaiting_response",
    });
    expect(branches[1]).toMatchObject({
      value: 2,
      color: "#C084FC",
      endpointId: "interviewing",
    });
    expect(
      buildLifecycleDisplayBranches({
        ...projection,
        links: [...projection.links].reverse(),
      }),
    ).toEqual(branches);
  });

  it("expands rank-skipping branches through deterministic adjacent routing nodes", () => {
    const graph = buildLifecycleRoutingGraph(projection);
    const routeNodes = graph.nodes.filter((node) => node.routing);
    expect(routeNodes.map((node) => node.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(routeNodes[0].id).toBe(
      [
        "route:branch:link:origin:application_submitted->endpoint:awaiting_response",
        "endpoint:awaiting_response:rank:1",
      ].join(":"),
    );
    for (const link of graph.links) {
      const source = graph.nodes.find((node) => node.id === link.source);
      const target = graph.nodes.find((node) => node.id === link.target);
      expect(target.rank).toBe(source.rank + 1);
      expect(link.applicationIds.length).toBe(link.value);
    }
    expect(
      graph.nodes.filter((node) => !node.routing).map((node) => node.id),
    ).not.toContain(routeNodes[0].id);
  });

  it("calculates dimensions from routed lane density, not application volume", () => {
    const layout = calculateLifecycleDiagramLayout(projection, 320);
    expect(layout.width).toBe(1850);
    expect(layout.height).toBeGreaterThanOrEqual(360);
    const moreVolume = {
      ...projection,
      links: [
        {
          ...projection.links[0],
          value: 1000,
          applicationIds: projection.links[0].applicationIds,
        },
        projection.links[1],
      ],
    };
    expect(calculateLifecycleDiagramLayout(moreVolume, 320)).toEqual(layout);
  });

  it("defines protected corridor geometry and non-truncating labels", () => {
    expect(MINIMUM_RANK_CENTER_SPACING).toBe(
      2 * RANK_CORRIDOR_HALF_WIDTH + MINIMUM_TRANSITION_WIDTH,
    );
    expect(rankCenterX(6) - rankCenterX(0)).toBe(
      6 * MINIMUM_RANK_CENTER_SPACING,
    );
    expect(
      wrapLifecycleNodeLabel("Offer expired/rescinded (12)").join(" "),
    ).toBe("Offer expired/rescinded (12)");
  });

  it("exposes the exact endpoint palette with unknown fallback available", () => {
    expect(LIFECYCLE_ENDPOINT_COLORS).toMatchObject({
      awaiting_response: "#60A5FA",
      interviewing: "#C084FC",
      assessment_in_progress: "#FACC15",
      unknown: "#E2E8F0",
    });
  });
});
