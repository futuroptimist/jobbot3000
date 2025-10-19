import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import { z } from 'zod';

const require = createRequire(import.meta.url);

let BetterSqlite3;
let betterSqlite3Error;
let drizzleBetterSqlite3;
let eq;
let sqliteTable;
let integer;
let text;
let auditLogTable;
try {
  const BetterSqlite3Module = require('better-sqlite3');
  const drizzleModule = require('drizzle-orm/better-sqlite3');
  const drizzleOrm = require('drizzle-orm');
  const sqliteCore = require('drizzle-orm/sqlite-core');
  BetterSqlite3 = BetterSqlite3Module;
  ({ drizzle: drizzleBetterSqlite3 } = drizzleModule);
  ({ eq } = drizzleOrm);
  ({ integer, sqliteTable, text } = sqliteCore);
  auditLogTable = sqliteTable('audit_log', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventUid: text('event_uid').notNull().unique(),
    opportunityUid: text('opportunity_uid'),
    actor: text('actor'),
    action: text('action').notNull(),
    occurredAt: text('occurred_at').notNull(),
    payload: text('payload'),
    createdAt: text('created_at').notNull().default(''),
  });
} catch (error) {
  betterSqlite3Error = error;
  BetterSqlite3 = null;
  drizzleBetterSqlite3 = null;
}

let warnedAboutMemoryFallback = false;

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
    if (BetterSqlite3) {
      this.#initSqlite();
    } else {
      this.#initMemory();
    }
  }

  #initSqlite() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const sqlite = new BetterSqlite3(this.filename);
    sqlite.pragma('foreign_keys = ON');
    applyMigrations(sqlite, this.migrationsDir);
    this.sqlite = sqlite;
    this.db = drizzleBetterSqlite3(sqlite);
  }

  #initMemory() {
    if (!warnedAboutMemoryFallback) {
      const reason = betterSqlite3Error?.message?.split('\n')[0] ?? null;
      const message = reason
        ? `better-sqlite3 unavailable (${reason}); falling back to in-memory audit log`
        : 'better-sqlite3 unavailable; falling back to in-memory audit log';
      console.warn(message);
      warnedAboutMemoryFallback = true;
    }
    this.memory = new MemoryAuditLog();
  }

  close() {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
      this.db = null;
    }
    if (this.memory) {
      this.memory.close();
    }
  }

  append(entry) {
    if (this.memory) {
      return this.memory.append(entry);
    }
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
    if (this.memory) {
      return this.memory.getByEventUid(eventUid);
    }
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
    if (this.memory) {
      return this.memory.list({ opportunityUid });
    }
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

class MemoryAuditLog {
  constructor() {
    this.entriesByUid = new Map();
  }

  close() {
    this.entriesByUid.clear();
  }

  append(entry) {
    const occurredAt = entry.occurredAt ?? new Date().toISOString();
    const eventUid = entry.eventUid ?? computeAuditUid({
      eventUid: entry.relatedEventUid ?? '',
      action: entry.action,
      occurredAt,
    });
    const now = new Date().toISOString();

    const candidate = auditEntrySchema.parse({
      eventUid,
      opportunityUid: entry.opportunityUid ?? undefined,
      actor: entry.actor ?? undefined,
      action: entry.action,
      occurredAt,
      payload: entry.payload ?? undefined,
      createdAt: now,
    });

    const existing = this.entriesByUid.get(candidate.eventUid);
    if (existing) return existing;

    this.entriesByUid.set(candidate.eventUid, candidate);
    return candidate;
  }

  getByEventUid(eventUid) {
    return this.entriesByUid.get(eventUid) ?? null;
  }

  list({ opportunityUid } = {}) {
    let entries = Array.from(this.entriesByUid.values());
    if (opportunityUid) {
      entries = entries.filter(entry => entry.opportunityUid === opportunityUid);
    }
    return entries
      .slice()
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}
