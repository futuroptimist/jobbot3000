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

export const DATABASE_NAME = "jobbot3000";
export const DATABASE_VERSION = 1;

export class IndexedDbRepositoryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "IndexedDbRepositoryError";
    this.code = code;
    this.cause = options.cause;
    this.details = options.details;
  }
}

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

const EXPORT_STORES = [
  "applications",
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
];

const ALL_STORES = [...EXPORT_STORES, "settings"];

const APPLICATION_INDEXES = [
  ["by_company", "company"],
  ["by_status", "status"],
  ["by_appliedAt", "appliedAt"],
  ["by_followUpDate", "followUpDate"],
];

const MIGRATIONS = [
  {
    version: 1,
    migrate(db) {
      createStore(db, "applications", APPLICATION_INDEXES);
      createStore(db, "contacts", [["by_applicationId", "applicationId"]]);
      createStore(db, "outreachMessages", [
        ["by_applicationId", "applicationId"],
      ]);
      createStore(db, "lifecycleEvents", [
        ["by_applicationId", "applicationId"],
        ["by_applicationId_occurredAt", ["applicationId", "occurredAt"]],
      ]);
      createStore(db, "interviews", [["by_applicationId", "applicationId"]]);
      createStore(db, "offers", [["by_applicationId", "applicationId"]]);
      createStore(db, "artifacts", [["by_applicationId", "applicationId"]]);
      createStore(db, "reminders", [
        ["by_applicationId", "applicationId"],
        ["by_dueAt", "dueAt"],
      ]);
      createStore(db, "settings");
    },
  },
];

function createStore(db, name, indexes = []) {
  if (db.objectStoreNames.contains(name)) {
    return db.transaction.objectStore(name);
  }

  const store = db.createObjectStore(name, { keyPath: "id" });
  indexes.forEach(([indexName, keyPath, options]) => {
    store.createIndex(indexName, keyPath, options);
  });
  return store;
}

function isQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.code === 22;
}

function mapRequestError(error, fallbackCode = "indexeddb_request_failed") {
  if (isQuotaError(error)) {
    return new IndexedDbRepositoryError(
      "quota_exceeded",
      "IndexedDB quota was exceeded while writing jobbot3000 data.",
      { cause: error },
    );
  }

  return new IndexedDbRepositoryError(
    fallbackCode,
    error?.message ?? "IndexedDB request failed.",
    { cause: error },
  );
}

function validateRecord(storeName, record) {
  const result = STORE_SCHEMAS[storeName].safeParse(record);
  if (!result.success) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      `${storeName} record failed schema validation.`,
      { details: result.error.flatten() },
    );
  }
  return result.data;
}

function requestToPromise(request, errorCode) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapRequestError(request.error, errorCode));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(mapRequestError(transaction.error));
    transaction.onabort = () => reject(mapRequestError(transaction.error));
  });
}

function normalizeExport(data) {
  return browserApplicationExportSchema.parse({
    schemaVersion: DATABASE_VERSION,
    exportedAt: new Date().toISOString(),
    applications: [],
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: [],
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
    ...data,
  });
}

