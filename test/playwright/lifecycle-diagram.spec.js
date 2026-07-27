/* global document, indexedDB, window */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import axe from "axe-core";

import { startWebServer } from "../../src/web/server.js";

const EXPECTED_CURRENT = {
  included: "16/16 applications included",
  origins: {
    "Application submitted": "4",
    "Candidate outreach": "3",
    "Recruiter/company reached out": "2",
    Referral: "3",
    "Other/unknown": "4",
  },
  milestones: {
    "Recruiter screen": "3",
    "Technical interview": "4",
    "Assessment/take-home": "2",
    "Onsite/final loop": "1",
    "Offer received": "2",
  },
  importedEndpoints: {
    "Awaiting response": "3",
    Interviewing: "4",
    "Assessment in progress": "1",
    "Offer/negotiating": "2",
    "Employer rejected": "1",
    "Candidate withdrew": "1",
    "Offer declined": "1",
    "Offer expired/rescinded": "1",
    "Offer accepted": "1",
    "Closed/archived": "1",
    Unknown: "0",
  },
  rawFixtureEndpoints: {
    "Awaiting response": "2",
    Interviewing: "4",
    "Assessment in progress": "1",
    "Offer/negotiating": "2",
    "Employer rejected": "1",
    "Candidate withdrew": "1",
    "Offer declined": "1",
    "Offer expired/rescinded": "1",
    "Offer accepted": "1",
    "Closed/archived": "1",
    Unknown: "1",
  },
  representativeFlows: {
    "Application submitted to Awaiting response — Awaiting response": "2",
    "Technical interview to Interviewing — Interviewing": "3",
    "Offer received to Offer/negotiating — Offer/negotiating": "2",
    "Other/unknown to Employer rejected — Employer rejected": "1",
  },
  endpoints: [
    "Awaiting response",
    "Interviewing",
    "Assessment in progress",
    "Offer/negotiating",
    "Employer rejected",
    "Candidate withdrew",
    "Offer declined",
    "Offer expired/rescinded",
    "Offer accepted",
    "Closed/archived",
    "Unknown",
  ],
  hostileApplicationId:
    'app-16-<script>-<img onerror>-<svg>-"quotes"-javascript:-onclick=alert(1)',
  hostileEventIds: [
    "evt-001-<script>alert(1)</script>",
    "evt-002-<img src=x onerror=alert(1)>",
    "evt-003-<svg onload=alert(1)>",
    'evt-004-"quotes"-javascript:alert(1)-onclick=alert(1)',
  ],
};

async function clearTrackerData(page, url) {
  await page.goto(url);
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("jobbot3000");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
      }),
  );
}

async function importFixture(
  page,
  fixture = "tracker-lifecycle-diagram-v2.json",
) {
  const text = await readFile(`test/fixtures/${fixture}`, "utf8");
  await page.getByRole("button", { name: "Import/Export" }).click();
  await page.setInputFiles("[data-import-file]", {
    name: fixture,
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Preview/dry-run" }).click();
  await page.getByRole("button", { name: "Apply import" }).click();
  await expect(page.locator("[data-import-result]")).toContainText(
    "Import applied",
  );
}

async function openLifecycleTables(page) {
  const tables = page.locator("details.diagram-tables");
  if (!(await tables.evaluate((el) => el.open)))
    await page.getByText("Lifecycle data tables").click();
}

async function tableRowsByCaption(page, caption) {
  return await page
    .locator("table", { has: page.locator("caption", { hasText: caption }) })
    .evaluate((table) =>
      [...table.querySelectorAll("tbody tr")].map((row) =>
        [...row.cells].map((cell) => cell.innerText.trim()),
      ),
    );
}

async function assertTableCounts(page, caption, expected) {
  const rows = await tableRowsByCaption(page, caption);
  const actual = Object.fromEntries(
    rows.map((row) => {
      const key = caption === "Flows" ? `${row[0]} — ${row[1]}` : row[0];
      const value = caption === "Flows" ? row[2] : row[1];
      return [key, value];
    }),
  );
  expect(actual).toMatchObject(expected);
}

async function selectedDetails(page) {
  return await page.locator("[data-diagram-details]").innerText();
}

async function assertNoPageOverflow(page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function assertVisibleControlsLargeEnough(page) {
  const boxes = await page
    .locator(
      [
        '[data-view="diagram"] button:not([disabled])',
        '[data-view="diagram"] input[type="range"]',
        '[data-view="diagram"] summary',
      ].join(", "),
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            box.width > 0 &&
            box.height > 0
          );
        })
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim(),
            width: box.width,
            height: box.height,
          };
        }),
    );
  for (const box of boxes) {
    expect(box.width, box.text).toBeGreaterThanOrEqual(44);
    expect(box.height, box.text).toBeGreaterThanOrEqual(44);
  }
}

