import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const guidePath = new URL("../docs/backup-restore-guide.md", import.meta.url);

describe("backup and restore guide", () => {
  it("documents backup steps for the data directory and audit log", () => {
    const contents = readFileSync(guidePath, "utf8");
    expect(contents).toContain("## Backup");
    expect(contents).toContain("JOBBOT_DATA_DIR");
    expect(contents).toContain("JOBBOT_AUDIT_LOG");
    expect(contents).toMatch(/node scripts\/export-data\.js/);
    expect(contents).toMatch(/tar -czf .*jobbot-backup\.tgz/);
    expect(contents).toMatch(/Compress-Archive/);
  });

  it("documents restore steps using the import script and archive extraction", () => {
    const contents = readFileSync(guidePath, "utf8");
    expect(contents).toContain("## Restore");
    expect(contents).toMatch(/tar -xzf .*jobbot-backup\.tgz/);
    expect(contents).toMatch(/node scripts\/import-data\.js --source/);
    expect(contents).toMatch(/--dry-run/);
  });

  it("explains verification commands for restored environments", () => {
    const contents = readFileSync(guidePath, "utf8");
    expect(contents).toContain("## Verify");
    expect(contents).toMatch(/jobbot analytics health --json/);
    expect(contents).toMatch(
      /node scripts\/export-data\.js > \/tmp\/restore-check\.ndjson/,
    );
  });
});

describe("production readiness docs", () => {
  it("links production readiness, spreadsheet migration, and backup boundaries", async () => {
    const readiness = readFileSync(
      path.join(repoRoot, "docs", "production-readiness.md"),
      "utf8",
    );
    const migration = readFileSync(
      path.join(repoRoot, "docs", "import-current-spreadsheet.md"),
      "utf8",
    );
    const backup = readFileSync(
      path.join(repoRoot, "docs", "backup-restore-guide.md"),
      "utf8",
    );
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(readiness).toContain("static, browser-local application tracker");
    expect(readiness).toContain(
      "Never store real tracker data in Kubernetes objects",
    );
    expect(readiness).toContain("CSV is the spreadsheet-compatible");
    expect(migration).toContain("File → Download → Comma Separated Values");
    expect(migration).toContain("CSV is one row per application");
    expect(backup).toContain(
      "Dev, staging, and production deployments are separate browser/storage profiles",
    );
    expect(backup).toContain("Do not include Daniel's real data");
    expect(readme).toContain("docs/production-readiness.md");
    expect(readme).toContain("Deploy with Sugarkube");
  });
});
