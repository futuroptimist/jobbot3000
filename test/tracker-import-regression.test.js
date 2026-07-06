import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  parseCsv,
  previewCompactCsvImport,
} from "../src/web/import-export/spreadsheet.js";

const compactFixturePath =
  "test/fixtures/tracker-import/compact-main-regression.csv";
const nonInterviewStageLabels = [
  "Not started",
  "Hiring manager follow-up",
  "Application rejected",
  "Written assessment submitted",
  "Recruiter screen pending",
];

const loadCompactFixture = () => readFile(compactFixturePath, "utf8");

const applicationIdsWithResponses = (rows) =>
  new Set(
    rows
      .filter(
        (row) =>
          row.outreach_status === "replied" ||
          row.outcome === "rejected" ||
          row.interview_stage === "Written assessment submitted",
      )
      .map((row) => row.application_id),
  );

describe("tracker compact CSV staging regression fixtures", () => {
  it("keeps the anonymized compact fixture structurally faithful", async () => {
    const rows = parseCsv(await loadCompactFixture());

    expect(rows).toHaveLength(15);
    expect(rows.filter((row) => row.outreach_message_text.trim())).toHaveLength(
      7,
    );
    expect(
      rows.filter((row) => row.interview_stage === "Not started"),
    ).toHaveLength(11);
    expect(
      rows.filter((row) => row.outreach_status === "replied"),
    ).toHaveLength(2);
    expect(rows.filter((row) => row.outcome === "rejected")).toHaveLength(1);
    expect(rows.some((row) => row.outreach_message_text.includes("\n"))).toBe(
      true,
    );
    expect(
      rows.some(
        (row) =>
          row.compensation_min_usd === "" && row.compensation_max_usd === "",
      ),
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.compensation_min_usd !== "" && row.compensation_max_usd !== "",
      ),
    ).toBe(true);
    expect(rows.every((row) => row.posting_url.includes("example.test"))).toBe(
      true,
    );
    expect(rows.map((row) => row.interview_stage)).toEqual(
      expect.arrayContaining(nonInterviewStageLabels),
    );
  });

  it("previews compact CSV dashboard semantics without phantom interviews", async () => {
    const csv = await loadCompactFixture();
    const rows = parseCsv(csv);
    const preview = await previewCompactCsvImport(csv);
    const { bundle } = preview;

    expect(preview.errors).toEqual([]);
    expect(bundle.applications).toHaveLength(15);
    expect(bundle.outreachMessages).toHaveLength(7);
    expect(bundle.interviews).toHaveLength(0);
    expect(bundle.offers).toHaveLength(0);
    expect(
      bundle.applications.filter(
        (application) => application.status === "recruiter_screen",
      ),
    ).toHaveLength(0);

    const responseCount = applicationIdsWithResponses(rows).size;
    expect(responseCount).toBe(4);
    expect(Math.round((responseCount / bundle.applications.length) * 100)).toBe(
      27,
    );
    expect(Math.round((2 / bundle.outreachMessages.length) * 100)).toBe(29);
  });

  it("does not turn compact human-readable stage labels into interviews", async () => {
    const rows = parseCsv(await loadCompactFixture());
    const preview = await previewCompactCsvImport(await loadCompactFixture());

    for (const label of nonInterviewStageLabels) {
      const applicationIds = rows
        .filter((row) => row.interview_stage === label)
        .map((row) => row.application_id);
      expect(
        applicationIds.length,
        `fixture includes ${label}`,
      ).toBeGreaterThan(0);
      expect(
        preview.bundle.interviews.filter((interview) =>
          applicationIds.includes(interview.applicationId),
        ),
        `${label} must not create interviews`,
      ).toEqual([]);
    }
  });

  it("requires the browser tracker to avoid the legacy duplicate CSV parser", async () => {
    const trackerSource = await readFile("src/web/tracker/tracker.js", "utf8");

    expect(trackerSource).toContain("previewCompactCsvImport");
    expect(trackerSource).toContain("importCompactCsv");
    expect(trackerSource).not.toMatch(
      /if \(r\.interview_stage\)\s*records\.interviews\.push/s,
    );
  });
});