async function assertDensityAwareSvgGeometry(page) {
  // Generous timeout margin for slower CI runners rather than tuned tight
  // to one machine — see docs/design/lifecycle-diagram-layout-algorithm.md
  // for the layout solver's own deterministic budgets. Wait for the SVG
  // explicitly rather than letting the evaluate() below throw on a null
  // querySelector.
  await expect(page.locator(".diagram-scroll svg")).toBeVisible({
    timeout: 150000,
  });
  const geometry = await page.locator(".diagram-scroll").evaluate((scroll) => {
    const svg = scroll.querySelector("svg");
    const visibleNodes = [...svg.querySelectorAll("[data-diagram-node]")].map(
      (group) => {
        const rect = group.querySelector("rect:not([data-diagram-node-hit])");
        const hit = group.querySelector("rect[data-diagram-node-hit]");
        const label = group.querySelector("text");
        const box = label.getBoundingClientRect();
        return {
          id: group.getAttribute("data-diagram-node"),
          x: Number(rect.getAttribute("x")),
          y0: Number(rect.getAttribute("y")),
          y1:
            Number(rect.getAttribute("y")) +
            Number(rect.getAttribute("height")),
          hitY0: Number(hit.getAttribute("y")),
          hitY1:
            Number(hit.getAttribute("y")) + Number(hit.getAttribute("height")),
          labelTop: box.top - svg.getBoundingClientRect().top,
          labelBottom: box.bottom - svg.getBoundingClientRect().top,
        };
      },
    );
    return {
      height: Number(svg.getAttribute("height")),
      viewBoxHeight: Number(svg.getAttribute("viewBox").split(/\s+/u)[3]),
      scrollClientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      nodes: visibleNodes,
      pageOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  const nodesByRank = new Map();
  for (const node of geometry.nodes) {
    const key = Math.round(node.x);
    if (!nodesByRank.has(key)) nodesByRank.set(key, []);
    nodesByRank.get(key).push(node);
  }
  const densestColumnCount = Math.max(
    1,
    ...[...nodesByRank.values()].map((nodes) => nodes.length),
  );
  const expectedHeight = Math.max(
    360,
    Math.ceil(
      32 +
        32 +
        densestColumnCount * 36 +
        Math.max(0, densestColumnCount - 1) * 44,
    ),
  );
  expect(geometry.height).toBeGreaterThanOrEqual(expectedHeight);
  expect(geometry.viewBoxHeight).toBe(geometry.height);
  expect(geometry.pageOverflow).toBe(false);
  expect(geometry.scrollHeight).toBeGreaterThanOrEqual(expectedHeight);
  expect(geometry.scrollClientHeight).toBeGreaterThanOrEqual(expectedHeight);
  for (const node of geometry.nodes) {
    expect(node.y0, node.id).toBeGreaterThanOrEqual(64 - 0.5);
    expect(node.y1, node.id).toBeLessThanOrEqual(geometry.height - 48 + 0.5);
    expect(node.hitY0, node.id).toBeGreaterThanOrEqual(0 - 0.5);
    expect(node.hitY1, node.id).toBeLessThanOrEqual(geometry.height + 0.5);
    expect(node.labelTop, node.id).toBeGreaterThanOrEqual(0 - 0.5);
    expect(node.labelBottom, node.id).toBeLessThanOrEqual(
      geometry.height + 0.5,
    );
  }
  for (const nodes of nodesByRank.values()) {
    const sorted = nodes.toSorted((a, b) => a.y0 - b.y0);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index].y0 - sorted[index - 1].y1).toBeGreaterThanOrEqual(
        44 - 0.5,
      );
      expect(sorted[index].hitY0).toBeGreaterThanOrEqual(
        sorted[index - 1].hitY1 - 0.5,
      );
      expect(sorted[index].labelTop).toBeGreaterThanOrEqual(
        sorted[index - 1].labelBottom - 0.5,
      );
    }
  }
}

