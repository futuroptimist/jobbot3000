import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("static tracker build metadata", () => {
  it("renders explicit fallback metadata and build-time replacement hooks", async () => {
    const html = await readFile(
      path.join(repoRoot, "src/web/tracker/index.html"),
      "utf8",
    );
    const js = await readFile(
      path.join(repoRoot, "src/web/tracker/tracker.js"),
      "utf8",
    );
    const build = await readFile(
      path.join(repoRoot, "scripts/build-static.js"),
      "utf8",
    );
    expect(html).toContain("data-build-metadata");
    expect(html).toContain(
      "Version unknown · build unavailable · static/browser-only",
    );
    expect(html).toContain("__JOBBOT_BUILD_METADATA__");
    expect(js).toContain("function renderBuildMetadata()");
    expect(js).toContain('gitSha: "unavailable"');
    expect(build).toContain("packageJson.version");
    expect(build).toContain("GITHUB_SHA");
    expect(build).toContain("static/browser-only");
  });
});
