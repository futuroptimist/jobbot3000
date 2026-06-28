import { ZodError } from "zod";

import {
  browserApplicationArtifactSchema,
  browserApplicationContactSchema,
  browserApplicationExportSchema,
  browserApplicationInterviewSchema,
  browserApplicationLifecycleEventSchema,
  browserApplicationOfferSchema,
  browserApplicationOutreachMessageSchema,
  browserApplicationReminderSchema,
  browserApplicationSchema,
  browserApplicationSettingsSchema,
} from "../../domain/browserApplication.js";

export const INDEXED_DB_DATABASE_NAME = "jobbot3000";
export const INDEXED_DB_SCHEMA_VERSION = 1;

const STORE_SCHEMAS = {
  applications: browserApplicationSchema,
  contacts: browserApplicationContactSchema,
  outreachMessages: browserApplicationOutreachMessageSchema,
  lifecycleEvents: browserApplicationLifecycleEventSchema,
  interviews: browserApplicationInterviewSchema,
  offers: browserApplicationOfferSchema,
  artifacts: browserApplicationArtifactSchema,
  reminders: browserApplicationReminderSchema,
  settings: browserApplicationSettingsSchema,
};

const STORE_NAMES = Object.keys(STORE_SCHEMAS);

export class IndexedDbRepositoryError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = "IndexedDbRepositoryError";
    this.code = code;
  }
}

export class IndexedDbUnavailableError extends IndexedDbRepositoryError {
  constructor(
    message = "IndexedDB is unavailable in this browser",
    options = {},
  ) {
    super(message, { ...options, code: "indexeddb_unavailable" });
    this.name = "IndexedDbUnavailableError";
  }
}

export class IndexedDbQuotaExceededError extends IndexedDbRepositoryError {
  constructor(message = "IndexedDB quota was exceeded", options = {}) {
    super(message, { ...options, code: "quota_exceeded" });
    this.name = "IndexedDbQuotaExceededError";
  }
}

export class IndexedDbSchemaValidationError extends IndexedDbRepositoryError {
  constructor(message = "Record failed schema validation", options = {}) {
    super(message, { ...options, code: "schema_validation_failed" });
    this.name = "IndexedDbSchemaValidationError";
    this.issues = options.cause instanceof ZodError ? options.cause.issues : [];
  }
}

export class IndexedDbImportConflictError extends IndexedDbRepositoryError {
  constructor(
    message = "Import contains records that conflict with existing data",
    options = {},
  ) {
    super(message, { ...options, code: "import_conflict" });
    this.name = "IndexedDbImportConflictError";
    this.conflicts = options.conflicts ?? [];
  }
}

const normalizeError = (error) => {
  if (error instanceof IndexedDbRepositoryError) return error;
  if (error?.name === "QuotaExceededError")
    return new IndexedDbQuotaExceededError(undefined, { cause: error });
  return error;
};

const promisifyRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(normalizeError(request.error));
  });

const promisifyTransaction = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(normalizeError(transaction.error));
    transaction.onabort = () => reject(normalizeError(transaction.error));
  });

const getAll = (store) => promisifyRequest(store.getAll());

const createStore = (db, name) =>
  db.objectStoreNames.contains(name)
    ? null
    : db.createObjectStore(name, { keyPath: "id" });

export const migrations = {
  1(db) {
    const applications = createStore(db, "applications");
    applications?.createIndex("by_company", "company", { unique: false });
    applications?.createIndex("by_status", "status", { unique: false });
    applications?.createIndex("by_appliedAt", "appliedAt", { unique: false });
    applications?.createIndex("by_followUpDate", "followUpDate", {
      unique: false,
    });

    createStore(db, "contacts");
    const outreach = createStore(db, "outreachMessages");
    outreach?.createIndex("by_applicationId", "applicationId", {
      unique: false,
    });
    const lifecycle = createStore(db, "lifecycleEvents");
    lifecycle?.createIndex(
      "by_applicationId_occurredAt",
      ["applicationId", "occurredAt"],
      { unique: false },
    );
    createStore(db, "interviews");
    createStore(db, "offers");
    const artifacts = createStore(db, "artifacts");
    artifacts?.createIndex("by_applicationId", "applicationId", {
      unique: false,
    });
    createStore(db, "reminders");
    createStore(db, "settings");
  },
};

const validate = (schema, record) => {
  try {
    return schema.parse(record);
  } catch (error) {
    throw new IndexedDbSchemaValidationError(undefined, { cause: error });
  }
};

const validateExport = (data) => {
  try {
    return browserApplicationExportSchema.parse(data);
  } catch (error) {
    throw new IndexedDbSchemaValidationError(
      "Import data failed schema validation",
      { cause: error },
    );
  }
};

const put = async (db, storeName, schema, record) => {
  const parsed = validate(schema, record);
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(parsed);
  await promisifyTransaction(transaction);
  return parsed;
};

const deleteApplicationById = async (db, applicationId) => {
  const transaction = db.transaction(STORE_NAMES, "readwrite");
  transaction.objectStore("applications").delete(applicationId);

  for (const storeName of STORE_NAMES.filter(
    (name) => !["applications", "settings"].includes(name),
  )) {
    const store = transaction.objectStore(storeName);
    const records = await promisifyRequest(store.getAll());
    records
      .filter((record) => record.applicationId === applicationId)
      .forEach((record) => store.delete(record.id));
  }

  await promisifyTransaction(transaction);
};

