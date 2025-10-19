#!/usr/bin/env node

(async () => {
  const pathModule = await import("node:path");
  const processModule = await import("node:process");
  const process = processModule.default ?? processModule;
  const { default: Database } = await import("better-sqlite3");

  const resolvePath = pathModule.default?.resolve ?? pathModule.resolve;
  const joinPath = pathModule.default?.join ?? pathModule.join;

  const dataDir = process.env.JOBBOT_DATA_DIR || resolvePath("data");
  const dbPath = joinPath(dataDir, "opportunities.db");

  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = [
      "opportunities",
      "events",
      "contacts",
      "attachments",
      "audit_log",
      "schema_version",
      "about",
    ];

    for (const table of tables) {
      let rows = [];
      try {
        rows = db.prepare(`SELECT * FROM ${table}`).all();
      } catch (err) {
        if (err && err.message && err.message.includes("no such table")) {
          continue;
        }
        throw err;
      }

      for (const row of rows) {
        process.stdout.write(`${JSON.stringify({ table, data: row })}\n`);
      }
    }
  } finally {
    db.close();
  }
})();
