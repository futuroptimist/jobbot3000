/* global document, indexedDB, IDBObjectStore, window */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import axe from "axe-core";

import { startWebServer } from "../../src/web/server.js";
import { waitForLifecycleCapture } from "../../scripts/capture-diagram-visual-review.js";

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

// Phase 5b's layout search runs in a Worker: a non-drag render's busy
// window now spans a real, sequentially-processed round-trip rather than a
// near-instant synchronous call, so it can legitimately take longer than
// the default 5s timeout under a slower/more contended CI runner --
// generous margin here for the same reason assertDensityAwareSvgGeometry
// below uses one, rather than tuning tight to one machine.
async function waitForDiagramIdle(page) {
  await expect(page.locator("[data-lifecycle-diagram]")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 150000 },
  );
  await expect(page.locator("[data-diagram-busy]")).toBeHidden({
    timeout: 150000,
  });
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
  const expectedHeight = Math.max(520, 112 + densestColumnCount * 80);
  expect(geometry.height).toBe(expectedHeight);
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
        52 - 0.5,
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

// Audit the rendered filled geometry, rather than treating its closed outline
// as a thin centerline. Solver crossing/handle contracts remain unit-tested.
async function assertBrowserCollisionAudit(page) {
  await waitForDiagramIdle(page);
  const result = await page.locator(".diagram-scroll svg").evaluate((svg) => {
    const errors = [];
    const paths = [...svg.querySelectorAll("[data-diagram-link]")];
    const seen = new Map();
    let unit;
    for (const path of paths) {
      const id = path.dataset.diagramLink;
      const d = path.getAttribute("d");
      if (seen.has(d)) errors.push(`${id} coincides with ${seen.get(d)}`);
      seen.set(d, id);
      if (!d.endsWith("Z") || /NaN|Infinity/u.test(d))
        errors.push(`${id}: unclosed ribbon`);
      if (path.getAttribute("fill") === "none")
        errors.push(`${id}: unfilled ribbon`);
      const count = Number(path.dataset.ribbonCount);
      const width = Number(path.dataset.ribbonWidth);
      if (!(width > 0 && count > 0))
        errors.push(`${id}: invalid thickness/count`);
      unit ??= width / count;
      if (Math.abs(width / count - unit) > 1e-6)
        errors.push(`${id}: inconsistent count scale`);
      const box = path.getBBox();
      if (!(box.width > 0 && box.height > 0)) errors.push(`${id}: empty band`);
      if (
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > svg.viewBox.baseVal.width + 0.01 ||
        box.y + box.height > svg.viewBox.baseVal.height + 0.01
      )
        errors.push(`${id}: clipped band`);
      const source = svg.querySelector(
        `[data-diagram-node="${path.dataset.sourceNodeId}"]`,
      );
      const target = svg.querySelector(
        `[data-diagram-node="${path.dataset.targetNodeId}"]`,
      );
      if (!source || !target) errors.push(`${id}: missing semantic endpoint`);
    }
    for (const hit of svg.querySelectorAll("[data-diagram-link-hit]")) {
      const path = paths.find(
        (p) => p.dataset.diagramLink === hit.dataset.diagramLinkHit,
      );
      const x = Number(hit.getAttribute("cx"));
      const y = Number(hit.getAttribute("cy"));
      const radius = Number(hit.getAttribute("r")) * 0.99;
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8;
        const point = svg.createSVGPoint();
        point.x = x + radius * Math.cos(angle);
        point.y = y + radius * Math.sin(angle);
        if (!path?.isPointInFill(point))
          errors.push("hit region extends outside its ribbon");
      }
    }
    const labels = [...svg.querySelectorAll("[data-diagram-node-label]")];
    for (const [index, label] of labels.entries()) {
      const box = label.getBBox();
      const count = label.querySelector("[data-diagram-node-count]");
      if (!count || !(Number(count.textContent) > 0))
        errors.push("missing visible count");
      for (const other of labels.slice(index + 1)) {
        const b = other.getBBox();
        if (
          box.x < b.x + b.width &&
          box.x + box.width > b.x &&
          box.y < b.y + b.height &&
          box.y + box.height > b.y
        ) {
          errors.push(
            `labels overlap: ${label.textContent} / ${other.textContent}`,
          );
        }
      }
    }
    const obstacles = [
      ...svg.querySelectorAll(
        "[data-diagram-node-label], [data-diagram-node-hit]",
      ),
    ];
    for (const path of paths) {
      let boundaryPoints;
      const bounds = path.getBBox();
      for (const obstacle of obstacles) {
        const nodeId =
          obstacle.dataset.diagramNodeLabel ?? obstacle.dataset.diagramNodeHit;
        if (
          [path.dataset.sourceNodeId, path.dataset.targetNodeId].includes(
            nodeId,
          )
        )
          continue;
        const box = obstacle.getBBox();
        if (
          box.x >= bounds.x + bounds.width ||
          box.x + box.width <= bounds.x ||
          box.y >= bounds.y + bounds.height ||
          box.y + box.height <= bounds.y
        )
          continue;
        let overlaps = false;
        for (let x = box.x + 1; !overlaps && x < box.x + box.width; x += 3) {
          for (let y = box.y + 1; y < box.y + box.height; y += 3) {
            const point = svg.createSVGPoint();
            point.x = x;
            point.y = y;
            if (path.isPointInFill(point)) {
              overlaps = true;
              break;
            }
          }
        }
        // Count-proportional bands can be thinner than the interior grid.
        // Also sample their boundary at <= 1px intervals so those crossings
        // cannot disappear between rows of points inside the obstacle.
        if (!overlaps) {
          if (!boundaryPoints) {
            const length = path.getTotalLength();
            const steps = Math.ceil(length);
            boundaryPoints = Array.from({ length: steps + 1 }, (_, index) =>
              path.getPointAtLength((index * length) / steps),
            );
          }
          overlaps = boundaryPoints.some(
            (point) =>
              point.x > box.x &&
              point.x < box.x + box.width &&
              point.y > box.y &&
              point.y < box.y + box.height,
          );
        }
        if (overlaps)
          errors.push(
            `${path.dataset.diagramLink} crosses ${obstacle.tagName} ${nodeId}`,
          );
      }
    }
    return { errors, count: paths.length };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.errors).toEqual([]);
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
    await waitForDiagramIdle(page);
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
    // This single test deliberately combines desktop + mobile rendering,
    // two axe-core audits, timeline transitions, selection, hostile-input,
    // and persistence checks -- its observed CI runtime approaches the
    // default 60s limit even though it passes comfortably standalone.
    test.slow();
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
    // Phase 5b's layout search runs in a Worker: each of the three
    // non-drag renders below (a button click, range.fill's keyboard-style
    // input with no preceding pointerdown, and another button click) queues
    // its own real, sequentially-processed request. Waiting for the busy
    // indicator to clear after each one -- exactly as a real user
    // naturally would -- keeps them from stacking up behind each other
    // rather than stress-testing an unrelated queueing edge case; the busy
    // indicator itself is covered by the dedicated Phase 5a/5b test suites.
    await page.getByRole("button", { name: "Next event", exact: true }).click();
    await waitForDiagramIdle(page);
    await range.fill("0");
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      /Unknown date|off chronological scale|applications included/u,
    );
    await waitForDiagramIdle(page);
    await page.getByRole("button", { name: "Return to current" }).click();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      EXPECTED_CURRENT.included,
    );
    await waitForDiagramIdle(page);

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
    // The viewport change triggers the ResizeObserver-driven non-drag
    // render described above, but that path goes through
    // debouncedResize's own 80ms debounce (lifecycleDiagram.js's
    // makeDebounce default) before the render even starts -- unlike the
    // button clicks above, there's no earlier assertion here that
    // implicitly waits out that delay, so checking busy-hidden immediately
    // could trivially pass before the debounced render has even begun.
    // Wait past the debounce window first, then wait for it to settle.
    await page.waitForTimeout(200);
    await waitForDiagramIdle(page);
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
    test(`audits filled ribbons for ${fixture} on desktop and touch`, async ({
      browser,
      page,
    }) => {
      test.slow();
      await importFixture(page, fixture);
      await page.getByRole("button", { name: "Diagram" }).click();
      await expect(page.locator("[data-diagram-link]").first()).toBeVisible({
        timeout: 150000,
      });
      await assertBrowserCollisionAudit(page);
      await page
        .getByRole("button", { name: "Previous event", exact: true })
        .click();
      await assertBrowserCollisionAudit(page);

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
        await assertBrowserCollisionAudit(mobile);
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
        await assertBrowserCollisionAudit(mobile);
      } finally {
        await context.close();
      }
    });
  }

  for (const [obstacle, thickness] of [
    ["label", null],
    ["hit", null],
    ["label", 0.25],
    ["hit", 0.25],
  ]) {
    test(`ribbon audit detects injected ${obstacle} collision (${thickness ?? "full"})`, async ({
      page,
    }) => {
      await importFixture(page, "tracker-lifecycle-diagram-routing-v2.json");
      await page.getByRole("button", { name: "Diagram", exact: true }).click();
      await waitForLifecycleCapture(page);
      await assertBrowserCollisionAudit(page);
      await page.locator(".diagram-scroll svg").evaluate(
        (svg, { kind, bandHeight }) => {
          const collision = svg
            .querySelector("[data-diagram-link]")
            .cloneNode(true);
          const incident = [
            collision.dataset.sourceNodeId,
            collision.dataset.targetNodeId,
          ];
          const node = [...svg.querySelectorAll("[data-diagram-node]")].find(
            (group) => !incident.includes(group.dataset.diagramNode),
          );
          const box = node
            .querySelector(`[data-diagram-node-${kind}]`)
            .getBBox();
          collision.dataset.diagramLink = "synthetic-obstacle-collision";
          const { x, width: w } = box;
          // A subpixel band between grid samples must still be detected.
          const y = box.y + (bandHeight ? 2.25 : 0);
          const h = bandHeight ?? box.height;
          collision.setAttribute(
            "d",
            `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`,
          );
          svg.append(collision);
        },
        { kind: obstacle, bandHeight: thickness },
      );
      await expect(assertBrowserCollisionAudit(page)).rejects.toThrow(
        /crosses (text|rect)/u,
      );
    });
  }

  test("capture waits for the requested bucket across an idle async gap", async ({
    page,
  }) => {
    await importFixture(page, "tracker-lifecycle-diagram-routing-v2.json");
    await page.getByRole("button", { name: "Diagram", exact: true }).click();
    await waitForLifecycleCapture(page);
    const range = page.locator('[data-lifecycle-diagram] input[type="range"]');
    const requested = Number(await range.inputValue()) - 1;
    const previous = page.getByRole("button", {
      name: "Previous event",
      exact: true,
    });
    await previous.evaluate((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.stopImmediatePropagation();
          setTimeout(() => button.click(), 200);
        },
        { capture: true, once: true },
      );
    });
    await previous.click();
    await waitForLifecycleCapture(page, requested);
    expect(await range.inputValue()).toBe(String(requested));
    await expect(page.locator(".diagram-scroll")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("renders identical synthetic pixels after revisiting the diagram", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-05-01T00:00:00.000Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await importFixture(page, "tracker-lifecycle-diagram-routing-v2.json");
    await page.getByRole("button", { name: "Diagram", exact: true }).click();
    await waitForDiagramIdle(page);
    const svg = page.locator(".diagram-scroll svg");
    const before = await svg.screenshot({ animations: "disabled" });
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    // Let the hidden tab's ResizeObserver debounce run, as it does when a
    // person spends time elsewhere or CI takes longer between input calls.
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Diagram", exact: true }).click();
    await waitForDiagramIdle(page);
    expect(await svg.screenshot({ animations: "disabled" })).toEqual(before);
    await expect(svg).toHaveAttribute("data-reduced-motion", "true");
    await expect(page.locator(".diagram-scale-note")).toContainText(
      "not elapsed time",
    );
  });

  test("capture waits for a revisit's pending projection-cache read", async ({
    page,
  }) => {
    await importFixture(page, "tracker-lifecycle-diagram-routing-v2.json");
    await page.getByRole("button", { name: "Diagram", exact: true }).click();
    await waitForLifecycleCapture(page);
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.evaluate(() => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        const request = get.apply(this, args);
        if (this.name === "lifecycleProjectionCache") {
          IDBObjectStore.prototype.get = get;
          request.addEventListener(
            "success",
            (event) => {
              event.stopImmediatePropagation();
              window.releaseLifecycleCacheRead = () =>
                request.onsuccess?.call(request, event);
            },
            { capture: true, once: true },
          );
        }
        return request;
      };
    });
    await page.getByRole("button", { name: "Diagram", exact: true }).click();
    await page.waitForFunction(() => window.releaseLifecycleCacheRead);
    let captured = false;
    const capture = waitForLifecycleCapture(page).then(() => {
      captured = true;
    });
    try {
      // The old SVG is idle while the held IndexedDB read prevents update().
      // Capture must remain pending until that request is released and drawn.
      await page.waitForTimeout(100);
      expect(captured).toBe(false);
    } finally {
      await page.evaluate(() => window.releaseLifecycleCacheRead());
      await capture;
    }
    await expect(page.locator("[data-lifecycle-diagram]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  for (const sharedDocks of [false, true]) {
    test(`ribbon audit detects duplicate filled geometry (shared docks: ${sharedDocks})`, async ({
      page,
    }) => {
      await importFixture(page, "tracker-lifecycle-diagram-routing-v2.json");
      await page.getByRole("button", { name: "Diagram" }).click();
      await waitForDiagramIdle(page);
      await page.locator(".diagram-scroll svg").evaluate((svg, sameDocks) => {
        const duplicate = svg
          .querySelector("[data-diagram-link]")
          .cloneNode(true);
        duplicate.dataset.diagramLink = "synthetic-duplicate";
        if (!sameDocks) {
          duplicate.dataset.sourceNodeId = "synthetic-other-source";
          duplicate.dataset.targetNodeId = "synthetic-other-target";
        }
        svg.append(duplicate);
      }, sharedDocks);
      await expect(assertBrowserCollisionAudit(page)).rejects.toThrow(
        /coincides/u,
      );
    });
  }

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
