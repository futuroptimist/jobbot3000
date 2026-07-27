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

// Small epsilon used throughout the layout solver's lane-coordinate
// comparisons (see lifecycleDiagramLayout.js, which imports and re-exports
// this) and as part of the route-handle clearance formula below.
export const LANE_Y_EPSILON = 0.001;

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

// edgeCrossing only detects genuine transversal crossings: two edges that are
// exactly (or near-exactly) collinear over a stretch never satisfy its strict
// sign-straddling test, so a pair of routes rendered directly on top of one
// another would otherwise report zero crossings and escape the
// sustained-overlap contract entirely. collinearOverlapLength closes that gap
// with a narrow, purely geometric measurement: how much of `left`'s length
// runs parallel to and within `tolerance` of `right`'s infinite line, ignoring
// any pair that isn't parallel enough to be meaningfully collinear in the
// first place. Returns 0 for non-parallel, non-collinear, or non-overlapping
// (touching-at-a-point-only) edges.
const perpendicularDistanceFromLine = (point, edge) => {
  const dx = edge.p1.x - edge.p0.x;
  const dy = edge.p1.y - edge.p0.y;
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(point.x - edge.p0.x, point.y - edge.p0.y);
  return (
    Math.abs(
      dy * point.x -
        dx * point.y +
        edge.p1.x * edge.p0.y -
        edge.p1.y * edge.p0.x,
    ) / length
  );
};

// How far two edges' directions may diverge (sine of the angle between unit
// direction vectors) and still count as "collinear" for overlap purposes --
// small enough to exclude ordinary crossing routes, generous enough to
// tolerate the sub-pixel direction noise between two independently flattened
// (production) or independently sampled (rendered SVG) approximations of
// what would otherwise be identical geometry.
const COLLINEAR_DIRECTION_TOLERANCE = 0.05;

// Perpendicular-distance tolerance for treating two edges as running along
// the same line -- matches the cubic-flattening flatness tolerance already
// used elsewhere in this pipeline (see cubicFlatEnough in
// lifecycleDiagramLayout.js), so "collinear" means the same thing here as it
// does to the flattening step that produced these edges in the first place.
export const COLLINEAR_OVERLAP_TOLERANCE = 0.25;

export const collinearOverlapLength = (
  left,
  right,
  tolerance = COLLINEAR_OVERLAP_TOLERANCE,
) => {
  const leftDx = left.p1.x - left.p0.x;
  const leftDy = left.p1.y - left.p0.y;
  const leftLength = Math.hypot(leftDx, leftDy);
  const rightDx = right.p1.x - right.p0.x;
  const rightDy = right.p1.y - right.p0.y;
  const rightLength = Math.hypot(rightDx, rightDy);
  if (!leftLength || !rightLength) return 0;
  const ux = leftDx / leftLength;
  const uy = leftDy / leftLength;
  const vx = rightDx / rightLength;
  const vy = rightDy / rightLength;
  if (Math.abs(ux * vy - uy * vx) > COLLINEAR_DIRECTION_TOLERANCE) return 0;
  if (perpendicularDistanceFromLine(right.p0, left) > tolerance) return 0;
  if (perpendicularDistanceFromLine(right.p1, left) > tolerance) return 0;
  const projectionOf = (point) =>
    (point.x - left.p0.x) * ux + (point.y - left.p0.y) * uy;
  const rightStart = projectionOf(right.p0);
  const rightEnd = projectionOf(right.p1);
  const lo = Math.max(0, Math.min(rightStart, rightEnd));
  const hi = Math.min(leftLength, Math.max(rightStart, rightEnd));
  return Math.max(0, hi - lo);
};

// A meaningful, sustained collinear overlap must span more than a fleeting
// graze -- ordinary short endpoint contact (two routes briefly touching
// tip-to-tip), or two branches converging toward *different* docks at the
// same rank boundary from nearby lanes before separating to their own
// distinct dock positions, should never trip this on their own. Confirmed
// directly against a real pair in tracker-lifecycle-diagram-v2.json's
// previous-event state: two branches approaching different endpoint docks at
// the same rank accumulated ~6px of incidental overlap while merely
// converging, well short of a genuine duplicated-route defect (which, given
// this pipeline's typical multi-hundred-pixel route lengths, would span a
// large fraction of a segment, not a handful of pixels at its tail). This
// threshold is set an order of magnitude above that observed artifact and
// well below what a real full-length overlap would produce.
export const SUSTAINED_OVERLAP_LENGTH_THRESHOLD = 30;

// Shortest distance from a point to a line segment (clamped projection).
// Moved here (from lifecycleDiagramLayout.js, which re-exports it for
// backward compatibility) so both production's route-handle-collision check
// and the Playwright audit's rendered-SVG equivalent can call the identical
// function against a handle point and a flattened/sampled edge.
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

// Exact clearance production requires between a nonincident route's curve
// and another branch's placed handle (see auditLifecycleRouteGeometry's
// route-handle-collision check): the handle's own radius, plus the route's
// rendered envelope (stroke halo) radius, plus a small fixed rendering
// margin and lane-coordinate epsilon. Shared so the Playwright audit applies
// the exact same formula to rendered geometry instead of an approximated one.
export const ROUTE_HANDLE_CLEARANCE_MARGIN = 0.25;

export const routeHandleRequiredClearance = (
  handleRadius,
  envelopeRadius,
  epsilon = 0,
) => handleRadius + envelopeRadius + ROUTE_HANDLE_CLEARANCE_MARGIN + epsilon;

export const isRouteHandleCollision = (
  point,
  edge,
  handleRadius,
  envelopeRadius,
  epsilon = 0,
) =>
  pointToSegmentDistance(point, edge) <
  routeHandleRequiredClearance(handleRadius, envelopeRadius, epsilon);

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
    collinearOverlapLength,
    SUSTAINED_OVERLAP_LENGTH_THRESHOLD,
    pointToSegmentDistance,
    routeHandleRequiredClearance,
    isRouteHandleCollision,
    LANE_Y_EPSILON,
  };
}
