import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startWebServer } from "../src/web/server.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);

describe("static tracker production privacy", () => {
  it("keeps tracker writes browser-local with no command API calls", async () => {
    const script = await fs.readFile(
      path.join(root, "src/web/tracker/tracker.js"),
      "utf8",
    );
    expect(script).toContain('indexedDB.open("jobbot3000"');
    expect(script).not.toMatch(/fetch\s*\(/);
    expect(script).not.toContain("/commands/");
  });

  it("renders backup and destructive clear affordances", async () => {
    const html = await fs.readFile(
      path.join(root, "src/web/tracker/index.html"),
      "utf8",
    );
    expect(html).toContain("data-backup-now");
    expect(html).toContain("data-clear-data");
    expect(html).toContain("Browser-only tracker");
  });

  it("serves production liveness aliases for containers and static hosts", async () => {
    const server = await startWebServer({
      port: 0,
      host: "127.0.0.1",
      info: { service: "jobbot-web", version: "test" },
      healthChecks: [],
      enableNativeCli: false,
    });
    try {
      const healthz = await fetch(`${server.url}/healthz`);
      const livez = await fetch(`${server.url}/livez`);
      expect(healthz.status).toBe(200);
      expect(livez.status).toBe(200);
      expect(await healthz.json()).toMatchObject({ service: "jobbot-web" });
      expect(await livez.json()).toMatchObject({ status: "ready" });
    } finally {
      await server.close();
    }
  });
});
