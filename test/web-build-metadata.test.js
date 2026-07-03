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
    expect(build).toContain("esbuild.build");
    expect(build).toContain("GITHUB_SHA");
    expect(build).toContain("Number.isFinite(sourceDateEpochSeconds)");
    expect(build).toContain("static/browser-only");
  });

  it("declares direct build-time bundling dependencies", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    );
    expect(packageJson.devDependencies.esbuild).toBeDefined();
  });

  it("passes commit metadata through Docker image builds", async () => {
    const dockerfile = await readFile(
      path.join(repoRoot, "Dockerfile"),
      "utf8",
    );
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/ci-image.yml"),
      "utf8",
    );
    expect(dockerfile).toContain("ARG GITHUB_SHA");
    expect(dockerfile).toContain("ARG JOBBOT_GIT_SHA");
    expect(dockerfile).toContain("ARG SOURCE_DATE_EPOCH");
    expect(workflow).toContain(
      'source_date_epoch="$(git show -s --format=%ct HEAD)"',
    );
    expect(workflow).toContain("GITHUB_SHA=${{ steps.meta.outputs.full_sha }}");
    expect(workflow).toContain(
      "GITHUB_SHA=${{ needs.build-and-smoke.outputs.full_sha }}",
    );
  });
});
