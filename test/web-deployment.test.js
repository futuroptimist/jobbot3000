import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function runPromotionSmoke(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn("node", ["scripts/promotion-smoke.js", baseUrl], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function startPrefixedSmokeServer({
  badInvalidHealth = false,
  badTrackerRedirect = false,
  badManifestStartUrl = false,
} = {}) {
  const rootHtml = [
    "<!doctype html><h1>Browser-only application tracker</h1>",
    '<p>static/browser-only</p><link rel="stylesheet" href="assets/app.css">',
  ].join("");
  const trackerHtml = [
    "<!doctype html><h1>Application tracker</h1>",
    '<script id="jobbot-build-metadata" type="application/json">{}</script>',
  ].join("");
  const health = JSON.stringify({
    status: "ok",
    mode: "static",
    persistence: "browser-indexeddb",
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (badTrackerRedirect && url.pathname === "/jobbot/tracker") {
      res.writeHead(302, { location: "/login?token=secret" });
      res.end();
      return;
    }
    if (url.pathname === "/jobbot/" || url.pathname === "/jobbot") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(rootHtml);
      return;
    }
    if (url.pathname === "/jobbot/tracker") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(trackerHtml);
      return;
    }
    if (["/jobbot/healthz", "/jobbot/livez"].includes(url.pathname)) {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(health);
      return;
    }
    if (url.pathname === "/jobbot/healthz/not-real") {
      res.writeHead(404, { "content-type": badInvalidHealth ? "application/json" : "text/html" });
      res.end(badInvalidHealth ? health : "not found");
      return;
    }
    if (url.pathname === "/jobbot/manifest.webmanifest") {
      res.writeHead(200, { "content-type": "application/manifest+json" });
      res.end(JSON.stringify({
        name: "jobbot3000",
        start_url: badManifestStartUrl ? "/tracker" : "/jobbot/tracker",
      }));
      return;
    }
    if (url.pathname === "/jobbot/assets/app.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end("body{}");
      return;
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/jobbot/?private=secret#frag`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}


describe("web deployment artifacts", () => {
  it("ships a Dockerfile for the web server", async () => {
    const dockerfilePath = path.join(repoRoot, "Dockerfile");
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("FROM node:20-slim AS deps");
    expect(dockerfile).toContain("RUN npm ci --ignore-scripts");
    expect(dockerfile).toContain("COPY tsconfig.json ./");
    expect(dockerfile).toContain(
      "COPY scripts/build-static.js ./scripts/build-static.js",
    );
    expect(dockerfile).toContain("COPY src ./src");
    expect(dockerfile).toContain("COPY test ./test");
    expect(dockerfile).toContain("npm run typecheck && npm run build");
    expect(dockerfile).not.toContain("npm run test:ci");
    expect(dockerfile).not.toContain("apt-get install");
    expect(dockerfile).toContain("FROM node:20-slim AS prod-deps");
    expect(dockerfile).toContain("FROM node:20-slim AS runtime");
    expect(dockerfile).toContain("COPY --from=build /app/dist ./dist");
    expect(dockerfile).toContain(
      "COPY scripts/static-server.js ./scripts/static-server.js",
    );
    expect(dockerfile).toContain("EXPOSE 8080");
    expect(dockerfile).toContain("JOBBOT_WEB_PORT=8080");
    expect(dockerfile).toContain('CMD ["node", "scripts/static-server.js"]');
    const runtimeStage = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    expect(runtimeStage).toContain("COPY package.json ./");
    expect(runtimeStage).not.toContain("package-lock.json");
    expect(runtimeStage).not.toContain("COPY src ./src");
    expect(runtimeStage).not.toContain("scripts/web-server.js");
  });

  it("provides a docker-compose definition with static-only production defaults", async () => {
    const composePath = path.join(repoRoot, "docker-compose.web.yml");
    const compose = await readFile(composePath, "utf8");
    expect(compose).toContain("services:");
    expect(compose).toContain("JOBBOT_WEB_ENV=production");
    expect(compose).toContain(
      "JOBBOT_WEB_HEALTH_URL=http://127.0.0.1:8080/healthz",
    );
    expect(compose).not.toContain("JOBBOT_DATA_DIR");
    expect(compose).not.toContain("JOBBOT_WEB_ENABLE_NATIVE_CLI");
    expect(compose).not.toContain("./data:/data");
    expect(compose).not.toMatch(/^\s*env_file:/m);
    expect(compose).not.toMatch(/^\s*- \.env/m);
    expect(compose).not.toContain("scripts/web-server.js");
    expect(compose).not.toMatch(/^\s*command:/m);
  });

  it("defines a docker-compose healthcheck targeting the static /healthz endpoint", async () => {
    const composePath = path.join(repoRoot, "docker-compose.web.yml");
    const compose = await readFile(composePath, "utf8");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("http://127.0.0.1:8080/healthz");
    expect(compose).not.toContain("scripts/docker-healthcheck.js");
    expect(compose).not.toMatch(/http:\/\/127\.0\.0\.1:3000\/health(?!z)/);
  });

  it("locks the runtime profile with read-only rootfs and a custom seccomp policy", async () => {
    const composePath = path.join(repoRoot, "docker-compose.web.yml");
    const compose = await readFile(composePath, "utf8");
    expect(compose).toContain("read_only: true");
    expect(compose).toMatch(/security_opt:\s*\n\s+- no-new-privileges:true/);
    expect(compose).toMatch(/seccomp=\.\/config\/seccomp\/jobbot-web\.json/);

    const seccompPath = path.join(
      repoRoot,
      "config",
      "seccomp",
      "jobbot-web.json",
    );
    const profile = JSON.parse(await readFile(seccompPath, "utf8"));
    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
    const architectures = profile.architectures
      ? new Set(profile.architectures)
      : new Set(profile.archMap?.map((entry) => entry.architecture));
    expect(architectures.has("SCMP_ARCH_X86_64")).toBe(true);

    const syscallNames = new Set(
      profile.syscalls
        ?.filter((entry) => entry.action === "SCMP_ACT_ALLOW")
        .flatMap((entry) => entry.names ?? []) ?? [],
    );
    expect(syscallNames.has("accept4")).toBe(true);
    expect(syscallNames.has("clone3")).toBe(false);
  });

  it("builds a static browser-only tracker surface with health probes", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    );
    expect(packageJson.scripts.build).toBe("node scripts/build-static.js");
    expect(packageJson.scripts["start:static"]).toBe(
      "node scripts/static-server.js",
    );
    expect(packageJson.scripts["smoke:container"]).toBe(
      "bash scripts/smoke-container.sh",
    );
    expect(packageJson.scripts["smoke:promotion"]).toBe(
      "node scripts/promotion-smoke.js",
    );

    const promotionSmoke = await readFile(
      path.join(repoRoot, "scripts", "promotion-smoke.js"),
      "utf8",
    );
    expect(promotionSmoke).toContain("const resolveSmokeUrl = (route) =>");
    expect(promotionSmoke).toContain("expectedBasePath");
    expect(promotionSmoke).toContain("pathWithinExpectedBase");
    expect(promotionSmoke).toContain("REDIRECT_ESCAPED_BASE_PATH");
    expect(promotionSmoke).toContain("INVALID_HEALTH_BODY_FALLBACK");
    expect(promotionSmoke).toContain("topLevelFailureCode");
    expect(promotionSmoke).toContain("await import(\"playwright\")");
    expect(promotionSmoke).not.toContain("import { chromium } from \"playwright\"");
    expect(promotionSmoke).not.toContain("entry.error");
    expect(promotionSmoke).not.toContain("error.message");

    const smokeContainer = await readFile(
      path.join(repoRoot, "scripts", "smoke-container.sh"),
      "utf8",
    );
    expect(smokeContainer).toContain("npm run smoke:promotion --");
    expect(smokeContainer).not.toContain("--synthetic");

    const staticServer = await readFile(
      path.join(repoRoot, "scripts", "static-server.js"),
      "utf8",
    );
    expect(staticServer).toContain('app.get("/healthz"');
    expect(staticServer).toContain('app.get("/livez"');
    expect(staticServer).not.toMatch(/app\.(post|put|patch|delete)\(/);
    expect(staticServer).toContain(
      'app.get(["/", "/index.html"], sendNoStoreFile("index.html"))',
    );
    expect(staticServer).toContain(
      'app.get(["/tracker", "/tracker.html"], sendNoStoreFile("tracker.html"))',
    );
    expect(staticServer).toContain(
      'app.get("/manifest.webmanifest", sendNoStoreFile("manifest.webmanifest"))',
    );
    expect(staticServer).toContain(
      '.set("Cache-Control", "no-store")',
    );
    expect(staticServer).toContain('res.setHeader("Cache-Control", "no-store")');
    expect(staticServer).not.toContain("immutable");
    expect(staticServer).toContain("Content-Security-Policy");
    expect(staticServer).not.toContain("/commands");
    expect(staticServer).not.toContain("better-sqlite3");
    expect(staticServer).not.toMatch(/writeFile|appendFile|createWriteStream/);
    expect(staticServer).not.toMatch(
      /JOBBOT_(GREENHOUSE|LEVER|SMARTRECRUITERS|WORKABLE).*TOKEN/,
    );
  });



  it("runs promotion smoke safely against path-prefixed deployments", async () => {
    await rm(
      path.join(repoRoot, "test-results", "promotion-smoke-readonly.json"),
      { force: true },
    );
    const server = await startPrefixedSmokeServer();
    try {
      const result = await runPromotionSmoke(server.baseUrl);
      expect(result).toMatchObject({ code: 0 });
      const summary = JSON.parse(
        await readFile(
          path.join(repoRoot, "test-results", "promotion-smoke-readonly.json"),
          "utf8",
        ),
      );
      expect(summary.pass).toBe(true);
      expect(summary.baseUrl).toMatch(/\/jobbot\/$/);
      expect(summary.baseUrl).not.toContain("private=secret");
      expect(summary.checks.map((check) => check.finalUrl).filter(Boolean)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\/jobbot\/$/),
          expect.stringMatching(/\/jobbot\/tracker$/),
          expect.stringMatching(/\/jobbot\/assets\/app\.css$/),
        ]),
      );
    } finally {
      await server.close();
    }
  });

  it("writes failed privacy-safe summaries for bad smoke responses", async () => {
    await rm(
      path.join(repoRoot, "test-results", "promotion-smoke-readonly.json"),
      { force: true },
    );
    const invalidHealthServer = await startPrefixedSmokeServer({ badInvalidHealth: true });
    try {
      const result = await runPromotionSmoke(invalidHealthServer.baseUrl);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Promotion smoke failed:");
      const summaryText = await readFile(
        path.join(repoRoot, "test-results", "promotion-smoke-readonly.json"),
        "utf8",
      );
      expect(summaryText).not.toContain("private=secret");
      expect(summaryText).not.toContain("Synthetic Smoke");
      expect(summaryText).not.toContain("Error:");
      const summary = JSON.parse(summaryText);
      expect(summary.pass).toBe(false);
      expect(
        summary.checks.some(
          (check) => check.code === "INVALID_HEALTH_JSON_FALLBACK",
        ),
      ).toBe(true);
    } finally {
      await invalidHealthServer.close();
    }

    const redirectServer = await startPrefixedSmokeServer({
      badTrackerRedirect: true,
    });
    try {
      const result = await runPromotionSmoke(redirectServer.baseUrl);
      expect(result.code).toBe(1);
      const summary = JSON.parse(
        await readFile(
          path.join(repoRoot, "test-results", "promotion-smoke-readonly.json"),
          "utf8",
        ),
      );
      expect(summary.pass).toBe(false);
      expect(
        summary.checks.some(
          (check) => check.code === "REDIRECT_ESCAPED_BASE_PATH",
        ),
      ).toBe(true);
      expect(JSON.stringify(summary)).not.toContain("token=secret");
    } finally {
      await redirectServer.close();
    }

    const manifestServer = await startPrefixedSmokeServer({
      badManifestStartUrl: true,
    });
    try {
      const result = await runPromotionSmoke(manifestServer.baseUrl);
      expect(result.code).toBe(1);
      const summaryText = await readFile(
        path.join(repoRoot, "test-results", "promotion-smoke-readonly.json"),
        "utf8",
      );
      expect(summaryText).not.toContain("private=secret");
      const summary = JSON.parse(summaryText);
      expect(summary.pass).toBe(false);
      expect(
        summary.checks.some(
          (check) => check.code === "MANIFEST_START_URL_ESCAPED_BASE_PATH",
        ),
      ).toBe(true);
    } finally {
      await manifestServer.close();
    }

  });

  it("documents static privacy boundaries and IndexedDB backup guidance", async () => {
    const doc = await readFile(
      path.join(repoRoot, "docs", "privacy-and-security.md"),
      "utf8",
    );
    expect(doc).toContain("stored in the user's browser IndexedDB");
    expect(doc).toContain("are not posted to jobbot3000 server APIs");
    expect(doc).toContain("Clear local data");
    expect(doc).toContain("Browser quota caveats");
  });
});

