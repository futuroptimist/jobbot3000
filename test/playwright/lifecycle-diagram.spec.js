/* global document, indexedDB, window */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import axe from "axe-core";

import { startWebServer } from "../../src/web/server.js";

const EXPECTED_CURRENT = {
  included: "16/16 applications included",
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
    await expect(page.locator("details.diagram-tables")).not.toHaveAttribute(
      "open",
      "",
    );
    await page.getByText("Lifecycle data tables").click();
    await expect(page.locator("details.diagram-tables")).toHaveAttribute(
      "open",
      "",
    );
    for (const label of EXPECTED_CURRENT.endpoints) {
      await expect(
        page
          .locator("caption", { hasText: "Endpoints" })
          .locator("..", { hasText: label }),
      ).toBeVisible();
    }
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
    await page.getByRole("button", { name: "Next event", exact: true }).click();
    await range.fill("0");
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      /Unknown date|off chronological scale|applications included/u,
    );
    await page.getByRole("button", { name: "Return to current" }).click();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      EXPECTED_CURRENT.included,
    );

    const node = page
      .locator("[data-diagram-node] rect:not([data-diagram-node-hit])")
      .first();
    await node.click();
    const selected = await page.locator("[data-diagram-details]").innerText();
    await expect(
      page.locator("button[aria-pressed='true']").first(),
    ).toBeVisible();
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
    await scroll.evaluate((el) => {
      el.scrollLeft = 80;
    });
    expect(await scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
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
      const nodeBox = await page
        .locator("[data-diagram-node-hit]")
        .first()
        .boundingBox();
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

      const flowBox = await page
        .locator("[data-diagram-link-hit]")
        .first()
        .boundingBox();
      expect(flowBox).not.toBeNull();
      await page.touchscreen.tap(
        flowBox.x + flowBox.width / 2,
        flowBox.y + flowBox.height / 2,
      );
      const flowDetails = await selectedDetails(page);
      const flowButton = page.locator("button[aria-pressed='true']").first();
      await expect(flowButton).toBeVisible();
      await flowButton.press(" ");
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
