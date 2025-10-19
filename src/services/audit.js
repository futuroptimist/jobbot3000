import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';

function resolveDataDir(value) {
  if (value) return value;
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function loadMigrations(dir) {
  let entries = [];
  try {
    entries = fs
      .readdirSync(dir)
      .filter(file => file.endsWith('.sql'))
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  return entries.map(file => ({
    id: file,
    sql: fs.readFileSync(path.join(dir, file), 'utf8'),
  }));
}

function applyMigrations(db, dir) {
  const migrations = loadMigrations(dir);
  for (const migration of migrations) {
    db.exec(migration.sql);
  }
}

export const auditEntrySchema = z.object({
  eventUid: z.string().min(1),
  opportunityUid: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().min(1),
  occurredAt: z.string().datetime(),
  payload: z.record(z.any()).optional(),
  createdAt: z.string().datetime(),
});

const auditLogTable = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventUid: text('event_uid').notNull().unique(),
  opportunityUid: text('opportunity_uid'),
  actor: text('actor'),
  action: text('action').notNull(),
  occurredAt: text('occurred_at').notNull(),
  payload: text('payload'),
  createdAt: text('created_at').notNull().default(''),
});

function computeAuditUid({ eventUid, action, occurredAt }) {
  const hash = createHash('sha256');
  hash.update(eventUid ?? '');
  hash.update('|');
  hash.update(action ?? '');
  hash.update('|');
  hash.update(occurredAt ?? '');
  return hash.digest('hex');
}

export class AuditLog {
  constructor(options = {}) {
    this.dataDir = resolveDataDir(options.dataDir);
    this.filename = options.filename ?? path.join(this.dataDir, 'opportunities.db');
    this.migrationsDir = options.migrationsDir ?? path.resolve('db/migrations');
    this.#init();
  }

  #init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const sqlite = new Database(this.filename);
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite, this.migrationsDir);
    this.sqlite = sqlite;
    this.db = drizzle(sqlite);
  }

  close() {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
      this.db = null;
    }
  }

  append(entry) {
    const occurredAt = entry.occurredAt ?? new Date().toISOString();
    const eventUid = entry.eventUid ?? computeAuditUid({
      eventUid: entry.relatedEventUid ?? '',
      action: entry.action,
      occurredAt,
    });
    const now = new Date().toISOString();

    this.db
      .insert(auditLogTable)
      .values({
        eventUid,
        opportunityUid: entry.opportunityUid ?? null,
        actor: entry.actor ?? null,
        action: entry.action,
        occurredAt,
        payload: entry.payload ? JSON.stringify(entry.payload) : null,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();

    return this.getByEventUid(eventUid);
  }

  getByEventUid(eventUid) {
    const row = this.db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.eventUid, eventUid))
      .get();
    if (!row) return null;
    return auditEntrySchema.parse({
      eventUid: row.eventUid,
      opportunityUid: row.opportunityUid ?? undefined,
      actor: row.actor ?? undefined,
      action: row.action,
      occurredAt: row.occurredAt,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      createdAt: row.createdAt,
    });
  }

  list({ opportunityUid } = {}) {
    let query = this.db.select().from(auditLogTable).orderBy(auditLogTable.occurredAt);
    if (opportunityUid) {
      query = query.where(eq(auditLogTable.opportunityUid, opportunityUid));
    }
    const rows = query.all();
    return rows.map(row =>
      auditEntrySchema.parse({
        eventUid: row.eventUid,
        opportunityUid: row.opportunityUid ?? undefined,
        actor: row.actor ?? undefined,
        action: row.action,
        occurredAt: row.occurredAt,
        payload: row.payload ? JSON.parse(row.payload) : undefined,
        createdAt: row.createdAt,
      }),
    );
  }
}
