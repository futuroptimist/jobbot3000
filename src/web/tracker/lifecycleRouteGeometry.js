/* global window */
// Pure geometry primitives shared between production's pre-render route-crossing
// audit (lifecycleDiagramLayout.js's auditLifecycleRouteGeometry) and the
// Playwright browser-side collision audit (test/playwright/lifecycle-diagram.spec.js's
// assertBrowserCollisionAudit), which independently samples rendered SVG geometry.
// Both classifiers must agree on what counts as a proper vs. sustained crossing, so
// this module has no DOM/graph/layout-object dependencies -- only plain {x,y} points
// and {p0,p1} edges -- and is exposed to the browser via window.__lifecycleRouteGeometry
// (see below) so the Playwright audit calls these exact functions rather than a
// hand-copied reimplementation.

export const orientation = (a, b, c) =>
  Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

export const edgeCrossing = (left, right) => {
  const o1 = orientation(left.p0, left.p1, right.p0);
  const o2 = orientation(left.p0, left.p1, right.p1);
  const o3 = orientation(right.p0, right.p1, left.p0);
  const o4 = orientation(right.p0, right.p1, left.p1);
  return o1 * o2 < 0 && o3 * o4 < 0;
};

// Many flattened-edge-pair crossings for the same branch pair means the two routes
// run coincident/parallel for a stretch, not a brief single crossing -- that reads as
// one line drawn on top of another, not a tolerable visual blemish.
export const ROUTE_CROSSING_SUSTAINED_THRESHOLD = 4;

export const classifyRouteCrossingCategory = (crossingCount) =>
  crossingCount > ROUTE_CROSSING_SUSTAINED_THRESHOLD
    ? "sustained-crossing"
    : "proper-crossing";

// Test-only hook: lets Playwright's page.evaluate() call these exact functions
// against rendered SVG geometry instead of maintaining an independent
// reimplementation. The tracker frontend is bundled by esbuild at server startup
// (src/web/server.js, entry tracker.js -> lifecycleDiagram.js ->
// lifecycleDiagramLayout.js -> this module), so this side effect always executes in
// the browser bundle. Guarded because this module is also imported directly under
// Vitest's default Node environment, where `window` is undefined.
if (typeof window !== "undefined") {
  window.__lifecycleRouteGeometry = {
    edgeCrossing,
    classifyRouteCrossingCategory,
    ROUTE_CROSSING_SUSTAINED_THRESHOLD,
  };
}