const recordsEqual = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

export function openIndexedDbRepository({
  indexedDB: idb = globalThis.indexedDB,
  databaseName = INDEXED_DB_DATABASE_NAME,
} = {}) {
  if (!idb?.open) throw new IndexedDbUnavailableError();

  const openPromise = new Promise((resolve, reject) => {
    const request = idb.open(databaseName, INDEXED_DB_SCHEMA_VERSION);
    request.onupgradeneeded = (event) => {
      for (
        let version = event.oldVersion + 1;
        version <= INDEXED_DB_SCHEMA_VERSION;
        version += 1
      ) {
        migrations[version]?.(request.result, request.transaction);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(normalizeError(request.error));
    request.onblocked = () =>
      reject(
        new IndexedDbRepositoryError("IndexedDB open was blocked", {
          code: "open_blocked",
        }),
      );
  });

  const withDb = async (callback) => callback(await openPromise);

  return {
    ready: openPromise.then(() => undefined),
    close: async () => withDb((db) => db.close()),
    createApplication: (record) =>
      withDb((db) => put(db, "applications", browserApplicationSchema, record)),
    updateApplication: (record) =>
      withDb((db) => put(db, "applications", browserApplicationSchema, record)),
    deleteApplication: (id) => withDb((db) => deleteApplicationById(db, id)),
    getApplication: (id) =>
      withDb((db) =>
        promisifyRequest(
          db.transaction("applications").objectStore("applications").get(id),
        ),
      ),
    listApplications: () =>
      withDb((db) =>
        getAll(db.transaction("applications").objectStore("applications")),
      ),
    upsertContact: (record) =>
      withDb((db) =>
        put(db, "contacts", browserApplicationContactSchema, record),
      ),
    addOutreachMessage: (record) =>
      withDb((db) =>
        put(
          db,
          "outreachMessages",
          browserApplicationOutreachMessageSchema,
          record,
        ),
      ),
    addLifecycleEvent: (record) =>
      withDb((db) =>
        put(
          db,
          "lifecycleEvents",
          browserApplicationLifecycleEventSchema,
          record,
        ),
      ),
    upsertInterview: (record) =>
      withDb((db) =>
        put(db, "interviews", browserApplicationInterviewSchema, record),
      ),
    upsertOffer: (record) =>
      withDb((db) => put(db, "offers", browserApplicationOfferSchema, record)),
    upsertArtifact: (record) =>
      withDb((db) =>
        put(db, "artifacts", browserApplicationArtifactSchema, record),
      ),
    listDueFollowUps: (dueAt = new Date().toISOString()) =>
      withDb(async (db) => {
        const applications = await getAll(
          db.transaction("applications").objectStore("applications"),
        );
        return applications.filter(
          ({ followUpDate }) => followUpDate && followUpDate <= dueAt,
        );
      }),
    exportAllData: () =>
      withDb(async (db) => {
        const tx = db.transaction(STORE_NAMES);
        const entries = await Promise.all(
          STORE_NAMES.map(async (name) => [
            name,
            await getAll(tx.objectStore(name)),
          ]),
        );
        const data = Object.fromEntries(entries);
        return browserApplicationExportSchema.parse({
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          ...data,
          settings: data.settings[0],
        });
      }),
    clear: () =>
      withDb(async (db) => {
        const tx = db.transaction(STORE_NAMES, "readwrite");
        STORE_NAMES.forEach((name) => tx.objectStore(name).clear());
        await promisifyTransaction(tx);
      }),
    importAllData: (data, { dryRun = false, conflictStrategy = "fail" } = {}) =>
      withDb(async (db) => {
        const parsed = validateExport(data);
        const conflicts = [];
        const tx = db.transaction(STORE_NAMES, "readonly");
        for (const storeName of STORE_NAMES) {
          const records =
            storeName === "settings"
              ? [parsed.settings].filter(Boolean)
              : parsed[storeName];
          const store = tx.objectStore(storeName);
          for (const record of records) {
            const existing = await promisifyRequest(store.get(record.id));
            if (existing && !recordsEqual(existing, record))
              conflicts.push({ storeName, id: record.id });
          }
        }
        if (conflicts.length > 0 && conflictStrategy === "fail")
          throw new IndexedDbImportConflictError(undefined, { conflicts });
        if (dryRun)
          return {
            ok: true,
            counts: Object.fromEntries(
              STORE_NAMES.map((name) => [
                name,
                name === "settings"
                  ? Number(Boolean(parsed.settings))
                  : parsed[name].length,
              ]),
            ),
            conflicts,
          };
        const writeTx = db.transaction(STORE_NAMES, "readwrite");
        for (const storeName of STORE_NAMES) {
          const records =
            storeName === "settings"
              ? [parsed.settings].filter(Boolean)
              : parsed[storeName];
          records.forEach((record) =>
            writeTx.objectStore(storeName).put(record),
          );
        }
        await promisifyTransaction(writeTx);
        return { ok: true, conflicts };
      }),
  };
}
