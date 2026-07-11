import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (file) => readFile(path.join(repoRoot, file), "utf8");

describe("Helm chart production contract", () => {
  it("defaults to the GHCR image, pullable convenience tag, and probe paths", async () => {
    const values = await read("charts/jobbot3000/values.yaml");
    const deployment = await read(
      "charts/jobbot3000/templates/deployment.yaml",
    );
    expect(values).toContain("repository: ghcr.io/futuroptimist/jobbot3000");
    expect(values).toContain("tag: main-latest");
    expect(values).toContain("path: /healthz");
    expect(values).toContain("path: /livez");
    expect(values).toContain("readOnlyRootFilesystem: true");
    expect(values).toContain("cpu: 25m");
    expect(values).toContain("memory: 32Mi");
    expect(values).toContain("cpu: 200m");
    expect(values).toContain("memory: 128Mi");
    expect(deployment).toContain("JOBBOT_WEB_PORT");
    expect(deployment).toContain("resources:");
    expect(deployment).not.toContain("persistentVolumeClaim");
  });

  it("adds standard app labels through chart helpers", async () => {
    const helpers = await read("charts/jobbot3000/templates/_helpers.tpl");
    expect(helpers).toContain("app.kubernetes.io/component: static-tracker");
    expect(helpers).toContain("app.kubernetes.io/part-of: jobbot3000");
  });

  it("does not define PVCs or user-data Secrets by default", async () => {
    const chartFiles = await Promise.all([
      read("charts/jobbot3000/templates/deployment.yaml"),
      read("charts/jobbot3000/templates/service.yaml"),
      read("charts/jobbot3000/templates/ingress.yaml"),
      read("scripts/validate-helm.sh"),
    ]);
    const combined = chartFiles.join("\n");
    expect(combined).not.toMatch(/kind:\s*PersistentVolumeClaim/);
    expect(combined).not.toMatch(/kind:\s*Secret/);
    expect(combined).toContain("helm lint");
    expect(combined).toContain("--set image.tag=main-TESTSHA");
    expect(combined).toContain(
      "--set ingress.host=jobbot3000.staging.example.test",
    );
  });
});
