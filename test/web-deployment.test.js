import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

describe("web deployment artifacts", () => {
  it("ships a Dockerfile for the web server", async () => {
    const dockerfilePath = path.join(repoRoot, "Dockerfile");
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("FROM node:20-slim AS deps");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("FROM nginx:1.27-alpine AS runtime");
    expect(dockerfile).toContain(
      "COPY --from=build /app/dist /usr/share/nginx/html",
    );
    expect(dockerfile).toContain("listen 8080");
    expect(dockerfile).toContain("EXPOSE 8080");
    const runtimeStage = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    expect(runtimeStage).not.toContain("COPY src ./src");
    expect(runtimeStage).not.toContain("scripts/web-server.js");
    expect(runtimeStage).not.toContain("node_modules");
  });

  it("provides a docker-compose definition with static-only production defaults", async () => {
    const composePath = path.join(repoRoot, "docker-compose.web.yml");
    const compose = await readFile(composePath, "utf8");
    expect(compose).toContain("services:");
    expect(compose).toContain("JOBBOT_WEB_ENV=production");
    expect(compose).toContain(
      "JOBBOT_WEB_HEALTH_URL=http://127.0.0.1:3000/healthz",
    );
    expect(compose).not.toContain("JOBBOT_DATA_DIR");
    expect(compose).not.toContain("JOBBOT_WEB_ENABLE_NATIVE_CLI");
    expect(compose).not.toContain("./data:/data");
    expect(compose).not.toContain("scripts/web-server.js");
    expect(compose).not.toMatch(/^\s*command:/m);
  });

  it("defines a docker-compose healthcheck targeting the static /healthz endpoint", async () => {
    const composePath = path.join(repoRoot, "docker-compose.web.yml");
    const compose = await readFile(composePath, "utf8");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("http://127.0.0.1:3000/healthz");
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

    const staticServer = await readFile(
      path.join(repoRoot, "scripts", "static-server.js"),
      "utf8",
    );
    expect(staticServer).toContain('app.get("/healthz"');
    expect(staticServer).toContain('app.get("/livez"');
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
      'res.setHeader("Cache-Control", "no-store")',
    );
    expect(staticServer).not.toContain("immutable");
    expect(staticServer).toContain("Content-Security-Policy");
    expect(staticServer).not.toContain("/commands");
    expect(staticServer).not.toContain("better-sqlite3");
    expect(staticServer).not.toMatch(/writeFile|appendFile|createWriteStream/);
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
