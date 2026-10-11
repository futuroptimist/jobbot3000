import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/tracker-lifecycle-diagram-routing-v2.json" with { type: "json" };
import { projectLifecycleAt } from "../src/web/tracker/lifecycleProjection.js";
import { layoutLifecycleRoutingGraph } from "../src/web/tracker/lifecycleDiagramLayout.js";
import {
  layoutLifecycleRibbons,
  lifecycleRibbonPath,
} from "../src/web/tracker/lifecycleDiagramRibbons.js";

describe("count-proportional lifecycle ribbons", () => {
  let routed;
  beforeAll(() => {
    routed = layoutLifecycleRoutingGraph(
      projectLifecycleAt(fixture, "current"),
      1440,
    );
  });
  const present = (width = 1440) =>
    layoutLifecycleRibbons(routed.graph, routed.dimensions, width);
  const geometry = ({ graph, dimensions }) => ({
    width: dimensions.width,
    height: dimensions.height,
    nodes: graph.nodes.map(({ id, x0, x1, y0, y1 }) => ({
      id,
      x0,
      x1,
      y0,
      y1,
    })),
    bands: graph.branches.map((branch) => ({
      id: branch.id,
      count: branch.value,
      path: lifecycleRibbonPath(
        graph.links.filter((link) => link.branchId === branch.id),
      ),
    })),
  });

  it("uses one count scale and conserves every node's ports without inflating thin flows", () => {
    const { graph, dimensions } = present();
    for (const link of graph.links) {
      expect(link.width).toBeCloseTo(link.value * dimensions.unit, 8);
      for (const [side, dock] of [
        ["source", "y0"],
        ["target", "y1"],
      ]) {
        expect(link[dock] - link.width / 2).toBeGreaterThanOrEqual(
          link[side].y0 - 1e-8,
        );
        expect(link[dock] + link.width / 2).toBeLessThanOrEqual(
          link[side].y1 + 1e-8,
        );
      }
    }
    for (const node of graph.nodes) {
      expect(node.x1 - node.x0).toBe(8);
      expect(node.y1 - node.y0).toBeCloseTo(node.value * dimensions.unit, 8);
      for (const [side, dock] of [
        ["source", "y0"],
        ["target", "y1"],
      ]) {
        const ports = graph.links
          .filter((link) => link[side] === node)
          .sort((a, b) => a[dock] - b[dock]);
        if (!ports.length) continue;
        expect(ports.reduce((sum, port) => sum + port.width, 0)).toBeCloseTo(
          node.y1 - node.y0,
          8,
        );
        for (let index = 1; index < ports.length; index++) {
          expect(ports[index][dock] - ports[index].width / 2).toBeCloseTo(
            ports[index - 1][dock] + ports[index - 1].width / 2,
            8,
          );
        }
      }
    }
  });

  it("does not mutate solver geometry, branch identities, counts, or reusable seeds", () => {
    const before = structuredClone(routed);
    const { graph } = present();
    expect(routed).toEqual(before);
    expect(graph.branches).toBe(routed.graph.branches);
    expect(
      graph.links.map(({ id, applicationIds, value }) => ({
        id,
        applicationIds,
        value,
      })),
    ).toEqual(
      routed.graph.links.map(({ id, applicationIds, value }) => ({
        id,
        applicationIds,
        value,
      })),
    );
    for (const node of graph.nodes)
      expect(node).not.toBe(routed.graph.nodes.find((n) => n.id === node.id));
  });

  it("closes each ribbon and keeps a constant thickness through routing-only ranks", () => {
    const { graph } = present();
    for (const branch of graph.branches) {
      const segments = graph.links
        .filter((link) => link.branchId === branch.id)
        .sort((a, b) => a.segmentIndex - b.segmentIndex);
      const path = lifecycleRibbonPath(segments);
      expect(path).toMatch(/^M .* Z$/u);
      expect(path).not.toMatch(/NaN|Infinity/u);
      expect((path.match(/ C /gu) ?? []).length).toBe(segments.length * 2);
      expect(lifecycleRibbonPath([...segments].reverse())).toBe(path);
      for (let i = 1; i < segments.length; i++) {
        expect(segments[i].width).toBe(segments[0].width);
        expect(segments[i].y0).toBeCloseTo(segments[i - 1].y1, 8);
      }
    }
    expect(lifecycleRibbonPath([])).toBe("");
  });

  it("retains the accepted rank order while making columns compact and evenly spaced", () => {
    const { graph, dimensions } = present(375);
    expect(dimensions.width).toBe(1120);
    expect(dimensions.height).toBeLessThan(routed.dimensions.height);
    for (let rank = 0; rank <= 6; rank++) {
      const order = (nodes) =>
        nodes
          .filter((n) => n.rank === rank)
          .sort((a, b) => a.y0 - b.y0)
          .map((n) => n.id);
      expect(order(graph.nodes)).toEqual(order(routed.graph.nodes));
      if (rank)
        expect(
          dimensions.horizontalGeometry.rankCenters[rank] -
            dimensions.horizontalGeometry.rankCenters[rank - 1],
        ).toBeCloseTo(156, 8);
    }
  });

  it("pins deterministic synthetic desktop/mobile visual geometry", () => {
    // Vector geometry is independent of OS font rasterization. Browser QA
    // separately checks text bounds, interaction, and screenshot stability.
    const signature = (width) =>
      createHash("sha256")
        .update(JSON.stringify(geometry(present(width))))
        .digest("hex");
    expect({
      desktop: signature(1440),
      mobile: signature(375),
    }).toMatchSnapshot();
    expect(geometry(present())).toEqual(geometry(present()));
    expect(signature(NaN)).toBe(signature(375));
  });
});
