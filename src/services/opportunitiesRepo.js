import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  opportunityEventSchema,
  opportunitySchema,
} from '../domain/opportunity.js';

const require = createRequire(import.meta.url);

let BetterSqlite3;
let betterSqlite3Error;
let drizzleBetterSqlite3;
let eq;
let sqliteTable;
let integer;
let text;
let uniqueIndex;
let opportunitiesTable;
let contactsTable;
let eventsTable;
try {
  const BetterSqlite3Module = require('better-sqlite3');
  const drizzleModule = require('drizzle-orm/better-sqlite3');
  const drizzleOrm = require('drizzle-orm');
  const sqliteCore = require('drizzle-orm/sqlite-core');
  BetterSqlite3 = BetterSqlite3Module;
  ({ drizzle: drizzleBetterSqlite3 } = drizzleModule);
  ({ eq } = drizzleOrm);
  ({ integer, sqliteTable, text, uniqueIndex } = sqliteCore);
  opportunitiesTable = sqliteTable('opportunities', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    uid: text('uid').notNull().unique(),
    company: text('company').notNull(),
    roleHint: text('role_hint'),
    contactEmail: text('contact_email'),
    contactName: text('contact_name'),
    lifecycleState: text('lifecycle_state').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastEventAt: text('last_event_at'),
    subject: text('subject'),
    source: text('source'),
    createdAt: text('created_at').notNull().default(''),
    updatedAt: text('updated_at').notNull().default(''),
  });

  contactsTable = sqliteTable(
    'contacts',
    {
      id: integer('id').primaryKey({ autoIncrement: true }),
      opportunityUid: text('opportunity_uid').notNull(),
      name: text('name'),
      email: text('email'),
      phone: text('phone'),
      createdAt: text('created_at').notNull().default(''),
      updatedAt: text('updated_at').notNull().default(''),
    },
    table => ({
      opportunityEmailIdx: uniqueIndex('contacts_opportunity_email_idx').on(
        table.opportunityUid,
        table.email,
      ),
    }),
  );

  eventsTable = sqliteTable('events', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventUid: text('event_uid').notNull().unique(),
    opportunityUid: text('opportunity_uid').notNull(),
    type: text('type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    payload: text('payload'),
    createdAt: text('created_at').notNull().default(''),
  });
} catch (error) {
  betterSqlite3Error = error;
  BetterSqlite3 = null;
  drizzleBetterSqlite3 = null;
}

let warnedAboutRepoFallback = false;

function defaultDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function loadMigrations(migrationsDir) {
  let entries = [];
  try {
    entries = fs
      .readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  return entries.map(file => ({
    id: file,
    sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
  }));
}

function applyMigrations(db, migrationsDir) {
  const migrations = loadMigrations(migrationsDir);
  for (const migration of migrations) {
    db.exec(migration.sql);
  }
}

export function computeOpportunityUid({ company, roleHint, contactEmail, firstSeenAt }) {
  const hash = createHash('sha256');
  hash.update(company ?? '');
  hash.update('|');
  hash.update(roleHint ?? '');
  hash.update('|');
  hash.update(contactEmail ?? '');
  hash.update('|');
  hash.update(firstSeenAt ?? '');
  return hash.digest('hex');
}

function computeEventUid({ opportunityUid, type, occurredAt, payload }) {
  const hash = createHash('sha256');
  hash.update(opportunityUid);
  hash.update('|');
  hash.update(type);
  hash.update('|');
  hash.update(occurredAt);
  hash.update('|');
  hash.update(typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}));
  return hash.digest('hex');
}

