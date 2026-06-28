import {
  browserApplicationArtifactSchema,
  browserApplicationContactSchema,
  browserApplicationExportSchema,
  browserApplicationLifecycleEventSchema,
  browserApplicationOfferSchema,
  browserApplicationOutreachMessageSchema,
  browserApplicationReminderSchema,
  browserApplicationInterviewSchema,
  browserApplicationSchema,
  browserApplicationSettingsSchema,
} from "../../domain/browserApplication.js";

export const INDEXED_DB_DATABASE_NAME = "jobbot3000";
export const INDEXED_DB_VERSION = 1;
export const INDEXED_DB_STORES = [
  "applications",
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
  "settings",
];

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

const APPLICATION_SCOPED_STORES = [
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
];

export class IndexedDbRepositoryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "IndexedDbRepositoryError";
    this.code = code;
    this.details = options.details;
  }
}

const toRepositoryError = (error, fallbackMessage) => {
  if (error instanceof IndexedDbRepositoryError) return error;
  if (error?.name === "QuotaExceededError") {
    return new IndexedDbRepositoryError(
      "quota_exceeded",
      "IndexedDB quota exceeded",
      { cause: error },
    );
  }
  if (error?.name === "ConstraintError") {
    return new IndexedDbRepositoryError(
      "import_conflict",
      "Imported data conflicts with existing records",
      { cause: error },
    );
  }
  return new IndexedDbRepositoryError("indexeddb_error", fallbackMessage, {
    cause: error,
  });
};

const requestToPromise = (request, message = "IndexedDB request failed") =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toRepositoryError(request.error, message));
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        toRepositoryError(transaction.error, "IndexedDB transaction failed"),
      );
    transaction.onabort = () =>
      reject(
        toRepositoryError(transaction.error, "IndexedDB transaction aborted"),
      );
  });

