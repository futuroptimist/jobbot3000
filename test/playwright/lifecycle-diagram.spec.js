/* global document, window */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

const endpointLabels = [
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
];

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

async function injectAxe(page) {
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
}

async function expectNoAxeViolations(page) {
  const result = await page.evaluate(async () =>
    window.axe.run(document.querySelector('[data-view="diagram"]')),
  );
  expect(result.violations).toEqual([]);
}

async function expectNoMalformedSvg(page) {
  await expect(page.locator('[data-view="diagram"] svg')).toHaveAttribute(
    "role",
    "img",
  );
  await expect(
    page.locator('[data-view="diagram"] svg > title'),
  ).not.toHaveText("");
  await expect(page.locator('[data-view="diagram"] svg > desc')).not.toHaveText(
    "",
  );
  const bad = await page
    .locator('[data-view="diagram"] svg path')
    .evaluateAll((paths) =>
      paths.some((path) =>
        /NaN|Infinity|javascript:|</u.test(path.getAttribute("d") ?? ""),
      ),
    );
  expect(bad).toBe(false);
}

test.describe("Application Lifecycle Diagram", () => {
  let server;
  const consoleErrors = [];
  const pageErrors = [];

  test.beforeAll(async () => {
    server = await startWebServer({ host: "127.0.0.1", port: 0 });
  });

  test.afterAll(async () => {
    await server?.close?.();
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${server.url}/tracker`);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("empty, seeded, history, selection, responsive, security, and read-only journeys", async ({
    page,
    context,
  }) => {
    await injectAxe(page);
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.getByRole("heading", { name: "Diagram" })).toBeVisible();
    await expect(page.locator('[data-view="diagram"]')).toContainText(
      "0/0 applications included",
    );
    await expectNoAxeViolations(page);

    const requests = [];
    page.on("request", (request) => requests.push(request));
    await importFixture(page);
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator('[data-view="diagram"]')).toContainText(
      "13/13 applications included",
    );
    await expect(page.locator("caption", { hasText: "Origins" })).toBeVisible();
    await expect(
      page.locator("caption", { hasText: "Endpoints" }),
    ).toBeVisible();
    const endpointTable = page.locator("table", {
      has: page.locator("caption", { hasText: "Endpoints" }),
    });
    for (const label of endpointLabels)
      await expect(
        endpointTable.getByText(label, { exact: true }),
      ).toBeVisible();
    await expectNoMalformedSvg(page);
    await expectNoAxeViolations(page);

    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    await expect(
      page.locator('[data-view="diagram"] input[type="range"]'),
    ).toHaveAttribute("aria-valuetext", /2026|Unknown|Current/);
    await expect(page.locator('[data-view="diagram"]')).toContainText(
      /time not recorded|Unknown date|Current/,
    );
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Return to current" }).click();
    await expect(page.locator('[data-view="diagram"]')).toContainText(
      "13/13 applications included",
    );

    await page
      .locator('[data-diagram-node="origin:application_submitted"]')
      .click();
    const selectedText = await page
      .locator("[data-diagram-details]")
      .innerText();
    await expect(
      page.locator('.diagram-select-button[aria-pressed="true"]'),
    ).toContainText("Application submitted");
    await page.locator("[data-diagram-link]").first().click({ force: true });
    await expect(page.locator("[data-diagram-details]")).not.toHaveText(
      selectedText,
    );

    await page.setViewportSize({ width: 375, height: 812 });
    await context.grantPermissions([]);
    await expect(page.locator(".diagram-scroll")).toBeVisible();
    const mobile = await page.evaluate(() => ({
      pageScroll:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
      chartScrolls:
        document.querySelector(".diagram-scroll").scrollWidth >
        document.querySelector(".diagram-scroll").clientWidth,
      named: Boolean(
        document.querySelector(".diagram-scroll").getAttribute("aria-label"),
      ),
    }));
    expect(mobile).toEqual({
      pageScroll: true,
      chartScrolls: true,
      named: true,
    });
    await page
      .locator("[data-diagram-node-hit]")
      .first()
      .click({ force: true });
    await expect(page.locator("[data-diagram-details]")).toContainText(
      "application",
    );
    await expectNoAxeViolations(page);

    const unsafeSelector = [
      '[data-view="diagram"] script',
      '[data-view="diagram"] foreignObject',
      '[data-view="diagram"] [onerror]',
      '[data-view="diagram"] a[href^="javascript:"]',
    ].join(", ");
    const unsafe = await page.locator(unsafeSelector).count();
    expect(unsafe).toBe(0);
    expect(
      requests.filter((request) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()),
      ),
    ).toEqual([]);
    expect(
      requests.every((request) => new URL(request.url()).origin === server.url),
    ).toBe(true);
    expect(await context.cookies()).toEqual([]);
    await expect(page).toHaveURL(/\/tracker$/);
  });
});
