import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";

import { createWebApp } from "../src/web/server.js";

describe("browser application tracker UI", () => {
  it("serves a backend-free IndexedDB tracker shell", async () => {
    const app = createWebApp({
      commandAdapter: {},
      csrf: { token: "test-csrf-token" },
    });
    const server = await new Promise((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/tracker`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain("Dashboard");
      expect(html).toContain("Applications");
      expect(html).toContain("Follow-ups");
      expect(html).toContain("Contacts/Outreach");
      expect(html).toContain("Import/Export");
      expect(html).toContain("Settings");
      expect(html).toContain("/tracker/app.js");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("keeps core tracker operations in the browser asset", async () => {
    const script = await fs.readFile("src/web/tracker/app.js", "utf8");
    expect(script).toContain("class TrackerRepository");
    expect(script).toContain('indexedDB.open("jobbot3000", 1)');
    expect(script).toContain("bundleFromCsv");
    expect(script).toContain("exportAllData");
    expect(script).toContain("outreachMessages");
    expect(script).toContain("interviews");
    expect(script).toContain("offers");
  });
});
