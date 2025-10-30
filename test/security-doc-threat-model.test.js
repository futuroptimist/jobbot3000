import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function readFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.readFile(absolutePath, "utf8");
}

describe("SECURITY.md threat model", () => {
  it("documents the November 2025 refresh with external references", async () => {
    const contents = await readFile("SECURITY.md");
    expect(contents).toMatch(/## Threat model update \(November 2025\)/);
    expect(contents).toMatch(/CSRF double-submit token/);
    expect(contents).toMatch(/web-security-roadmap\.md/);
    expect(contents).toMatch(/security-reviews\/2025-11-threat-model\.pdf/);
    expect(contents).toMatch(/## Risk assessment workflow/);
    expect(contents).toMatch(/scripts\/generate-risk-assessment\.js/);
    expect(contents).toMatch(/security-risk-assessment-guide\.md/);
  });
});
