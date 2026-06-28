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

export const STORE_NAMES = [
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

const APPLICATION_CASCADE_STORES = STORE_NAMES.filter(
  (storeName) => !["applications", "settings"].includes(storeName),
);

export class IndexedDbRepositoryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "IndexedDbRepositoryError";
    this.code = code;
    this.cause = options.cause;
    this.details = options.details;
  }
}

const wrapError = (error, fallbackCode, fallbackMessage) => {
  if (error instanceof IndexedDbRepositoryError) return error;
  if (error?.name === "QuotaExceededError") {
    return new IndexedDbRepositoryError(
      "quota_exceeded",
      "IndexedDB quota was exceeded while saving jobbot3000 data.",
      { cause: error },
    );
  }
  return new IndexedDbRepositoryError(fallbackCode, fallbackMessage, {
    cause: error,
  });
};

const parseRecord = (storeName, record) => {
  const result = STORE_SCHEMAS[storeName].safeParse(record);
  if (!result.success) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      `Invalid ${storeName} record.`,
      { details: result.error.flatten() },
    );
  }
  return result.data;
};

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });

const createStore = (db, name) => {
  if (!db.objectStoreNames.contains(name)) {
    return db.createObjectStore(name, { keyPath: "id" });
  }
  return null;
};

const ensureIndex = (store, name, keyPath, options = {}) => {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
};

export const migrations = {
  1(db) {
    const applications = createStore(db, "applications");
    if (applications) {
      ensureIndex(applications, "by_company", "company");
      ensureIndex(applications, "by_status", "status");
      ensureIndex(applications, "by_appliedAt", "appliedAt");
      ensureIndex(applications, "by_followUpDate", "followUpDate");
    }

    createStore(db, "contacts");

    const outreachMessages = createStore(db, "outreachMessages");
    if (outreachMessages) {
      ensureIndex(outreachMessages, "by_applicationId", "applicationId");
    }

    const lifecycleEvents = createStore(db, "lifecycleEvents");
    if (lifecycleEvents) {
      ensureIndex(lifecycleEvents, "by_applicationId", "applicationId");
      ensureIndex(lifecycleEvents, "by_applicationId_occurredAt", [
        "applicationId",
        "occurredAt",
      ]);
    }

    createStore(db, "interviews");
    createStore(db, "offers");

    const artifacts = createStore(db, "artifacts");
    if (artifacts) {
      ensureIndex(artifacts, "by_applicationId", "applicationId");
    }

    createStore(db, "reminders");
    createStore(db, "settings");
  },
};

const getIndexedDb = (indexedDb) => {
  const resolved = indexedDb ?? globalThis.indexedDB;
  if (!resolved) {
    throw new IndexedDbRepositoryError(
      "indexeddb_unavailable",
      "IndexedDB is unavailable in this browser context.",
    );
  }
  return resolved;
};

export const openJobbotDatabase = ({
  databaseName = DATABASE_NAME,
  version = DATABASE_VERSION,
  indexedDb,
} = {}) => {
  const idb = getIndexedDb(indexedDb);
  return new Promise((resolve, reject) => {
    const request = idb.open(databaseName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (
        let currentVersion = (request.oldVersion ?? 0) + 1;
        currentVersion <= version;
        currentVersion += 1
      ) {
        migrations[currentVersion]?.(db, request.transaction);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        wrapError(
          request.error,
          "open_failed",
          "Unable to open jobbot3000 IndexedDB database.",
        ),
      );
    request.onblocked = () =>
      reject(
        new IndexedDbRepositoryError(
          "open_blocked",
          "IndexedDB upgrade is blocked by another open jobbot3000 tab.",
        ),
      );
  });
};

const getAll = async (db, storeName) => {
  const tx = db.transaction(storeName, "readonly");
  const done = transactionDone(tx);
  const records = await requestToPromise(tx.objectStore(storeName).getAll());
  await done;
  return records;
};

const putRecord = async (db, storeName, record) => {
  const parsed = parseRecord(storeName, record);
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(storeName).put(parsed);
  await done;
  return parsed;
};

const deleteFromIndex = async (db, storeName, indexName, value) => {
  const records = await getAll(db, storeName);
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore(storeName);
  records
    .filter((record) => record[indexName] === value)
    .forEach((record) => store.delete(record.id));
  await done;
};

const validateImport = (data, { allowOverwrite }) => {
  const result = browserApplicationExportSchema.safeParse(data);
  if (!result.success) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      "Import data does not match the browser application export schema.",
      { details: result.error.flatten() },
    );
  }
  return { parsed: result.data, allowOverwrite };
};

