import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const DOC_PATH = resolve("docs/browser-first-architecture.md");

describe("browser-first architecture documentation", () => {
  it("documents IndexedDB ownership, deployment boundaries, and migration notes", () => {
    expect(existsSync(DOC_PATH)).toBe(true);

    const contents = readFileSync(DOC_PATH, "utf8");

    expect(contents).toMatch(/IndexedDB is the source of truth/);
    expect(contents).toMatch(/server does not own sensitive application data/);
    expect(contents).toMatch(/Offline-first behavior/);
    expect(contents).toMatch(/Backup and restore/);
    expect(contents).toMatch(/32-column CSV mapping notes/);
    expect(contents).toMatch(/src\/domain\/browserApplication\.js/);
  });
});
