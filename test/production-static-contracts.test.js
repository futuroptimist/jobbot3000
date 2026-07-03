import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (relative) => readFile(path.join(repoRoot, relative), "utf8");

describe("production static privacy and deployment contracts", () => {
  it("keeps tracker data in IndexedDB without private-data POST handlers", async () => {
    const tracker = await read("src/web/tracker/tracker.js");
    const server = await read("scripts/static-server.js");
    expect(tracker).toContain('indexedDB.open("jobbot3000", 1)');
    expect(tracker).not.toMatch(/fetch\s*\(/);
    expect(tracker).not.toMatch(/XMLHttpRequest/);
    expect(server).not.toMatch(/app\.post|app\.put|app\.patch|app\.delete/);
    expect(server).not.toMatch(
      /writeFile|appendFile|createWriteStream|better-sqlite3/,
    );
  });

  it("does not copy private data paths into the runtime Docker image", async () => {
    const dockerfile = await read("Dockerfile");
    const dockerignore = await read(".dockerignore");
    const runtimeStage = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    expect(runtimeStage).not.toMatch(
      /COPY (data|\.env|.*backup|.*\.sqlite|.*\.db)/i,
    );
    expect(dockerignore).toMatch(/^data\/?$/m);
    expect(dockerignore).toMatch(/^\.env/m);
    expect(dockerignore).toMatch(/\*\.sqlite/m);
    expect(dockerignore).toMatch(/backup/i);
  });

  it("keeps Helm defaults stateless and immutable-tag shaped", async () => {
    const values = await read("charts/jobbot3000/values.yaml");
    const devValues = await read("charts/jobbot3000/ci/dev-values.yaml");
    const templates = [
      await read("charts/jobbot3000/templates/deployment.yaml"),
      await read("charts/jobbot3000/templates/service.yaml"),
      await read("charts/jobbot3000/templates/ingress.yaml"),
    ].join("\n");
    expect(values).toContain("repository: ghcr.io/futuroptimist/jobbot3000");
    expect(values).toMatch(/tag: main-[0-9a-f]{7}/);
    expect(`${values}\n${devValues}`).not.toMatch(
      /tag: (latest|main|main-latest)$/m,
    );
    expect(values).toContain("path: /healthz");
    expect(values).toContain("path: /livez");
    expect(templates).not.toMatch(/PersistentVolumeClaim|kind: Secret/);
  });

  it("exposes build/version metadata placeholders and build-time fallbacks", async () => {
    const html = await read("src/web/tracker/index.html");
    const build = await read("scripts/build-static.js");
    expect(html).toContain("data-build-version");
    expect(html).toContain("__JOBBOT_VERSION__");
    expect(build).toContain('packageJson.version || "unknown"');
    expect(build).toContain("GITHUB_SHA");
    expect(build).toContain("SOURCE_DATE_EPOCH");
  });
});
