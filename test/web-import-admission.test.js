import { describe, expect, it, vi } from "vitest";
import {
  IMPORT_LIMITS_V1 as L,
  ImportAdmissionError,
  assertImportFileSize,
  assertImportTextBudget,
  assertImportObjectBudget,
  assertImportRowsBudget,
  assertImportCandidateBudget,
  importNdjsonLines,
} from "../src/web/import-export/importAdmission.js";
import {
  parseCsv,
  serializeCsv,
  importJsonBackup,
  importNdjsonBackup,
  previewCompactCsvImport,
} from "../src/web/import-export/spreadsheet.js";

const reject = (run) => expect(run).toThrow(ImportAdmissionError);
describe("import admission policy v1", () => {
  it("bounds file and UTF-8 bytes at the exact boundary", () => {
    expect(Object.isFrozen(L)).toBe(true);
    expect(() => assertImportFileSize(L.bytes)).not.toThrow();
    for (const size of [L.bytes + 1, -1, NaN, Infinity])
      reject(() => assertImportFileSize(size));
    expect(() =>
      assertImportTextBudget("é".repeat(L.bytes / 2), "csv"),
    ).not.toThrow();
    reject(() => assertImportTextBudget("é".repeat(L.bytes / 2) + "a", "csv"));
    reject(() => importJsonBackup(" ".repeat(L.bytes + 1)));
  });
  it("bounds JSON depth and ignores escaped structural characters", () => {
    const nested = (depth) =>
      "[".repeat(depth - 1) + "0" + "]".repeat(depth - 1);
    expect(() =>
      assertImportObjectBudget(JSON.parse(nested(L.depth))),
    ).not.toThrow();
    reject(() => assertImportObjectBudget(JSON.parse(nested(L.depth + 1))));
    reject(() => assertImportTextBudget("[".repeat(33), "json"));
    expect(() =>
      assertImportTextBudget(JSON.stringify('"\\' + "{".repeat(50)), "json"),
    ).not.toThrow();
  });
  it("counts values and object keys with aggregate work", () => {
    expect(() =>
      assertImportObjectBudget(Array(L.units - 1).fill(null)),
    ).not.toThrow();
    reject(() => assertImportObjectBudget(Array(L.units).fill(null)));
    const work = { units: L.units - 3 };
    assertImportObjectBudget({ a: 1 }, work);
    expect(work.units).toBe(L.units);
    reject(() => assertImportObjectBudget(null, work));
  });
  it("rejects accessors, cycles and non-JSON values without invoking getters", () => {
    const getter = vi.fn();
    const accessor = Object.defineProperty({}, "canary", {
      enumerable: true,
      get: getter,
    });
    const cycle = {};
    cycle.self = cycle;
    for (const value of [
      accessor,
      cycle,
      new Date(),
      NaN,
      Infinity,
      1n,
      () => {},
      { [Symbol("canary")]: 1 },
      [undefined],
      Array(2),
    ])
      reject(() => assertImportObjectBudget(value));
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      assertImportObjectBudget({ optional: undefined }),
    ).not.toThrow();
    expect(() =>
      assertImportObjectBudget({ note: "x".repeat(L.stringLength) }),
    ).not.toThrow();
    reject(() =>
      assertImportObjectBudget({ note: "x".repeat(L.stringLength + 1) }),
    );
  });
  it("enforces CSV width, rows and field length while preserving canonical text", () => {
    const columns = Array.from({ length: L.csvColumns }, (_, i) => `c${i}`);
    expect(parseCsv(columns.join(",") + "\n" + columns.join(","))).toHaveLength(
      1,
    );
    reject(() => parseCsv([...columns, "extra"].join(",")));
    expect(parseCsv("a\n" + "x\n".repeat(L.csvRows))).toHaveLength(L.csvRows);
    reject(() => parseCsv("a\n" + "\n".repeat(L.csvRows + 1)));
    expect(parseCsv("a\n" + "x".repeat(L.stringLength))[0].a).toHaveLength(
      L.stringLength,
    );
    reject(() => parseCsv("a\n" + "x".repeat(L.stringLength + 1)));
    for (const csv of [
      "a,a\nx,y",
      " Role_Title ,role_title\nx,y",
      "a\nx,y",
      'a\n"oops',
    ]) {
      reject(() => parseCsv(csv));
    }
    const rows = [
      {
        a: "=1+1",
        b: "+literal",
        c: "-literal",
        d: "@literal",
        e: "\ttext",
        f: "'text",
        g: 'é,"quoted"\nnext',
        h: "",
      },
    ];
    expect(
      parseCsv(
        "\uFEFF" +
          serializeCsv(rows, Object.keys(rows[0])).replaceAll("\n", "\r\n"),
      ),
    ).toEqual([{ ...rows[0], g: 'é,"quoted"\r\nnext' }]);
    expect(parseCsv("a,b\nx")).toEqual([{ a: "x", b: "" }]);
  });
  it("bounds physical NDJSON lines before parsing", () => {
    expect(
      [...importNdjsonLines("\n{}\r\n\n{}")].map((x) => x.sourceLine),
    ).toEqual([2, 4]);
    expect([...importNdjsonLines("{}\n".repeat(L.ndjsonLines))]).toHaveLength(
      L.ndjsonLines,
    );
    reject(() => [...importNdjsonLines("{}\n".repeat(L.ndjsonLines + 1))]);
    expect([...importNdjsonLines(" ".repeat(L.lineBytes))]).toEqual([]);
    reject(() => [...importNdjsonLines(" ".repeat(L.lineBytes + 1))]);
  });
  it("rejects duplicate envelopes, unknown types and malformed input safely", async () => {
    const canary = "PRIVATE_SYNTHETIC_CANARY";
    for (const text of [
      '{"type":"meta"}\n{"type":"meta"}',
      '{"type":"settings"}\n{"type":"settings"}',
      JSON.stringify({ type: canary }),
      '{"type":"meta"}\n' + canary,
    ]) {
      try {
        importNdjsonBackup(text);
        throw new Error("Expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(ImportAdmissionError);
        expect(JSON.stringify(error) + error.message).not.toContain(canary);
      }
    }
    reject(() => importJsonBackup('{"' + canary));
    const result = await previewCompactCsvImport('a\n"' + canary);
    expect(result.errors[0].code).toBe("import_admission_failed");
    expect(JSON.stringify(result)).not.toContain(canary);
  });
  it("bounds each candidate record class and duplicate partial IDs", () => {
    const records = (n) =>
      Array.from({ length: n }, (_, id) => ({ id: String(id) }));
    for (const [store, limit] of [
      ["applications", L.applications],
      ["lifecycleEvents", L.lifecycleEvents],
      ["contacts", L.records],
    ]) {
      expect(() =>
        assertImportCandidateBudget({ [store]: records(limit) }),
      ).not.toThrow();
      reject(() =>
        assertImportCandidateBudget({ [store]: records(limit + 1) }),
      );
    }
    reject(() =>
      assertImportCandidateBudget({
        contacts: records(L.records),
        reminders: [{ id: "r" }],
      }),
    );
    reject(() =>
      assertImportCandidateBudget(
        { contacts: [{ id: " a " }, { id: "a" }] },
        { kind: "partial" },
      ),
    );
    reject(() =>
      assertImportCandidateBudget({ arbitrary: [] }, { kind: "partial" }),
    );
  });
  it("bounds contact edges and supersession chains", () => {
    const candidate = {
      interviews: [{ id: "i", contactIds: Array(L.contactEdges).fill("c") }],
    };
    expect(() => assertImportCandidateBudget(candidate)).not.toThrow();
    candidate.interviews[0].contactIds.push("c");
    reject(() => assertImportCandidateBudget(candidate));
    const chain = (n) => ({
      lifecycleEvents: Array.from({ length: n }, (_, i) => ({
        id: String(i),
        supersedesEventId: i ? String(i - 1) : undefined,
      })),
    });
    expect(() =>
      assertImportCandidateBudget(chain(L.supersessionChain)),
    ).not.toThrow();
    reject(() => assertImportCandidateBudget(chain(L.supersessionChain + 1)));
    reject(() =>
      assertImportCandidateBudget({
        lifecycleEvents: [{ id: "x", supersedesEventId: "x" }],
      }),
    );
  });
});

