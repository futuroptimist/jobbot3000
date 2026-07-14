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
    "Application submitted to Awaiting response": "2",
    "Technical interview to Interviewing": "3",
    "Offer received to Offer/negotiating": "2",
    "Other/unknown to Employer rejected": "1",
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

async function importFixture(page) {
  const text = await readFile(
    "test/fixtures/tracker-lifecycle-diagram-v2.json",
    "utf8",
  );
  await page.getByRole("button", { name: "Import/Export" }).click();
  await page.setInputFiles("[data-import-file]", {
    name: "tracker-lifecycle-diagram-v2.json",
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
  const countIndex = caption === "Flows" ? 2 : 1;
  expect(
    Object.fromEntries(rows.map((row) => [row[0], row[countIndex]])),
  ).toMatchObject(expected);
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

async function assertDensityAwareSvgGeometry(page) {
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
  const expectedHeight = geometry.height;
  expect(geometry.height).toBe(expectedHeight);
  expect(geometry.viewBoxHeight).toBe(expectedHeight);
  expect(geometry.pageOverflow).toBe(false);
  expect(geometry.scrollHeight).toBeGreaterThanOrEqual(expectedHeight);
  expect(geometry.scrollClientHeight).toBeGreaterThanOrEqual(expectedHeight);
  for (const node of geometry.nodes) {
    expect(node.y0, node.id).toBeGreaterThanOrEqual(64 - 0.5);
    expect(node.y1, node.id).toBeLessThanOrEqual(expectedHeight - 48 + 0.5);
    expect(node.hitY0, node.id).toBeGreaterThanOrEqual(0 - 0.5);
    expect(node.hitY1, node.id).toBeLessThanOrEqual(expectedHeight + 0.5);
    expect(node.labelTop, node.id).toBeGreaterThanOrEqual(0 - 0.5);
    expect(node.labelBottom, node.id).toBeLessThanOrEqual(expectedHeight + 0.5);
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
    ).toBeVisible();
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
    await page
      .locator("[data-diagram-link-hit]")
      .first()
      .click({ force: true });
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
      .locator("[data-diagram-node-hit]")
      .first()
      .click({ force: true });
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

  test("uses a real touch mobile context without page overflow", async ({
    browser,
  }) => {
    test.setTimeout(120000);
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
      await expect(
        page.locator("[data-diagram-node-hit]").first(),
      ).toBeAttached();
      await expect(
        page.locator("[data-diagram-link-hit]").first(),
      ).toBeAttached();

      await assertNoPageOverflow(page);
    } finally {
      await context.close();
    }
  });
});