export class OpportunitiesRepo {
  constructor(options = {}) {
    this.dataDir = options.dataDir ?? defaultDataDir();
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
    if (!warnedAboutRepoFallback) {
      const reason = betterSqlite3Error?.message?.split('\n')[0] ?? null;
      const message = reason
        ? `better-sqlite3 unavailable (${reason}); using in-memory opportunities repo`
        : 'better-sqlite3 unavailable; using in-memory opportunities repo';
      console.warn(message);
      warnedAboutRepoFallback = true;
    }
    this.memory = new MemoryOpportunitiesRepo();
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

  upsertOpportunity(input) {
    if (this.memory) {
      return this.memory.upsertOpportunity(input);
    }
    const firstSeenAt = input.firstSeenAt ?? new Date().toISOString();
    const now = new Date().toISOString();
    const uid = computeOpportunityUid({
      company: input.company,
      roleHint: input.roleHint,
      contactEmail: input.contactEmail,
      firstSeenAt,
    });

    this.db
      .insert(opportunitiesTable)
      .values({
        uid,
        company: input.company,
        roleHint: input.roleHint ?? null,
        contactEmail: input.contactEmail ?? null,
        contactName: input.contactName ?? null,
        lifecycleState: input.lifecycleState,
        firstSeenAt,
        lastEventAt: input.lastEventAt ?? null,
        subject: input.subject ?? null,
        source: input.source ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: opportunitiesTable.uid,
        set: {
          company: input.company,
          roleHint: input.roleHint ?? null,
          contactEmail: input.contactEmail ?? null,
          contactName: input.contactName ?? null,
          lifecycleState: input.lifecycleState,
          lastEventAt: input.lastEventAt ?? null,
          subject: input.subject ?? null,
          source: input.source ?? null,
          updatedAt: now,
        },
      })
      .run();

    if (input.contactEmail || input.contactName) {
      this.db
        .insert(contactsTable)
        .values({
          opportunityUid: uid,
          name: input.contactName ?? null,
          email: input.contactEmail ?? null,
          phone: input.contactPhone ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [contactsTable.opportunityUid, contactsTable.email],
          set: {
            name: input.contactName ?? null,
            phone: input.contactPhone ?? null,
            updatedAt: now,
          },
        })
        .run();
    }

    return this.getOpportunityByUid(uid);
  }

  getOpportunityByUid(uid) {
    if (this.memory) {
      return this.memory.getOpportunityByUid(uid);
    }
    const row = this.db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.uid, uid))
      .get();
    if (!row) return null;
    return opportunitySchema.parse({
      uid: row.uid,
      company: row.company,
      roleHint: row.roleHint ?? undefined,
      contactEmail: row.contactEmail ?? undefined,
      contactName: row.contactName ?? undefined,
      lifecycleState: row.lifecycleState,
      firstSeenAt: row.firstSeenAt,
      lastEventAt: row.lastEventAt ?? undefined,
      subject: row.subject ?? undefined,
      source: row.source ?? undefined,
    });
  }

  listOpportunities() {
    if (this.memory) {
      return this.memory.listOpportunities();
    }
    const rows = this.db.select().from(opportunitiesTable).all();
    return rows.map(row =>
      opportunitySchema.parse({
        uid: row.uid,
        company: row.company,
        roleHint: row.roleHint ?? undefined,
        contactEmail: row.contactEmail ?? undefined,
        contactName: row.contactName ?? undefined,
        lifecycleState: row.lifecycleState,
        firstSeenAt: row.firstSeenAt,
        lastEventAt: row.lastEventAt ?? undefined,
        subject: row.subject ?? undefined,
        source: row.source ?? undefined,
      }),
    );
  }

  appendEvent(input) {
    if (this.memory) {
      return this.memory.appendEvent(input);
    }
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const now = new Date().toISOString();
    const eventUid = input.eventUid ?? computeEventUid({
      opportunityUid: input.opportunityUid,
      type: input.type,
      occurredAt,
      payload: input.payload,
    });

    this.db
      .insert(eventsTable)
      .values({
        eventUid,
        opportunityUid: input.opportunityUid,
        type: input.type,
        occurredAt,
        payload: input.payload ? JSON.stringify(input.payload) : null,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();

    const updateValues = {
      lastEventAt: occurredAt,
      updatedAt: now,
    };
    if (input.lifecycleState) {
      updateValues.lifecycleState = input.lifecycleState;
    }

    this.db
      .update(opportunitiesTable)
      .set(updateValues)
      .where(eq(opportunitiesTable.uid, input.opportunityUid))
      .run();

    return this.getEventByUid(eventUid);
  }

  getEventByUid(eventUid) {
    if (this.memory) {
      return this.memory.getEventByUid(eventUid);
    }
    const row = this.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.eventUid, eventUid))
      .get();
    if (!row) return null;
    return opportunityEventSchema.parse({
      eventUid: row.eventUid,
      opportunityUid: row.opportunityUid,
      type: row.type,
      occurredAt: row.occurredAt,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
    });
  }

  listEvents(opportunityUid) {
    if (this.memory) {
      return this.memory.listEvents(opportunityUid);
    }
    const rows = this.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.opportunityUid, opportunityUid))
      .orderBy(eventsTable.occurredAt)
      .all();

    return rows.map(row =>
      opportunityEventSchema.parse({
        eventUid: row.eventUid,
        opportunityUid: row.opportunityUid,
        type: row.type,
        occurredAt: row.occurredAt,
        payload: row.payload ? JSON.parse(row.payload) : undefined,
      }),
    );
  }

  clearAll() {
    if (this.memory) {
      this.memory.clearAll();
    } else {
      this.db.delete(eventsTable).run();
      this.db.delete(contactsTable).run();
      this.db.delete(opportunitiesTable).run();
    }
  }
}

