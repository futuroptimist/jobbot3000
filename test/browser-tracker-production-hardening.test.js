import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { startWebServer } from "../src/web/server.js";

describe("browser-only production tracker hardening", () => {
  it("does not include network persistence APIs in the tracker bundle", async () => {
    const source = await fs.readFile("src/web/tracker/tracker.js", "utf8");

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\bsendBeacon\s*\(/);
    expect(source).not.toMatch(/\bWebSocket\b/);
  });

  it("serves tracker assets and health probes without invoking command persistence", async () => {
    const commandAdapter = {
      summarize: vi.fn(),
      "track-record": vi.fn(),
    };
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      commandAdapter,
      healthChecks: [],
      csrfToken: "test-csrf-token",
    });
    try {
      for (const path of [
        "/tracker",
        "/assets/tracker.js",
        "/assets/tracker.css",
        "/livez",
      ]) {
        const response = await fetch(`${server.url}${path}`);
        expect(response.status).toBe(200);
      }

      expect(commandAdapter.summarize).not.toHaveBeenCalled();
      expect(commandAdapter["track-record"]).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("aliases /healthz to the existing health response contract", async () => {
    const server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      healthChecks: [
        { name: "static-assets", run: async () => ({ status: "ok" }) },
      ],
      csrfToken: "test-csrf-token",
    });

    const response = await fetch(`${server.url}/healthz`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "static-assets", status: "ok" }),
      ]),
    );
    await server.close();
  });
});