export function openIndexedDbDatabase({
  indexedDB: indexedDb = globalThis.indexedDB,
  name = DATABASE_NAME,
  version = DATABASE_VERSION,
} = {}) {
  if (!indexedDb?.open) {
    return Promise.reject(
      new IndexedDbRepositoryError(
        "indexeddb_unavailable",
        "IndexedDB is unavailable in this browser context.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name, version);

    request.onupgradeneeded = () => {
      const db = request.result;
      const oldVersion = request.oldVersion ?? 0;
      MIGRATIONS.filter(
        ({ version: targetVersion }) => targetVersion > oldVersion,
      ).forEach(({ migrate }) => migrate(db, request.transaction));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(mapRequestError(request.error, "indexeddb_open_failed"));
    request.onblocked = () =>
      reject(
        new IndexedDbRepositoryError(
          "indexeddb_blocked",
          "Opening the jobbot3000 IndexedDB database was blocked by another tab.",
        ),
      );
  });
}

export function createIndexedDbRepository(options = {}) {
  let dbPromise;

  const getDb = () => {
    dbPromise ??= openIndexedDbDatabase(options);
    return dbPromise;
  };

  async function withStore(storeName, mode, callback) {
    const db = await getDb();
    const transaction = db.transaction(storeName, mode);
    const store = Array.isArray(storeName)
      ? undefined
      : transaction.objectStore(storeName);
    const result = await callback(store, transaction);
    await transactionDone(transaction);
    return result;
  }

  async function putRecord(storeName, record) {
    const parsed = validateRecord(storeName, record);
    await withStore(storeName, "readwrite", (store) =>
      requestToPromise(store.put(parsed)),
    );
    return parsed;
  }

  async function addRecord(storeName, record) {
    const parsed = validateRecord(storeName, record);
    await withStore(storeName, "readwrite", (store) =>
      requestToPromise(store.add(parsed)),
    );
    return parsed;
  }

  async function getAll(storeName) {
    return withStore(storeName, "readonly", (store) =>
      requestToPromise(store.getAll()),
    );
  }

  async function getRecord(storeName, id) {
    return withStore(storeName, "readonly", (store) =>
      requestToPromise(store.get(id)),
    );
  }

  async function replaceAll(exportData) {
    await withStore(ALL_STORES, "readwrite", async (_store, transaction) => {
      await Promise.all(
        ALL_STORES.map((storeName) =>
          requestToPromise(transaction.objectStore(storeName).clear()),
        ),
      );
      for (const storeName of EXPORT_STORES) {
        const store = transaction.objectStore(storeName);
        for (const record of exportData[storeName]) {
          await requestToPromise(store.put(record));
        }
      }
      if (exportData.settings) {
        await requestToPromise(
          transaction.objectStore("settings").put(exportData.settings),
        );
      }
    });
  }

  return {
    async createApplication(application) {
      return addRecord("applications", application);
    },
    async updateApplication(application) {
      return putRecord("applications", application);
    },
    async deleteApplication(id) {
      const db = await getDb();
      const transaction = db.transaction(ALL_STORES, "readwrite");
      await Promise.all(
        EXPORT_STORES.map((storeName) => {
          if (storeName === "applications") {
            return requestToPromise(
              transaction.objectStore(storeName).delete(id),
            );
          }
          return deleteByApplicationId(transaction.objectStore(storeName), id);
        }),
      );
      await transactionDone(transaction);
    },
    async listApplications() {
      return getAll("applications");
    },
    async getApplication(id) {
      return getRecord("applications", id);
    },
    async upsertContact(contact) {
      return putRecord("contacts", contact);
    },
    async addOutreachMessage(message) {
      return addRecord("outreachMessages", message);
    },
    async addLifecycleEvent(event) {
      return addRecord("lifecycleEvents", event);
    },
    async upsertInterview(interview) {
      return putRecord("interviews", interview);
    },
    async upsertOffer(offer) {
      return putRecord("offers", offer);
    },
    async upsertArtifact(artifact) {
      return putRecord("artifacts", artifact);
    },
    async listDueFollowUps(now = new Date().toISOString()) {
      const reminders = await getAll("reminders");
      return reminders
        .filter(({ completedAt, dueAt }) => !completedAt && dueAt <= now)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    },
    async exportAllData() {
      const records = {};
      for (const storeName of EXPORT_STORES) {
        records[storeName] = await getAll(storeName);
      }
      const settings = await getRecord("settings", "local");
      return normalizeExport({ ...records, settings });
    },
    async importAllData(data, { dryRun = false, conflict = "fail" } = {}) {
      let parsed;
      try {
        parsed = normalizeExport(data);
      } catch (error) {
        throw new IndexedDbRepositoryError(
          "schema_validation_failed",
          "Import data failed browser application schema validation.",
          { cause: error, details: error.flatten?.() },
        );
      }

      const current = await this.exportAllData();
      const conflicts = findImportConflicts(current, parsed);
      if (conflicts.length > 0 && conflict !== "replace") {
        throw new IndexedDbRepositoryError(
          "import_conflict",
          "Import would overwrite existing IndexedDB records.",
          { details: { conflicts } },
        );
      }

      const summary = summarizeImport(parsed, conflicts);
      if (!dryRun) {
        await replaceAll(
          conflict === "replace" ? mergeExport(current, parsed) : parsed,
        );
      }
      return summary;
    },
    async clearAllData() {
      await replaceAll(normalizeExport({}));
    },
    async close() {
      const db = await getDb();
      db.close();
      dbPromise = undefined;
    },
  };
}

async function deleteByApplicationId(store, applicationId) {
  const records = await requestToPromise(
    store.index("by_applicationId").getAllKeys(applicationId),
  );
  await Promise.all(records.map((key) => requestToPromise(store.delete(key))));
}

function summarizeImport(exportData, conflicts) {
  return {
    dryRunValid: true,
    schemaVersion: exportData.schemaVersion,
    conflicts,
    counts: Object.fromEntries(
      EXPORT_STORES.map((storeName) => [
        storeName,
        exportData[storeName].length,
      ]),
    ),
  };
}

function findImportConflicts(current, incoming) {
  return EXPORT_STORES.flatMap((storeName) => {
    const currentIds = new Set(current[storeName].map(({ id }) => id));
    return incoming[storeName]
      .filter(({ id }) => currentIds.has(id))
      .map(({ id }) => ({ storeName, id }));
  });
}

function mergeExport(current, incoming) {
  const merged = { ...incoming };
  for (const storeName of EXPORT_STORES) {
    const incomingIds = new Set(incoming[storeName].map(({ id }) => id));
    merged[storeName] = [
      ...current[storeName].filter(({ id }) => !incomingIds.has(id)),
      ...incoming[storeName],
    ];
  }
  merged.settings = incoming.settings ?? current.settings;
  return merged;
}
