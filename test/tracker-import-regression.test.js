import { readFile } from "node:fs/promises";

import { fireEvent, waitFor } from "@testing-library/dom";
import { indexedDB } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";
import {
  csvToBrowserApplicationExport,
  previewCompactCsvImport,
} from "../src/web/import-export/spreadsheet.js";

const compactFixturePath =
  "test/fixtures/tracker-import/compact-main-regression.csv";
const compactFixture = () => readFile(compactFixturePath, "utf8");

const deleteDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

const metricValue = (document, label) => {
  const metric = Array.from(document.querySelectorAll(".metric")).find(
    (node) => node.querySelector("span")?.textContent === label,
  );
  return metric?.querySelector("strong")?.textContent;
};

const loadTrackerDom = async () => {
  const html = await readFile("src/web/tracker/index.html", "utf8");
  const dom = new JSDOM(html, {
    url: "https://example.test/tracker/",
    pretendToBeVisual: true,
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    indexedDB: globalThis.indexedDB,
    crypto: globalThis.crypto,
    confirm: globalThis.confirm,
    URL: globalThis.URL,
    Blob: globalThis.Blob,
  };
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("crypto", dom.window.crypto);
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("URL", dom.window.URL);
  vi.stubGlobal("Blob", dom.window.Blob);
  await import("../src/web/tracker/tracker.js");
  await waitFor(() =>
    expect(
      dom.window.document.querySelector("[data-metrics]").textContent,
    ).toContain("Total applications"),
  );
  return { dom, previous };
};

const restoreGlobals = (previous) => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(previous)) {
    if (value !== undefined) vi.stubGlobal(key, value);
  }
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await deleteDatabase();
});

describe("tracker compact CSV import regression fixtures", () => {
  it("documents canonical compact import semantics for placeholder labels", async () => {
    const csv = await compactFixture();
    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-01T00:00:00.000Z",
    });

    expect(errors).toEqual([]);
    expect(bundle.applications).toHaveLength(15);
    expect(bundle.outreachMessages).toHaveLength(7);
    expect(bundle.interviews).toHaveLength(0);
    expect(bundle.offers).toHaveLength(0);
    expect(
      bundle.applications.filter((app) => app.status === "recruiter_screen"),
    ).toHaveLength(0);
    expect(
      bundle.applications.filter((app) => app.status === "rejected"),
    ).toHaveLength(1);

    for (const ignoredStage of [
      "Not started",
      "Hiring manager follow-up",
      "Application rejected",
      "Written assessment submitted",
      "Recruiter screen pending",
    ]) {
      expect(bundle.interviews).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: ignoredStage }),
        ]),
      );
      expect(bundle.lifecycleEvents).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ note: ignoredStage }),
        ]),
      );
    }

    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const preview = await previewCompactCsvImport(csv, repo);
    expect(preview.rowCount).toBe(15);
    expect(preview.bundle.interviews).toHaveLength(0);
    repo.close();
  });

  it("keeps tracker preview and dashboard metrics from counting stage labels", async () => {
    const csv = await compactFixture();
    const { dom, previous } = await loadTrackerDom();
    try {
      const fileInput = dom.window.document.querySelector("[data-import-file]");
      const previewButton = dom.window.document.querySelector(
        "[data-import-preview]",
      );
      const applyButton = dom.window.document.querySelector(
        "[data-import-apply]",
      );
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: [
          {
            name: "compact-main-regression.csv",
            text: async () => csv,
          },
        ],
      });

      fireEvent.click(previewButton);
      await waitFor(() =>
        expect(
          dom.window.document.querySelector("[data-import-result]").textContent,
        ).toContain("15 applications, 7 outreach messages, 0 interviews"),
      );

      fireEvent.click(applyButton);
      await waitFor(() =>
        expect(metricValue(dom.window.document, "Total applications")).toBe(
          "15",
        ),
      );

      expect(metricValue(dom.window.document, "Interviews")).toBe("0");
      expect(metricValue(dom.window.document, "Offers")).toBe("0");
      expect(metricValue(dom.window.document, "Recruiter screens")).toBe("0");
      expect(
        metricValue(dom.window.document, "Application response rate"),
      ).toBe("27%");
      expect(metricValue(dom.window.document, "Outreach reply rate")).toBe(
        "29%",
      );
    } finally {
      dom.window.close();
      restoreGlobals(previous);
    }
  });
});