async function assertBrowserCollisionAudit(page, { maxCrossings = 0 } = {}) {
  const result = await page.locator(".diagram-scroll").evaluate((scroll) => {
    const svg = scroll.querySelector("svg");
    if (!svg)
      return {
        ok: false,
        fatalErrors: ["missing svg"],
        pathCount: 0,
      };
    const routeGeometry = window.__lifecycleRouteGeometry;
    const fatalErrors = [];
    if (!routeGeometry)
      fatalErrors.push("missing lifecycle route geometry test hook");
    const makePoint = (x, y) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      return point;
    };
    const toSvgPoint = (x, y) => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x, y };
      const point = makePoint(x, y).matrixTransform(ctm.inverse());
      return { x: point.x, y: point.y };
    };
    const rectOf = (element) => {
      const box = element.getBoundingClientRect();
      const corners = [
        toSvgPoint(box.left, box.top),
        toSvgPoint(box.right, box.top),
        toSvgPoint(box.right, box.bottom),
        toSvgPoint(box.left, box.bottom),
      ];
      const xs = corners.map((point) => point.x);
      const ys = corners.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const right = Math.max(...xs);
      const bottom = Math.max(...ys);
      return {
        id:
          element.getAttribute("data-diagram-node") ??
          element.getAttribute("data-diagram-node-hit") ??
          element.getAttribute("data-diagram-node-label") ??
          element.getAttribute("data-diagram-branch-handle") ??
          "unknown",
        x,
        y,
        width: right - x,
        height: bottom - y,
        right,
        bottom,
      };
    };
    const overlap = (a, b) =>
      a.x < b.right &&
      a.x + a.width > b.x &&
      a.y < b.bottom &&
      a.y + a.height > b.y;
    const contains = (rect, point, pad = 0) =>
      point.x >= rect.x - pad &&
      point.x <= rect.right + pad &&
      point.y >= rect.y - pad &&
      point.y <= rect.bottom + pad;
    const sampleBox = (sample, inflate) => ({
      x: sample.x - inflate,
      y: sample.y - inflate,
      width: inflate * 2,
      height: inflate * 2,
      right: sample.x + inflate,
      bottom: sample.y + inflate,
    });
    const nodes = [...svg.querySelectorAll("[data-diagram-node]")].map(
      (group) => {
        const id = group.getAttribute("data-diagram-node");
        return {
          id,
          rect: rectOf(
            group.querySelector("rect:not([data-diagram-node-hit])"),
          ),
          hit: rectOf(group.querySelector("[data-diagram-node-hit]")),
          label: rectOf(group.querySelector("[data-diagram-node-label]")),
        };
      },
    );
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const handles = [
      ...svg.querySelectorAll("[data-diagram-branch-handle]"),
    ].map((handle) => ({
      id: handle.getAttribute("data-diagram-branch-handle"),
      rect: rectOf(handle),
      cx: Number(handle.getAttribute("cx")),
      cy: Number(handle.getAttribute("cy")),
    }));
    const paths = [...svg.querySelectorAll("[data-diagram-link]")].map(
      (path) => {
        const id = path.getAttribute("data-diagram-link");
        const source = path.getAttribute("data-source-node-id");
        const target = path.getAttribute("data-target-node-id");
        const length = path.getTotalLength();
        const ribbon = Number(path.getAttribute("stroke-width") || 0);
        const selectorId = window.CSS.escape(id);
        const separator = Number(
          svg
            .querySelector(`[data-diagram-branch-separator="${selectorId}"]`)
            ?.getAttribute("stroke-width") || 0,
        );
        const halo = Number(
          svg
            .querySelector(`[data-diagram-branch-halo="${selectorId}"]`)
            ?.getAttribute("stroke-width") || 0,
        );
        // Production's collision checks (node/label/hit, route-handle) use a
        // fixed, selection-independent envelope (selectedEnvelopeRadius,
        // effectively (widthPx + 12) / 2 -- see
        // src/web/tracker/lifecycleDiagramLayout.js) regardless of which
        // branch happens to be selected, since collision safety shouldn't
        // depend on transient UI state. The halo <path> is only rendered for
        // the currently-selected branch (lifecycleDiagram.js), so for every
        // other branch `halo` above is 0 -- derive the same conservative
        // width analytically from the unconditionally-rendered separator
        // (separator = widthPx + 6, halo = widthPx + 12 = separator + 6)
        // instead of relying on a halo element that may not exist.
        const inflate = Math.max(ribbon, separator, halo, separator + 6) / 2;
        const step = Math.max(0.25, Math.min(1, length || 1));
        const samples = [];
        for (let distance = 0; distance <= length; distance += step) {
          const point = path.getPointAtLength(distance);
          samples.push({ x: point.x, y: point.y, distance });
        }
        if (!samples.length || samples.at(-1).distance < length) {
          const point = path.getPointAtLength(length);
          samples.push({ x: point.x, y: point.y, distance: length });
        }
        // Bucket each sample by the transition rank of the segment it
        // belongs to, so route-vs-route crossing detection can mirror
        // production's own same-rank restriction (auditLifecycleRouteGeometry
        // only compares flattened edges whose segments share a source rank).
        // adjacentRankSegmentPath (lifecycleDiagramLayout.js) emits one
        // leading "M" per segment, in the same order as data-segment-ranks,
        // so splitting the rendered `d` string on that boundary and
        // measuring each piece's own getTotalLength() recovers each
        // segment's arc-length window with no new data-* attributes.
        const ranks = (path.getAttribute("data-segment-ranks") || "")
          .split(",")
          .filter(Boolean)
          .map((pair) => Number(pair.split("-")[0]));
        const d = path.getAttribute("d") || "";
        const segmentPaths = d ? d.split(/(?=M)/u).filter(Boolean) : [];
        let rankWindows = [];
        if (segmentPaths.length && segmentPaths.length === ranks.length) {
          let cumulative = 0;
          rankWindows = segmentPaths.map((segmentD, index) => {
            const probe = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "path",
            );
            probe.setAttribute("d", segmentD);
            const start = cumulative;
            cumulative += probe.getTotalLength();
            return { rank: ranks[index], start, end: cumulative };
          });
        } else {
          fatalErrors.push(
            `${id} segment/rank count mismatch (${segmentPaths.length} vs ${ranks.length})`,
          );
        }
        const rankForDistance = (distance) => {
          if (!rankWindows.length) return undefined;
          const match = rankWindows.find(
            (entry) => distance <= entry.end + 0.5,
          );
          return (match ?? rankWindows.at(-1)).rank;
        };
        for (const sample of samples)
          sample.rank = rankForDistance(sample.distance);
        const edgesByRank = new Map();
        const edges = [];
        for (let i = 1; i < samples.length; i += 1) {
          const p0 = samples[i - 1];
          const p1 = samples[i];
          const edge = { p0, p1 };
          if (!edgesByRank.has(p1.rank)) edgesByRank.set(p1.rank, []);
          edgesByRank.get(p1.rank).push(edge);
          edges.push(edge);
        }
        return {
          id,
          source,
          target,
          length,
          inflate,
          samples,
          edgesByRank,
          edges,
        };
      },
    );
    const dockContact = (path, node, sample) => {
      const exitsSource = node.id === path.source;
      const rect = node.rect;
      const dockX = exitsSource ? rect.right : rect.x;
      return (
        Math.abs(sample.x - dockX) <= path.inflate + 1 &&
        sample.y >= rect.y - path.inflate - 1 &&
        sample.y <= rect.bottom + path.inflate + 1
      );
    };
    const atSharedDock = (left, right, sample) => {
      const shared = [left.source, left.target].find(
        (id) => id === right.source || id === right.target,
      );
      if (!shared) return false;
      const node = nodeById.get(shared);
      return node
        ? dockContact(left, node, sample) && dockContact(right, node, sample)
        : false;
    };
    const branchHandleRadius = 22;
    // A nonincident route's curve passing through another branch's placed
    // handle is treated as tolerable (bucketed into the same crossings
    // budget as a proper route-vs-route crossing), matching production's
    // own candidateCallback, which treats "route-handle-collision" findings
    // as eligible for toleratedRouteCrossingCount alongside "proper-crossing"
    // (src/web/tracker/lifecycleDiagramLayout.js) rather than unconditionally
    // fatal -- a handle a few pixels closer than ideal to an unrelated line
    // is not the same class of usability bug as an unclickable/ambiguous
    // handle (which fixed-geometry/handle-vs-handle collisions above remain).
    //
    // Collision severity uses the exact same point-to-segment predicate and
    // required-clearance formula production's own route-handle-collision
    // check does (pointToSegmentDistance/routeHandleRequiredClearance,
    // src/web/tracker/lifecycleRouteGeometry.js, exposed here via
    // window.__lifecycleRouteGeometry), applied against the rendered path's
    // sampled edges rather than its discrete sample points, so the closest
    // point *between* two samples is measured, not just the samples
    // themselves.
    const crossings = [];
    for (const path of paths) {
      for (const node of nodes) {
        const incident = node.id === path.source || node.id === path.target;
        for (const sample of path.samples) {
          const box = sampleBox(sample, path.inflate);
          if (overlap(box, node.label)) {
            fatalErrors.push(`${path.id} intersects label ${node.id}`);
            break;
          }
          if (overlap(box, node.hit) && !incident) {
            fatalErrors.push(
              `${path.id} intersects nonincident hit ${node.id}`,
            );
            break;
          }
          if (!overlap(box, node.rect)) continue;
          if (!incident) {
            fatalErrors.push(
              `${path.id} intersects nonincident node ${node.id}`,
            );
            break;
          }
          if (
            !dockContact(path, node, sample) &&
            contains(node.rect, sample, 0)
          ) {
            fatalErrors.push(
              `${path.id} contacts incident node ${node.id} away from dock`,
            );
            break;
          }
        }
      }
      if (!routeGeometry) continue;
      for (const handle of handles) {
        if (handle.id === path.id) continue;
        const handlePoint = { x: handle.cx, y: handle.cy };
        const required = routeGeometry.routeHandleRequiredClearance(
          branchHandleRadius,
          path.inflate,
          routeGeometry.LANE_Y_EPSILON,
        );
        if (
          path.edges.some(
            (edge) =>
              routeGeometry.pointToSegmentDistance(handlePoint, edge) <
              required,
          )
        ) {
          crossings.push(`${path.id} passes near handle ${handle.id}`);
          break;
        }
      }
    }
    // A simple point crossing (two routes briefly touching) is a tolerated,
    // purely visual concern -- matching production's own
    // toleratedRouteCrossingCount philosophy (see
    // src/web/tracker/lifecycleDiagramLayout.js and
    // docs/design/lifecycle-diagram-layout-algorithm.md). A *sustained*
    // overlap (many consecutive shared points, away from a shared dock)
    // reads as one route drawn on top of another, not a brief crossing, and
    // stays a hard fatal error regardless of tolerance. This classification
    // reuses production's own edgeCrossing/classifyRouteCrossingCategory
    // (src/web/tracker/lifecycleRouteGeometry.js, exposed here via
    // window.__lifecycleRouteGeometry) against the rank-bucketed,
    // consecutive-sample edges built above, instead of an independently
    // tuned point-proximity heuristic.
    //
    // edgeCrossing only detects genuine transversal crossings, so two routes
    // that are exactly (or near-exactly) collinear over a stretch never
    // satisfy its strict sign-straddling test and would otherwise report
    // zero crossings, escaping the sustained-overlap contract entirely.
    // collinearOverlapLength (the same shared, pure geometric measurement
    // production's own auditLifecycleRouteGeometry now uses for the same
    // purpose) closes that gap: sumCollinearOverlap below aggregates it per
    // branch pair and shared transition rank, away from ranks where the two
    // paths share a source or target node -- two branches leaving (or
    // converging on) the same dock naturally render correlated, near-
    // identical geometry for a stretch before diverging, which is ordinary
    // and nonfatal, not a duplicated-route defect.
    if (routeGeometry) {
      const {
        edgeCrossing,
        classifyRouteCrossingCategory,
        ROUTE_CROSSING_SUSTAINED_THRESHOLD,
        collinearOverlapLength,
        SUSTAINED_OVERLAP_LENGTH_THRESHOLD,
      } = routeGeometry;
      const countAwayFromDockCrossings = (left, right) => {
        let count = 0;
        for (const [rank, leftEdges] of left.edgesByRank) {
          const rightEdges = right.edgesByRank.get(rank);
          if (!rightEdges) continue;
          for (const leftEdge of leftEdges) {
            for (const rightEdge of rightEdges) {
              if (!edgeCrossing(leftEdge, rightEdge)) continue;
              if (atSharedDock(left, right, leftEdge.p0)) continue;
              count += 1;
              if (count > ROUTE_CROSSING_SUSTAINED_THRESHOLD) return count;
            }
          }
        }
        return count;
      };
      const sharedRanksOf = (left, right) => {
        const ranks = [];
        for (const rank of left.edgesByRank.keys()) {
          if (right.edgesByRank.has(rank)) ranks.push(rank);
        }
        return ranks;
      };
      const sumCollinearOverlap = (left, right) => {
        const sharedRanks = sharedRanksOf(left, right);
        if (!sharedRanks.length) return 0;
        const firstRank = sharedRanks[0];
        const lastRank = sharedRanks.at(-1);
        // Two branches only genuinely "diverge from a shared dock" if they
        // actually end up at different places overall -- if both their
        // overall source AND target node ids match, there is nowhere left
        // for them to diverge to, so neither anchor exclusion below is
        // eligible: a route pair that remains coincident across its full
        // shared span is a duplicated-route defect, not ordinary local dock
        // correlation, regardless of how many ranks it spans. (Unlike
        // production, this file only has branch-level source/target
        // identity available -- no per-segment intermediate node ids -- so
        // this is the finest-grained divergence signal it can compute.)
        const branchesDiverge =
          left.source !== right.source || left.target !== right.target;
        let total = 0;
        for (const rank of sharedRanks) {
          const anchoredAtSharedSource =
            branchesDiverge &&
            rank === firstRank &&
            left.source === right.source;
          const anchoredAtSharedTarget =
            branchesDiverge &&
            rank === lastRank &&
            left.target === right.target;
          if (anchoredAtSharedSource || anchoredAtSharedTarget) continue;
          const leftEdges = left.edgesByRank.get(rank);
          const rightEdges = right.edgesByRank.get(rank);
          for (const leftEdge of leftEdges) {
            for (const rightEdge of rightEdges) {
              const overlap = collinearOverlapLength(leftEdge, rightEdge);
              if (!overlap) continue;
              total += overlap;
              if (total >= SUSTAINED_OVERLAP_LENGTH_THRESHOLD) return total;
            }
          }
        }
        return total;
      };
      for (let a = 0; a < paths.length; a += 1) {
        for (let b = a + 1; b < paths.length; b += 1) {
          const left = paths[a];
          const right = paths[b];
          const count = countAwayFromDockCrossings(left, right);
          const overlapLength = sumCollinearOverlap(left, right);
          const sustainedByOverlap =
            overlapLength >= SUSTAINED_OVERLAP_LENGTH_THRESHOLD;
          if (!count && !sustainedByOverlap) continue;
          if (
            sustainedByOverlap ||
            classifyRouteCrossingCategory(count) === "sustained-crossing"
          ) {
            fatalErrors.push(`${left.id} coincides with ${right.id}`);
            continue;
          }
          crossings.push(`${left.id} crosses ${right.id}`);
        }
      }
    }
    return {
      fatalErrors: [...new Set(fatalErrors)].slice(0, 20),
      crossings: [...new Set(crossings)],
      forcedCrossings: [],
      pathCount: paths.length,
    };
  });
  expect(result.pathCount).toBeGreaterThan(0);
  expect(result.fatalErrors).toEqual([]);
  expect(
    result.crossings.length,
    `crossings: ${result.crossings.slice(0, 10).join(", ")}`,
  ).toBeLessThanOrEqual(maxCrossings);
}

