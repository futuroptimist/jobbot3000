import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

function createListingsAdapter() {
  const providers = [
    { id: "all", label: "All providers", requiresIdentifier: false },
    {
      id: "greenhouse",
      label: "Greenhouse",
      identifierLabel: "Board slug",
      placeholder: "acme-co",
      requiresIdentifier: true,
    },
  ];

  const listings = [
    {
      jobId: "job-1",
      title: "Staff Software Engineer",
      company: "Acme Co",
      location: "Remote",
      team: "Platform",
      remote: true,
      url: "https://example.com/job-1",
      ingested: false,
      provider: "greenhouse",
      identifier: "acme-co",
    },
    {
      jobId: "job-2",
      title: "Product Engineer",
      company: "Acme Co",
      location: "Austin, TX",
      team: "Product",
      remote: false,
      url: "https://example.com/job-2",
      ingested: false,
      provider: "greenhouse",
      identifier: "acme-co",
    },
  ];

  const ingestCalls = [];

  const adapter = {
    "listings-providers": async () => ({
      command: "listings-providers",
      format: "json",
      stdout: "",
      stderr: "",
      data: { providers, tokenStatus: [] },
    }),
    "listings-fetch": async (payload) => ({
      command: "listings-fetch",
      format: "json",
      stdout: "",
      stderr: "",
      data: {
        provider: payload.provider,
        identifier: payload.identifier,
        listings: listings.map((entry) => ({ ...entry })),
      },
    }),
    "listings-ingest": async (payload) => {
      ingestCalls.push(payload);
      const target = listings.find((item) => item.jobId === payload.jobId);
      if (target) {
        target.ingested = true;
      }
      return {
        command: "listings-ingest",
        format: "json",
        stdout: "",
        stderr: "",
        data: {
          listing: target ? { ...target } : null,
        },
      };
    },
    "listings-archive": async (payload) => ({
      command: "listings-archive",
      format: "json",
      stdout: "",
      stderr: "",
      data: { jobId: payload.jobId, archived: true },
    }),
  };

  adapter.listingsProviders = adapter["listings-providers"];
  adapter.listingsFetch = adapter["listings-fetch"];
  adapter.listingsIngest = adapter["listings-ingest"];
  adapter.listingsArchive = adapter["listings-archive"];

  return { adapter, ingestCalls, listings };
}

test.describe("Listings tab", () => {
  let server;
  let ingestCalls;

  test.beforeAll(async () => {
    const { adapter, ingestCalls: calls } = createListingsAdapter();
    ingestCalls = calls;
    server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      csrfToken: "playwright-csrf-token",
      commandAdapter: adapter,
    });
  });

  test.afterAll(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  test("fetches and ingests a listing using the default All provider", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByRole("link", { name: "Listings" }).click();

    await expect(page.locator("[data-listings-form]")).toBeVisible();
    await expect(page.locator("[data-listings-provider]")).toHaveValue("all");
    await expect(page.locator("[data-listings-identifier]")).toBeDisabled();

    const identifierHidden = await page
      .locator("[data-listings-identifier]")
      .evaluate((node) => node.closest("label")?.hasAttribute("hidden"));
    expect(identifierHidden).toBe(true);

    await page
      .locator('[data-listings-filter="title"]')
      .fill("Software Engineer");
    await page.locator("[data-listings-submit]").click();

    await expect(page.locator(".listing-card")).toHaveCount(2);
    await expect(page.locator(".listing-card").first()).toContainText(
      "Staff Software Engineer",
    );

    const ingestButton = page
      .locator(".listing-card")
      .first()
      .getByRole("button", { name: "Ingest listing" });
    await ingestButton.click();

    await expect(
      page.locator(".listing-card").first().locator(".listing-card__badge"),
    ).toHaveText("Ingested");
    await expect(page.locator("[data-listings-message]")).toContainText(
      "Listing ingested",
    );

    await expect.poll(() => ingestCalls.length).toBe(1);
    expect(ingestCalls[0]).toMatchObject({
      provider: "greenhouse",
      identifier: "acme-co",
    });
  });
});
