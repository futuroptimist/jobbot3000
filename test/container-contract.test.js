import fs from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = fs.readFileSync("Dockerfile", "utf8");
const workflow = fs.readFileSync(".github/workflows/ci-image.yml", "utf8");
const docs = fs.readFileSync("docs/release-ghcr.md", "utf8");

describe("container release contract", () => {
  it("keeps the runtime port and smoke endpoints aligned", () => {
    expect(dockerfile).toContain("listen 8080");
    expect(dockerfile).toContain("EXPOSE 8080");
    for (const path of ["/", "/healthz", "/livez"]) {
      expect(workflow).toContain(path);
      expect(docs).toContain(path);
    }
  });

  it("documents and publishes the immutable GHCR tag shape used by Sugarkube", () => {
    expect(workflow).toContain("ghcr.io/futuroptimist/jobbot3000");
    expect(workflow).toContain("main-${{ needs.smoke.outputs.short_sha }}");
    expect(workflow).toContain("sha-${{ needs.smoke.outputs.short_sha }}");
    expect(workflow).toContain("main-latest");
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(docs).toContain("main-SHORTSHA");
    expect(docs).toContain("Sugarkube deploy tag");
  });
});