describe("GHCR image workflow", () => {
  it("builds and publishes the static image with Sugarkube-safe tags", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github", "workflows", "ci-image.yml"),
      "utf8",
    );
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("ghcr.io/futuroptimist/jobbot3000");
    expect(workflow).toContain(
      "main-${{ needs.build-and-smoke.outputs.short_sha }}",
    );
    expect(workflow).toContain("main-latest");
    expect(workflow).toContain(
      "sha-${{ needs.build-and-smoke.outputs.short_sha }}",
    );
    expect(workflow).toContain("actions/setup-node@v5");
    expect(workflow).toContain("node-version: 20");
    expect(workflow).toContain("actions/checkout@v5");
    expect(workflow).toContain("run: npm ci");
    expect(workflow).toContain("run: npm run typecheck");
    expect(workflow).toContain("run: npm run test:ci");
    expect(workflow).toContain("platforms: linux/amd64");
    expect(workflow).toContain("platforms: linux/amd64,linux/arm64");
    expect(workflow).toContain("docker/setup-qemu-action@v3");
    expect(workflow).not.toContain('      - "v*"');
    const forbiddenPasswordInput = new RegExp(
      ["pass", "word"].join("") +
        String.raw`:\s*\$\{\{\s*secrets\.GITHUB_TOKEN`,
    );
    expect(workflow).not.toMatch(forbiddenPasswordInput);
    expect(workflow).toContain("GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(workflow).toContain(
      'docker login ghcr.io -u "${GITHUB_ACTOR}" --password-stdin',
    );
    expect(workflow).toContain("org.opencontainers.image.source");
    expect(workflow).toContain("org.opencontainers.image.revision");
    expect(workflow).toContain("org.opencontainers.image.created");
    expect(workflow).toContain("org.opencontainers.image.licenses=MIT");
    expect(workflow).toContain("npm run smoke:container -- jobbot3000:smoke");
    expect(workflow).toContain("Sugarkube deploy tag");
  });

  it("documents GHCR release and Sugarkube deployment guidance", async () => {
    const doc = await readFile(
      path.join(repoRoot, "docs", "release-ghcr.md"),
      "utf8",
    );
    expect(doc).toContain("ghcr.io/futuroptimist/jobbot3000");
    expect(doc).toContain("main-SHORTSHA");
    expect(doc).toContain("Sugarkube deploy tag");
    expect(doc).toContain("Avoid `main-latest` in production");
    expect(doc).toContain("linux/amd64");
    expect(doc).toContain("linux/arm64");
    expect(doc).toContain(
      "multi-arch publish does not depend on test-runner browser downloads",
    );
    expect(doc).toContain("/healthz");
    expect(doc).toContain("/livez");
  });
});
