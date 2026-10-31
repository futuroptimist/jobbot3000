/* global document */
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_LIMITS_V1 } from "../src/web/import-export/importAdmission.js";

const empty = () => ({
  schemaVersion: 2,
  exportedAt: "2026-01-01T00:00:00.000Z",
  applications: [],
  contacts: [],
  outreachMessages: [],
  lifecycleEvents: [],
  interviews: [],
  offers: [],
  artifacts: [],
  reminders: [],
});
let dom;
let repository;
const $ = (selector) => document.querySelector(selector);
const input = () => $("[data-import-file]");
const apply = () => $("[data-import-apply]");
const preview = () => $("[data-import-preview]").onclick();
const select = (file) => {
  Object.defineProperty(input(), "files", {
    value: file ? [file] : [],
    configurable: true,
  });
  input().oninput();
};
const file = (text = JSON.stringify(empty())) => ({
  name: "synthetic.json",
  size: text.length,
  text: vi.fn(async () => text),
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(async () => {
  vi.resetModules();
  repository = {
    exportAllData: vi.fn(async () => empty()),
    importPartialData: vi.fn(async () => ({ imported: false })),
    commitLifecycleMutation: vi.fn(),
  };
  vi.doMock("../src/web/storage/indexedDbRepository.js", () => ({
    createIndexedDbRepository: async () => repository,
  }));
  dom = new JSDOM(await readFile("src/web/tracker/index.html", "utf8"), {
    url: "http://127.0.0.1/tracker",
    pretendToBeVisual: true,
  });
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => false),
  );
  await import("../src/web/tracker/tracker.js");
  await vi.waitFor(() =>
    expect(repository.exportAllData.mock.calls.length).toBeGreaterThan(1),
  );
});
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/web/storage/indexedDbRepository.js");
  vi.resetModules();
});

describe("tracker import preview admission", () => {
  it("rejects oversized files before reading and hides filename/error canaries", async () => {
    const incoming = file();
    incoming.size = IMPORT_LIMITS_V1.bytes + 1;
    incoming.name = "SYNTHETIC_PRIVATE_CANARY.json";
    select(incoming);
    await preview();
    expect(incoming.text).not.toHaveBeenCalled();
    expect(apply().disabled).toBe(true);
    expect($("[data-import-result]").textContent).not.toContain(
      "SYNTHETIC_PRIVATE_CANARY",
    );
  });
  it("allows only the latest selection to enable Apply", async () => {
    const a = deferred();
    const first = file();
    first.text = () => a.promise;
    select(first);
    const pending = preview();
    select(file("{malformed"));
    await preview();
    a.resolve(JSON.stringify(empty()));
    await pending;
    expect(apply().disabled).toBe(true);
    select(file());
    await preview();
    expect(apply().disabled).toBe(false);
    expect(repository.importPartialData).toHaveBeenCalledWith(
      expect.any(Object),
      { dryRun: true },
    );
  });
  it("clears a successful preview on cancellation or current read failure", async () => {
    select(file());
    await preview();
    expect(apply().disabled).toBe(false);
    select(null);
    await preview();
    expect(apply().disabled).toBe(true);
    const broken = file();
    broken.text.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_CANARY"));
    select(broken);
    await preview();
    expect(apply().disabled).toBe(true);
    expect($("[data-import-result]").textContent).not.toContain(
      "SYNTHETIC_PRIVATE_CANARY",
    );
  });
  it("ignores an obsolete repository preview and an obsolete read rejection", async () => {
    const validation = deferred();
    repository.importPartialData.mockImplementationOnce(
      () => validation.promise,
    );
    select(file());
    const first = preview();
    await vi.waitFor(() =>
      expect(repository.importPartialData).toHaveBeenCalled(),
    );
    select(null);
    validation.resolve();
    await first;
    expect(apply().disabled).toBe(true);
    const read = deferred();
    const incoming = file();
    incoming.text = () => read.promise;
    select(incoming);
    const pending = preview();
    select(file());
    await preview();
    expect(apply().disabled).toBe(false);
    read.reject(new Error("SYNTHETIC_PRIVATE_CANARY"));
    await pending;
    expect(apply().disabled).toBe(false);
  });
  it("renders ownership positions without imported values", async () => {
    repository.importPartialData.mockRejectedValueOnce({
      code: "import_ownership_failed",
      details: {
        issues: [
          {
            code: "import_ownership_failed",
            origin: "existing",
            store: "interviews",
            recordIndex: 2,
            referenceIndex: 1,
            field: "contactIds",
            value: "SYNTHETIC_PRIVATE_CANARY",
          },
        ],
      },
    });
    select(file());
    await preview();
    const text = $("[data-import-result]").textContent;
    expect(text).toContain("Existing interviews row 3");
    expect(text).toContain("participant 2");
    expect(text).not.toContain("SYNTHETIC_PRIVATE_CANARY");
    expect(apply().disabled).toBe(true);
  });
});