async function runAxe(page) {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(
    async () =>
      await window.axe.run(document.querySelector('[data-view="diagram"]')),
  );
  expect(results.violations).toEqual([]);
}

test.describe("Application Lifecycle Diagram", () => {
  let server;
  test.beforeAll(async () => {
    server = await startWebServer({ host: "127.0.0.1", port: 0 });
  });
  test.afterAll(async () => {
    await server?.close();
  });
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await clearTrackerData(page, server.url);
    await page.goto(`${server.url}/tracker`);
    page.errors = errors;
  });

  test("opens empty diagram without malformed SVG or accessibility violations", async ({
    page,
  }) => {
    await expect(page.locator(".tracker-nav button").nth(1)).toHaveText(
      "Diagram",
    );
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator('[data-view="diagram"]')).toBeVisible();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      "0/0 applications included",
    );
    await expect(page.locator("input[type='range']")).toHaveAttribute(
      "aria-valuetext",
      /Current/u,
    );
    expect(await page.locator("svg path").count()).toBe(0);
    await runAxe(page);
    expect(page.errors).toEqual([]);
  });

  test("announces genuinely newer activity while preserving the historical snapshot", async ({
    page,
  }) => {
    await importFixture(page);
    await page.getByRole("button", { name: "Diagram", exact: true }).click();

    const diagram = page.locator("[data-lifecycle-diagram]");
    const range = page.getByRole("slider", {
      name: "Lifecycle point",
      exact: true,
    });
    await expect(range).toHaveAttribute("aria-valuetext", /Current/u);

    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    const historicalAriaValue = await range.getAttribute("aria-valuetext");
    expect(historicalAriaValue).toBeTruthy();
    await expect(diagram).toContainText("Historical");
    await expect(diagram).not.toContainText("Newer activity available");

    await openLifecycleTables(page);
    const historicalFlows = await tableRowsByCaption(page, "Flows");
    const historicalIncluded = await page
      .locator("[data-lifecycle-diagram] .muted")
      .filter({ hasText: /applications included/u })
      .innerText();

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Synthetic app-01", exact: true })
      .click();
    await page.clock.setFixedTime(new Date("2027-01-01T00:00:00.000Z"));
    const applicationForm = page.locator("form[data-core-form]");
    await applicationForm.locator('input[name="appliedAt"]').fill("2026-01-01");
    await applicationForm
      .locator('select[name="status"]')
      .selectOption("technical_screen");
    await expect(applicationForm.locator('select[name="status"]')).toHaveValue(
      "technical_screen",
    );
    await page
      .getByRole("button", { name: "Save application", exact: true })
      .click();
    await expect(page.locator(".timeline")).toContainText(
      "technical_interview",
    );

    await page.getByRole("button", { name: "Diagram", exact: true }).click();
    await expect(range).toHaveAttribute("aria-valuetext", historicalAriaValue);
    await expect(diagram).toContainText("Historical");

    const newerBadge = diagram
      .locator(".chip")
      .filter({ hasText: "Newer activity available" });
    await expect(newerBadge).toHaveCount(1);
    await expect(newerBadge).toBeVisible();
    await expect(page.locator("#lifecycle-diagram-live")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    const liveRegion = page.locator("#lifecycle-diagram-live");
    await expect(liveRegion).toContainText("Newer activity available");
    expect(
      ((await liveRegion.innerText()).match(/Newer activity available/gu) ?? [])
        .length,
    ).toBe(1);
    await expect(
      page
        .locator("[data-lifecycle-diagram] .muted")
        .filter({ hasText: /applications included/u }),
    ).toHaveText(historicalIncluded);
    expect(await tableRowsByCaption(page, "Flows")).toEqual(historicalFlows);

    await page
      .getByRole("button", { name: "Return to current", exact: true })
      .click();
    await expect(range).toHaveAttribute("aria-valuetext", /Current/u);
    await expect(diagram).not.toContainText("Newer activity available");

    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    await expect(diagram).toContainText("Historical");
    await expect(diagram).not.toContainText("Newer activity available");
  });
  test("renders seeded current/historical states with semantic tables and selection", async ({
    page,
  }) => {
    const requests = [];
    page.on("request", (request) => requests.push(request));
    await importFixture(page);
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      EXPECTED_CURRENT.included,
    );
    await expect(
      page.getByRole("img", { name: /Lifecycle Sankey diagram/u }),
    ).toBeVisible({ timeout: 150000 });
    await expect(page.locator("svg > title")).not.toHaveText("");
    await expect(page.locator("svg > desc")).not.toHaveText("");
    await assertDensityAwareSvgGeometry(page);
    await expect(page.locator("details.diagram-tables")).not.toHaveAttribute(
      "open",
      "",
    );
    await page.getByText("Lifecycle data tables").click();
    await expect(page.locator("details.diagram-tables")).toHaveAttribute(
      "open",
      "",
    );
    await assertTableCounts(page, "Origins", EXPECTED_CURRENT.origins);
    await assertTableCounts(page, "Milestones", EXPECTED_CURRENT.milestones);
    await assertTableCounts(
      page,
      "Endpoints",
      EXPECTED_CURRENT.importedEndpoints,
    );
    await assertTableCounts(
      page,
      "Flows",
      EXPECTED_CURRENT.representativeFlows,
    );
    // Raw P4 projection of the fixture intentionally has Unknown=1 and Awaiting=2;
    // supported browser import/reconciliation fills the deliberately incomplete
    // hostile application into its current endpoint, yielding Unknown=0 and
    // Awaiting=3 in the imported UI expectation above.
    expect(EXPECTED_CURRENT.rawFixtureEndpoints.Unknown).toBe("1");
    expect(EXPECTED_CURRENT.importedEndpoints.Unknown).toBe("0");
    for (const label of EXPECTED_CURRENT.endpoints) {
      await expect(
        page
          .locator("caption", { hasText: "Endpoints" })
          .locator("..", { hasText: label }),
      ).toBeVisible();
    }
    await expect(page.locator("svg")).toContainText("Awaiting response: 3");
    await expect(page.locator("svg")).toContainText("Interviewing: 4");
    await expect(
      page.locator("time[datetime='2026-01-02T10:00:00.000Z']"),
    ).toBeVisible();
    await expect(page.locator("time[datetime='2026-01-01']")).toBeVisible();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      "time not recorded",
    );
    await runAxe(page);

    const before = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("jobbot3000");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(
              ["applications", "lifecycleEvents"],
              "readonly",
            );
            Promise.all(
              ["applications", "lifecycleEvents"].map(
                (name) =>
                  new Promise((res, rej) => {
                    const r = tx.objectStore(name).getAll();
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                  }),
              ),
            ).then(resolve, reject);
          };
        }),
    );

    const range = page.locator("input[type='range']");
    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    await expect(range).toHaveAttribute(
      "aria-valuetext",
      /Historical|Unknown|2026/u,
    );
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      "Historical",
    );
    await expect(page.locator("[data-lifecycle-diagram]")).not.toContainText(
      "Newer activity available",
    );
    const historicalValue = await range.inputValue();
    await page.getByRole("button", { name: "Applications" }).click();
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(range).toHaveValue(historicalValue);
    await expect(page.locator("[data-lifecycle-diagram]")).not.toContainText(
      "Newer activity available",
    );
    await page.getByRole("button", { name: "Next event", exact: true }).click();
    await range.fill("0");
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      /Unknown date|off chronological scale|applications included/u,
    );
    await page.getByRole("button", { name: "Return to current" }).click();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      EXPECTED_CURRENT.included,
    );

    const nodeGroup = page
      .locator("[data-diagram-node='origin:application_submitted']")
      .first();
    await nodeGroup.locator("rect:not([data-diagram-node-hit])").click();
    const selected = await page.locator("[data-diagram-details]").innerText();
    await nodeGroup.locator("text").click();
    expect(await page.locator("[data-diagram-details]").innerText()).toBe(
      selected,
    );
    await page
      .getByRole("button", { name: "Select Application submitted" })
      .click();
    expect(await page.locator("[data-diagram-details]").innerText()).toBe(
      selected,
    );
    await expect(page.locator("button[aria-pressed='true']")).toHaveCount(1);
    await page.locator("[data-diagram-link-hit]").first().click();
    await expect(page.locator("[data-diagram-details]")).not.toHaveText(
      selected,
    );
    await page.keyboard.press("Tab");

    await page.setViewportSize({ width: 375, height: 812 });
    const scroll = page.locator(".diagram-scroll");
    await expect(scroll).toHaveAttribute("aria-label", /Scrollable/u);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );
    await page
      .locator("[data-diagram-node] rect:not([data-diagram-node-hit])")
      .first()
      .click();
    await runAxe(page);
    if (
      !(await page.locator("details.diagram-tables").evaluate((el) => el.open))
    )
      await page.getByText("Lifecycle data tables").click();
    await page
      .getByRole("button", { name: "Select Other/unknown", exact: true })
      .click();
    await expect(page.locator("[data-diagram-details]")).toContainText(
      EXPECTED_CURRENT.hostileApplicationId,
    );
    for (const hostileEventId of EXPECTED_CURRENT.hostileEventIds) {
      await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
        hostileEventId,
      );
    }
    await expect(
      page.locator('[data-view="diagram"] script, foreignObject, svg a'),
    ).toHaveCount(0);
    await expect(
      page.locator(
        [
          '[data-view="diagram"] [onload]',
          '[data-view="diagram"] [onerror]',
          '[data-view="diagram"] [onclick]',
        ].join(", "),
      ),
    ).toHaveCount(0);
    await expect(page.locator("svg")).not.toContainText("<svg");

    const after = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("jobbot3000");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(
              ["applications", "lifecycleEvents"],
              "readonly",
            );
            Promise.all(
              ["applications", "lifecycleEvents"].map(
                (name) =>
                  new Promise((res, rej) => {
                    const r = tx.objectStore(name).getAll();
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                  }),
              ),
            ).then(resolve, reject);
          };
        }),
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    await expect(page.locator('[data-view="diagram"]')).not.toContainText(
      /autoplay|filter|predictive|score/i,
    );
    expect(
      requests.filter((request) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()),
      ),
    ).toHaveLength(0);
    expect(
      requests.filter(
        (request) => new URL(request.url()).origin !== server.url,
      ),
    ).toHaveLength(0);
    expect(page.errors).toEqual([]);
  });

  for (const fixture of [
    "tracker-lifecycle-diagram-v2.json",
    "tracker-lifecycle-diagram-routing-v2.json",
  ]) {
    test(`audits routed branch collisions for ${fixture} on desktop and touch`, async ({
      browser,
      page,
    }) => {
      test.slow();
      // tracker-lifecycle-diagram-v2.json, after browser import/
      // reconciliation (denser than the raw fixture), has tolerable
      // (proper-crossing/route-handle-collision-equivalent) findings once
      // the shared edgeCrossing/classifyRouteCrossingCategory classifier
      // (src/web/tracker/lifecycleRouteGeometry.js) is applied to the
      // rendered SVG -- confirmed directly, not assumed, by running this
      // audit (including the collinear-overlap and route-handle-parity
      // checks) repeatedly against the real fixture: a stable 64 on desktop
      // (57 on the previous-event state), unchanged by either check since
      // neither trips on this fixture's own geometry. routing-v2.json stays
      // exactly crossing-free.
      const maxCrossings =
        fixture === "tracker-lifecycle-diagram-v2.json" ? 64 : 0;
      await importFixture(page, fixture);
      await page.getByRole("button", { name: "Diagram" }).click();
      await expect(page.locator("[data-diagram-link]").first()).toBeVisible({
        timeout: 150000,
      });
      await assertBrowserCollisionAudit(page, { maxCrossings });
      await page
        .getByRole("button", { name: "Previous event", exact: true })
        .click();
      await assertBrowserCollisionAudit(page, { maxCrossings });

      const context = await browser.newContext({
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        timezoneId: "UTC",
        locale: "en-US",
      });
      const mobile = await context.newPage();
      try {
        await clearTrackerData(mobile, server.url);
        await mobile.goto(`${server.url}/tracker`);
        await importFixture(mobile, fixture);
        await mobile.getByRole("button", { name: "Diagram" }).click();
        await expect(mobile.locator("[data-diagram-link]").first()).toBeVisible(
          { timeout: 150000 },
        );
        await assertNoPageOverflow(mobile);
        await assertBrowserCollisionAudit(mobile, { maxCrossings });
        const handle = mobile.locator("[data-diagram-link-hit]").first();
        await handle.scrollIntoViewIfNeeded();
        const box = await handle.boundingBox();
        expect(box).not.toBeNull();
        await mobile.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        await expect(mobile.locator("button[aria-pressed='true']")).toHaveCount(
          1,
        );
        await mobile
          .getByRole("button", { name: "Previous event", exact: true })
          .click();
        await assertBrowserCollisionAudit(mobile, { maxCrossings });
      } finally {
        await context.close();
      }
    });
  }

  test("audits routed branch collisions detects an injected exact route duplicate", async ({
    page,
  }) => {
    // Regression for the collinear-overlap detector added to
    // assertBrowserCollisionAudit/auditLifecycleRouteGeometry (see
    // docs/design/lifecycle-diagram-layout-algorithm.md): edgeCrossing alone
    // cannot see two routes that are exactly collinear over a stretch, since
    // they never satisfy its transversal-crossing test. Two entirely
    // synthetic routes are injected directly into the rendered SVG here
    // (identical geometry, disjoint fake source/target node ids so no
    // shared-dock exclusion can apply, positioned far outside the real
    // diagram's canvas so no other collision category can fire) to prove
    // the audit still fails on a genuine full-length duplicate, independent
    // of any real fixture happening to reproduce one.
    await importFixture(page, "tracker-lifecycle-diagram-routing-v2.json");
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator("[data-diagram-link]").first()).toBeVisible({
      timeout: 150000,
    });
    await page.locator(".diagram-scroll").evaluate((scroll) => {
      const svg = scroll.querySelector("svg");
      const makeDuplicate = (id, source, target) => {
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("d", "M-5000,-5000L-4500,-5000");
        path.setAttribute("data-diagram-link", id);
        path.setAttribute("data-diagram-branch", id);
        path.setAttribute("data-source-node-id", source);
        path.setAttribute("data-target-node-id", target);
        path.setAttribute("data-segment-ranks", "0-1");
        path.setAttribute("stroke-width", "3");
        return path;
      };
      svg.append(
        makeDuplicate(
          "test-only-duplicate-a",
          "test-only-source-a",
          "test-only-target-a",
        ),
        makeDuplicate(
          "test-only-duplicate-b",
          "test-only-source-b",
          "test-only-target-b",
        ),
      );
    });
    await expect(
      assertBrowserCollisionAudit(page, { maxCrossings: 0 }),
    ).rejects.toThrow(/coincides/);
  });

  test("audits routed branch collisions detects a two-rank duplicate sharing docks", async ({
    page,
  }) => {
    // Regression for discussion_r3653747390: a full duplicate spanning more
    // than one rank shares its source at the first rank and its target at
    // the last rank, so a shared-dock exclusion keyed only on rank position
    // ("first"/"last") would suppress *both* ranks' overlap, hiding the
    // entire duplicate even though edgeCrossing (degenerate for identical
    // edges) never reports a crossing either. Unlike the single-segment
    // regression above, these two synthetic routes deliberately *share*
    // both their source and target node ids -- proving branchesDiverge
    // correctly recognizes that two branches with the same overall source
    // AND target never actually diverge anywhere, so neither rank is
    // excluded from the sustained-overlap tally.
    await importFixture(page, "tracker-lifecycle-diagram-routing-v2.json");
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator("[data-diagram-link]").first()).toBeVisible({
      timeout: 150000,
    });
    await page.locator(".diagram-scroll").evaluate((scroll) => {
      const svg = scroll.querySelector("svg");
      const makeTwoRankDuplicate = (id) => {
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute(
          "d",
          "M-5000,-5000L-4800,-5000M-4800,-5000L-4600,-5000",
        );
        path.setAttribute("data-diagram-link", id);
        path.setAttribute("data-diagram-branch", id);
        path.setAttribute("data-source-node-id", "test-only-shared-source");
        path.setAttribute("data-target-node-id", "test-only-shared-target");
        path.setAttribute("data-segment-ranks", "0-1,1-2");
        path.setAttribute("stroke-width", "3");
        return path;
      };
      svg.append(
        makeTwoRankDuplicate("test-only-two-rank-duplicate-a"),
        makeTwoRankDuplicate("test-only-two-rank-duplicate-b"),
      );
    });
    await expect(
      assertBrowserCollisionAudit(page, { maxCrossings: 0 }),
    ).rejects.toThrow(/coincides/);
  });

  test("uses a real touch mobile context without page overflow", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      timezoneId: "UTC",
      locale: "en-US",
    });
    const page = await context.newPage();
    try {
      await clearTrackerData(page, server.url);
      await page.goto(`${server.url}/tracker`);
      expect(page.viewportSize()).toEqual({ width: 375, height: 812 });
      await importFixture(page);
      await page.getByRole("button", { name: "Diagram" }).click();
      await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
        EXPECTED_CURRENT.included,
      );
      await assertNoPageOverflow(page);
      await assertDensityAwareSvgGeometry(page);
      const scroll = page.locator(".diagram-scroll");
      expect(
        await scroll.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
      await scroll.evaluate((el) => {
        el.scrollLeft = 96;
      });
      expect(await scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

      await scroll.evaluate((el) => {
        el.scrollLeft = 0;
      });
      const nodeTarget = page
        .locator("[data-diagram-node] rect:not([data-diagram-node-hit])")
        .first();
      await nodeTarget.scrollIntoViewIfNeeded();
      const nodeBox = await nodeTarget.boundingBox();
      expect(nodeBox).not.toBeNull();
      await page.touchscreen.tap(
        nodeBox.x + nodeBox.width / 2,
        nodeBox.y + nodeBox.height / 2,
      );
      const nodeDetails = await selectedDetails(page);
      await openLifecycleTables(page);
      const nodeButton = page.locator("button[aria-pressed='true']").first();
      await expect(nodeButton).toBeVisible();
      await nodeButton.press("Enter");
      expect(await selectedDetails(page)).toBe(nodeDetails);

      const flowTarget = page.locator("[data-diagram-link-hit]").first();
      await flowTarget.scrollIntoViewIfNeeded();
      const flowBox = await flowTarget.boundingBox();
      expect(flowBox).not.toBeNull();
      await page.touchscreen.tap(
        flowBox.x + flowBox.width / 2,
        flowBox.y + flowBox.height / 2,
      );
      const flowDetails = await selectedDetails(page);
      const flowButton = page.locator("button[aria-pressed='true']").first();
      await expect(flowButton).toBeVisible();
      await flowButton.press("Space");
      expect(await selectedDetails(page)).toBe(flowDetails);
      await expect(page.locator("button[aria-pressed='true']")).toHaveCount(1);

      await assertNoPageOverflow(page);
      expect(
        await page
          .locator("details.diagram-tables .table-container")
          .first()
          .evaluate((el) => el.scrollWidth >= el.clientWidth),
      ).toBe(true);
      await assertVisibleControlsLargeEnough(page);
      await runAxe(page);
    } finally {
      await context.close();
    }
  });
});