export const createIndexedDbRepository = async (options = {}) => {
  let db;
  try {
    db = await openJobbotDatabase(options);
  } catch (error) {
    throw wrapError(
      error,
      "open_failed",
      "Unable to open jobbot3000 IndexedDB database.",
    );
  }

  const safe = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      throw wrapError(error, "operation_failed", "IndexedDB operation failed.");
    }
  };

  return {
    close() {
      db.close();
    },
    createApplication(application) {
      return safe(() => putRecord(db, "applications", application));
    },
    updateApplication(application) {
      return safe(() => putRecord(db, "applications", application));
    },
    async deleteApplication(id) {
      return safe(async () => {
        const relatedRecords = await Promise.all(
          APPLICATION_CASCADE_STORES.map(async (storeName) => [
            storeName,
            (await getAll(db, storeName)).filter(
              (record) => record.applicationId === id,
            ),
          ]),
        );
        const tx = db.transaction(
          ["applications", ...APPLICATION_CASCADE_STORES],
          "readwrite",
        );
        const done = transactionDone(tx);
        tx.objectStore("applications").delete(id);
        for (const [storeName, records] of relatedRecords) {
          const store = tx.objectStore(storeName);
          records.forEach((record) => store.delete(record.id));
        }
        await done;
      });
    },
    async listApplications() {
      return safe(async () =>
        (await getAll(db, "applications")).sort((a, b) =>
          (b.appliedAt ?? b.createdAt).localeCompare(
            a.appliedAt ?? a.createdAt,
          ),
        ),
      );
    },
    async getApplication(id) {
      return safe(async () => {
        const tx = db.transaction("applications", "readonly");
        const done = transactionDone(tx);
        const record = await requestToPromise(
          tx.objectStore("applications").get(id),
        );
        await done;
        return record ?? null;
      });
    },
    upsertContact(record) {
      return safe(() => putRecord(db, "contacts", record));
    },
    addOutreachMessage(record) {
      return safe(() => putRecord(db, "outreachMessages", record));
    },
    addLifecycleEvent(record) {
      return safe(() => putRecord(db, "lifecycleEvents", record));
    },
    upsertInterview(record) {
      return safe(() => putRecord(db, "interviews", record));
    },
    upsertOffer(record) {
      return safe(() => putRecord(db, "offers", record));
    },
    upsertArtifact(record) {
      return safe(() => putRecord(db, "artifacts", record));
    },
    async listDueFollowUps(now = new Date().toISOString()) {
      return safe(async () =>
        (await getAll(db, "applications")).filter(
          (application) =>
            application.followUpDate && application.followUpDate <= now,
        ),
      );
    },
    async exportAllData() {
      return safe(async () =>
        browserApplicationExportSchema.parse({
          schemaVersion: DATABASE_VERSION,
          exportedAt: new Date().toISOString(),
          applications: await getAll(db, "applications"),
          contacts: await getAll(db, "contacts"),
          outreachMessages: await getAll(db, "outreachMessages"),
          lifecycleEvents: await getAll(db, "lifecycleEvents"),
          interviews: await getAll(db, "interviews"),
          offers: await getAll(db, "offers"),
          artifacts: await getAll(db, "artifacts"),
          reminders: await getAll(db, "reminders"),
          settings: (await getAll(db, "settings"))[0],
        }),
      );
    },
    async importAllData(data, { dryRun = false, allowOverwrite = false } = {}) {
      return safe(async () => {
        const { parsed } = validateImport(data, { allowOverwrite });
        const existingIds = new Set(
          (
            await Promise.all(
              STORE_NAMES.filter((name) => name !== "settings").map((name) =>
                getAll(db, name),
              ),
            )
          )
            .flat()
            .map(({ id }) => id),
        );
        const incomingIds = STORE_NAMES.filter(
          (name) => name !== "settings",
        ).flatMap((name) => parsed[name].map(({ id }) => id));
        const conflicts = incomingIds.filter((id) => existingIds.has(id));
        if (conflicts.length > 0 && !allowOverwrite) {
          throw new IndexedDbRepositoryError(
            "import_conflict",
            "Import would overwrite existing records.",
            { details: { conflicts } },
          );
        }
        if (dryRun)
          return {
            imported: false,
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
        const tx = db.transaction(STORE_NAMES, "readwrite");
        const done = transactionDone(tx);
        for (const storeName of STORE_NAMES) tx.objectStore(storeName).clear();
        for (const storeName of STORE_NAMES.filter(
          (name) => name !== "settings",
        )) {
          for (const record of parsed[storeName])
            tx.objectStore(storeName).put(record);
        }
        if (parsed.settings) tx.objectStore("settings").put(parsed.settings);
        await done;
        return {
          imported: true,
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
      });
    },
    async clearAllData() {
      return safe(async () => {
        const tx = db.transaction(STORE_NAMES, "readwrite");
        const done = transactionDone(tx);
        for (const storeName of STORE_NAMES) tx.objectStore(storeName).clear();
        await done;
      });
    },
    async _deleteByApplicationId(storeName, applicationId) {
      return deleteFromIndex(db, storeName, "applicationId", applicationId);
    },
  };
};
