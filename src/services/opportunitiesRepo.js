import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import {
  opportunityEventSchema,
  opportunitySchema,
} from '../domain/opportunity.js';

const opportunitiesTable = sqliteTable('opportunities', {
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

const contactsTable = sqliteTable(
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

const eventsTable = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventUid: text('event_uid').notNull().unique(),
  opportunityUid: text('opportunity_uid').notNull(),
  type: text('type').notNull(),
  occurredAt: text('occurred_at').notNull(),
  payload: text('payload'),
  createdAt: text('created_at').notNull().default(''),
});

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

  upsertOpportunity(input) {
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
    this.db.delete(eventsTable).run();
    this.db.delete(contactsTable).run();
    this.db.delete(opportunitiesTable).run();
  }
}
