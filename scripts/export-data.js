#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

import Database from 'better-sqlite3';

const dataDir = process.env.JOBBOT_DATA_DIR || path.resolve('data');
const dbPath = path.join(dataDir, 'opportunities.db');

const db = new Database(dbPath, { readonly: true });
try {
  const tables = [
    'opportunities',
    'events',
    'contacts',
    'attachments',
    'audit_log',
    'schema_version',
    'about',
  ];

  for (const table of tables) {
    let rows = [];
    try {
      rows = db.prepare(`SELECT * FROM ${table}`).all();
    } catch (err) {
      if (err && err.message && err.message.includes('no such table')) {
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
