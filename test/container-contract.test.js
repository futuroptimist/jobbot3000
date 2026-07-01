import fs from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = fs.readFileSync("Dockerfile", "utf8");
const workflow = fs.readFileSync(".github/workflows/ci-image.yml", "utf8");
const dockerignore = fs.readFileSync(".dockerignore", "utf8");

describe("container publishing contract", () => {
  it("keeps the runtime port and smoke-test endpoints in sync", () => {
    expect(dockerfile).toContain("JOBBOT_WEB_PORT=8080");
    expect(dockerfile).toContain("EXPOSE 8080");
    expect(workflow).toContain("127.0.0.1:8080:8080");
    for (const endpoint of ["/", "/healthz", "/livez"]) {
      expect(workflow).toContain(`http://127.0.0.1:8080${endpoint}`);
    }
  });

  it("publishes the Sugarkube image tag contract", () => {
    expect(workflow).toContain("ghcr.io/futuroptimist/jobbot3000");
    expect(workflow).toContain("main-${short_sha}");
    expect(workflow).toContain("main-latest");
    expect(workflow).toContain("sha-${short_sha}");
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("Sugarkube deploy tag");
  });

  it("excludes local data and secrets from the Docker build context", () => {
    for (const ignored of [
      "node_modules",
      ".env",
      "data",
      "private",
      "secrets",
    ]) {
      expect(dockerignore).toContain(ignored);
    }
  });
});