it("caps diagnostics without truncating row validation or leaking cell values", async () => {
  const text =
    "company,role_title,applied_at\n" +
    "Example,Engineer,SYNTHETIC_PRIVATE_CANARY\n".repeat(60);
  const result = await previewCompactCsvImport(text);
  expect(result.errors).toHaveLength(50);
  expect(result.truncated).toBe(true);
  expect(result.validRowCount).toBe(0);
  expect(JSON.stringify(result.errors)).not.toContain(
    "SYNTHETIC_PRIVATE_CANARY",
  );
});
it("bounds lexical structure across all NDJSON lines", () => {
  const line = JSON.stringify(Array(60000).fill(0));
  expect(() => assertImportTextBudget(line, "json")).not.toThrow();
  reject(() => assertImportTextBudget(line + "\n" + line, "ndjson"));
  try {
    importNdjsonBackup('\n{"type":"meta"}\nSYNTHETIC_PRIVATE_CANARY');
  } catch (error) {
    expect(error.issues[0].sourceLine).toBe(3);
  }
});

it("applies CSV row budgets to direct object callers", () => {
  expect(() =>
    assertImportRowsBudget(Array.from({ length: L.csvRows }, () => ({}))),
  ).not.toThrow();
  reject(() =>
    assertImportRowsBudget(Array.from({ length: L.csvRows + 1 }, () => ({}))),
  );
  const row = Object.fromEntries(
    Array.from({ length: L.csvColumns + 1 }, (_, i) => [`c${i}`, ""]),
  );
  reject(() => assertImportRowsBudget([row]));
});
