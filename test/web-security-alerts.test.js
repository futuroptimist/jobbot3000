import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const activeServers = [];

async function startServer(options) {
  const { startWebServer } = await import("../src/web/server.js");
  const server = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    csrfToken: "alert-csrf-token",
    rateLimit: { windowMs: 1000, max: 50 },
    ...options,
  });
  activeServers.push(server);
  return server;
}

async function readAlertFiles(dir, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entries = await fs.readdir(dir);
    if (entries.length > 0) return entries;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return [];
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe("web security alerts", () => {
  it("sends on-call alerts for security events", async () => {
    const outbox = await fs.mkdtemp(path.join(os.tmpdir(), "jobbot-alerts-"));
    const rotation = ["pager@oncall.example", "backup@oncall.example"];
    const server = await startServer({
      securityAlerts: {
        rotation,
        outbox,
      },
    });

    const response = await fetch(`${server.url}/commands/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "missing-csrf" }),
    });

    expect(response.status).toBe(403);

    const alertFiles = await readAlertFiles(outbox);
    expect(alertFiles).toHaveLength(rotation.length);

    const sample = await fs.readFile(path.join(outbox, alertFiles[0]), "utf8");
    expect(sample).toMatch(/web security alert/i);
    expect(sample).toMatch(/category:\s*csrf/i);
    expect(sample).toMatch(/web-operational-playbook/i);

    await fs.rm(outbox, { recursive: true, force: true });
  });
});