class MemoryOpportunitiesRepo {
  constructor() {
    this.opportunities = new Map();
    this.events = new Map();
    this.eventsByOpportunity = new Map();
    this.contacts = new Map();
  }

  close() {
    this.opportunities.clear();
    this.events.clear();
    this.eventsByOpportunity.clear();
    this.contacts.clear();
  }

  upsertOpportunity(input) {
    const now = new Date().toISOString();
    const firstSeenAt = input.firstSeenAt ?? now;
    const uid = computeOpportunityUid({
      company: input.company,
      roleHint: input.roleHint,
      contactEmail: input.contactEmail,
      firstSeenAt,
    });

    const existing = this.opportunities.get(uid);
    const createdAt = existing?.createdAt ?? now;
    const storedFirstSeenAt = existing?.firstSeenAt ?? firstSeenAt;

    const opportunity = opportunitySchema.parse({
      uid,
      company: input.company,
      roleHint: input.roleHint ?? undefined,
      contactEmail: input.contactEmail ?? undefined,
      contactName: input.contactName ?? undefined,
      lifecycleState: input.lifecycleState,
      firstSeenAt: storedFirstSeenAt,
      lastEventAt: input.lastEventAt ?? undefined,
      subject: input.subject ?? undefined,
      source: input.source ?? undefined,
    });

    this.opportunities.set(uid, {
      ...opportunity,
      createdAt,
      updatedAt: now,
    });

    if (input.contactEmail || input.contactName) {
      const key = this.#contactKey({ opportunityUid: uid, email: input.contactEmail ?? null });
      const previous = this.contacts.get(key);
      const contact = {
        opportunityUid: uid,
        name: input.contactName ?? previous?.name ?? null,
        email: input.contactEmail ?? null,
        phone: input.contactPhone ?? previous?.phone ?? null,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      this.contacts.set(key, contact);
    }

    return this.getOpportunityByUid(uid);
  }

  getOpportunityByUid(uid) {
    const stored = this.opportunities.get(uid);
    if (!stored) return null;
    return opportunitySchema.parse({ ...stored });
  }

  listOpportunities() {
    return Array.from(this.opportunities.values()).map(opportunity =>
      opportunitySchema.parse({ ...opportunity }),
    );
  }

  appendEvent(input) {
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const now = new Date().toISOString();
    const eventUid = input.eventUid ?? computeEventUid({
      opportunityUid: input.opportunityUid,
      type: input.type,
      occurredAt,
      payload: input.payload,
    });

    const existing = this.events.get(eventUid);
    if (existing) return this.getEventByUid(eventUid);

    const event = opportunityEventSchema.parse({
      eventUid,
      opportunityUid: input.opportunityUid,
      type: input.type,
      occurredAt,
      payload: input.payload ?? undefined,
    });

    this.events.set(eventUid, event);
    const perOpportunity = this.eventsByOpportunity.get(event.opportunityUid) ?? [];
    perOpportunity.push(event);
    perOpportunity.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    this.eventsByOpportunity.set(event.opportunityUid, perOpportunity);

    const opportunity = this.opportunities.get(event.opportunityUid);
    if (opportunity) {
      const lifecycleState = input.lifecycleState ?? opportunity.lifecycleState;
      this.opportunities.set(event.opportunityUid, {
        ...opportunity,
        lifecycleState,
        lastEventAt: occurredAt,
        updatedAt: now,
      });
    }

    return this.getEventByUid(eventUid);
  }

  getEventByUid(eventUid) {
    const event = this.events.get(eventUid);
    if (!event) return null;
    return opportunityEventSchema.parse({ ...event });
  }

  listEvents(opportunityUid) {
    return (this.eventsByOpportunity.get(opportunityUid) ?? []).map(event =>
      opportunityEventSchema.parse({ ...event }),
    );
  }

  clearAll() {
    this.opportunities.clear();
    this.events.clear();
    this.eventsByOpportunity.clear();
    this.contacts.clear();
  }

  #contactKey({ opportunityUid, email }) {
    return `${opportunityUid}|${email ?? ''}`;
  }
}