const validateRecord = (storeName, record) => {
  const parsed = STORE_SCHEMAS[storeName].safeParse(record);
  if (!parsed.success) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      `Invalid ${storeName} record`,
      {
        details: parsed.error.issues,
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
};

const validateExport = (data) => {
  const parsed = browserApplicationExportSchema.safeParse(data);
  if (!parsed.success) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      "Invalid import data",
      {
        details: parsed.error.issues,
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
};

const ensureIndexedDb = (indexedDB) => {
  if (!indexedDB) {
    throw new IndexedDbRepositoryError(
      "indexeddb_unavailable",
      "IndexedDB is not available in this browser context",
    );
  }
  return indexedDB;
};

const createStore = (db, name) => {
  if (!db.objectStoreNames.contains(name)) {
    return db.createObjectStore(name, { keyPath: "id" });
  }
  return undefined;
};

const createIndex = (store, name, keyPath, options) => {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
};

export const migrations = {
  1(db) {
    const applications = createStore(db, "applications");
    if (applications) {
      createIndex(applications, "byCompany", "company");
      createIndex(applications, "byStatus", "status");
      createIndex(applications, "byAppliedAt", "appliedAt");
      createIndex(applications, "byFollowUpDate", "followUpDate");
    }

    createStore(db, "contacts");

    const outreachMessages = createStore(db, "outreachMessages");
    if (outreachMessages)
      createIndex(outreachMessages, "byApplicationId", "applicationId");

    const lifecycleEvents = createStore(db, "lifecycleEvents");
    if (lifecycleEvents) {
      createIndex(lifecycleEvents, "byApplicationId", "applicationId");
      createIndex(lifecycleEvents, "byApplicationIdAndOccurredAt", [
        "applicationId",
        "occurredAt",
      ]);
    }

    createStore(db, "interviews");
    createStore(db, "offers");

    const artifacts = createStore(db, "artifacts");
    if (artifacts) createIndex(artifacts, "byApplicationId", "applicationId");

    createStore(db, "reminders");
    createStore(db, "settings");
  },
};

const openDatabase = (options = {}) =>
  new Promise((resolve, reject) => {
    const {
      databaseName = INDEXED_DB_DATABASE_NAME,
      version = INDEXED_DB_VERSION,
    } = options;
    const idb = ensureIndexedDb(
      Object.hasOwn(options, "indexedDB")
        ? options.indexedDB
        : globalThis.indexedDB,
    );
    const request = idb.open(databaseName, version);
    request.onupgradeneeded = (event) => {
      for (
        let nextVersion = event.oldVersion + 1;
        nextVersion <= version;
        nextVersion += 1
      ) {
        migrations[nextVersion]?.(request.result, request.transaction);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        toRepositoryError(request.error, "Unable to open IndexedDB database"),
      );
    request.onblocked = () =>
      reject(
        new IndexedDbRepositoryError(
          "indexeddb_blocked",
          "IndexedDB upgrade is blocked by another open tab",
        ),
      );
  });

export async function createIndexedDbRepository(options = {}) {
  const db = await openDatabase(options);

  const withStore = async (storeName, mode, callback) => {
    const transaction = db.transaction(storeName, mode);
    const result = await callback(transaction.objectStore(storeName));
    await transactionDone(transaction);
    return result;
  };

  const putValidated = (storeName, record) =>
    withStore(storeName, "readwrite", (store) =>
      requestToPromise(store.put(validateRecord(storeName, record))),
    );
  const addValidated = (storeName, record) =>
    withStore(storeName, "readwrite", (store) =>
      requestToPromise(store.add(validateRecord(storeName, record))),
    );
  const getAll = (storeName) =>
    withStore(storeName, "readonly", (store) =>
      requestToPromise(store.getAll()),
    );

  const repository = {
    db,
    close() {
      db.close();
    },
    createApplication(application) {
      return addValidated("applications", application);
    },
    updateApplication(application) {
      return putValidated("applications", application);
    },
    deleteApplication(applicationId) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          INDEXED_DB_STORES.filter((name) => name !== "settings"),
          "readwrite",
        );
        transaction.onerror = () =>
          reject(
            toRepositoryError(
              transaction.error,
              "Failed to delete application",
            ),
          );
        transaction.onabort = () =>
          reject(
            toRepositoryError(
              transaction.error,
              "Failed to delete application",
            ),
          );
        transaction.oncomplete = () => resolve();
        transaction.objectStore("applications").delete(applicationId);
        for (const storeName of APPLICATION_SCOPED_STORES) {
          const store = transaction.objectStore(storeName);
          const request = store.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (cursor.value.applicationId === applicationId) cursor.delete();
            cursor.continue();
          };
        }
      });
    },
    listApplications() {
      return getAll("applications");
    },
    getApplication(id) {
      return withStore("applications", "readonly", (store) =>
        requestToPromise(store.get(id)),
      );
    },
    upsertContact(record) {
      return putValidated("contacts", record);
    },
    addOutreachMessage(record) {
      return addValidated("outreachMessages", record);
    },
    addLifecycleEvent(record) {
      return addValidated("lifecycleEvents", record);
    },
    upsertInterview(record) {
      return putValidated("interviews", record);
    },
    upsertOffer(record) {
      return putValidated("offers", record);
    },
    upsertArtifact(record) {
      return putValidated("artifacts", record);
    },
    async listDueFollowUps(now = new Date()) {
      const cutoff = typeof now === "string" ? now : now.toISOString();
      const applications = await getAll("applications");
      return applications.filter(
        ({ followUpDate, closedAt }) =>
          followUpDate && followUpDate <= cutoff && !closedAt,
      );
    },
    async exportAllData() {
      const entries = await Promise.all(
        INDEXED_DB_STORES.map(async (storeName) => [
          storeName,
          await getAll(storeName),
        ]),
      );
      const data = Object.fromEntries(entries);
      return validateExport({
        schemaVersion: INDEXED_DB_VERSION,
        exportedAt: new Date().toISOString(),
        ...data,
        settings: data.settings[0],
      });
    },
    async importAllData(data, { dryRun = false, overwrite = false } = {}) {
      const parsed = validateExport(data);
      if (dryRun)
        return {
          ok: true,
          dryRun: true,
          counts: Object.fromEntries(
            INDEXED_DB_STORES.map((name) => [
              name,
              name === "settings"
                ? parsed.settings
                  ? 1
                  : 0
                : parsed[name].length,
            ]),
          ),
        };
      if (!overwrite) {
        for (const storeName of INDEXED_DB_STORES) {
          const incoming =
            storeName === "settings"
              ? parsed.settings
                ? [parsed.settings]
                : []
              : parsed[storeName];
          for (const record of incoming) {
            if (await repository.getRecord(storeName, record.id)) {
              throw new IndexedDbRepositoryError(
                "import_conflict",
                `Record already exists in ${storeName}: ${record.id}`,
              );
            }
          }
        }
      }
      await repository.clearAllData();
      const transaction = db.transaction(INDEXED_DB_STORES, "readwrite");
      const done = transactionDone(transaction);
      for (const storeName of INDEXED_DB_STORES) {
        const store = transaction.objectStore(storeName);
        const incoming =
          storeName === "settings"
            ? parsed.settings
              ? [parsed.settings]
              : []
            : parsed[storeName];
        incoming.forEach((record) => store.put(record));
      }
      await done;
      return { ok: true, dryRun: false };
    },
    getRecord(storeName, id) {
      return withStore(storeName, "readonly", (store) =>
        requestToPromise(store.get(id)),
      );
    },
    async clearAllData() {
      const transaction = db.transaction(INDEXED_DB_STORES, "readwrite");
      const done = transactionDone(transaction);
      INDEXED_DB_STORES.forEach((storeName) =>
        transaction.objectStore(storeName).clear(),
      );
      await done;
    },
  };

  return repository;
}
