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

    const contacts = createStore(db, "contacts");
    if (contacts) {
      ensureIndex(contacts, "by_applicationId", "applicationId");
    }

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
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (
        let currentVersion = event.oldVersion + 1;
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

const addRecord = async (db, storeName, record) => {
  const parsed = parseRecord(storeName, record);
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(storeName).add(parsed);
  await done;
  return parsed;
};

const putRecord = async (db, storeName, record) => {
  const parsed = parseRecord(storeName, record);
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(storeName).put(parsed);
  await done;
  return parsed;
};

const assertReferencesExist = async (db, record) => {
  const stores = ["applications"];
  const contactIds = [record.contactId, ...(record.contactIds ?? [])].filter(
    Boolean,
  );
  if (contactIds.length > 0) stores.push("contacts");

  const tx = db.transaction(stores, "readonly");
  const done = transactionDone(tx);
  const application = await requestToPromise(
    tx.objectStore("applications").get(record.applicationId),
  );
  const contacts = await Promise.all(
    contactIds.map((contactId) =>
      requestToPromise(tx.objectStore("contacts").get(contactId)),
    ),
  );
  await done;

  if (!application) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      "Referenced application does not exist.",
      { details: { applicationId: record.applicationId } },
    );
  }

  const missingContactIds = contactIds.filter((_, index) => !contacts[index]);
  if (missingContactIds.length > 0) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      "Referenced contact does not exist.",
      { details: { contactIds: missingContactIds } },
    );
  }
};

const addChildRecord = async (db, storeName, record) => {
  const parsed = parseRecord(storeName, record);
  await assertReferencesExist(db, parsed);
  return addRecord(db, storeName, parsed);
};

const putChildRecord = async (db, storeName, record) => {
  const parsed = parseRecord(storeName, record);
  await assertReferencesExist(db, parsed);
  return putRecord(db, storeName, parsed);
};

const deleteFromIndex = async (db, storeName, indexName, value) => {
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  await deleteMatchingFromStore(tx.objectStore(storeName), indexName, value);
  await done;
};

const deleteMatchingFromStore = async (store, indexName, value) => {
  const source = store.indexNames.contains(`by_${indexName}`)
    ? store.index(`by_${indexName}`)
    : store;

  await new Promise((resolve, reject) => {
    const request = source.openCursor(source === store ? undefined : value);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (source !== store || cursor.value[indexName] === value) {
        cursor.delete();
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
};

const validateImport = (data) => {
  const result = browserApplicationExportSchema.safeParse(data);
  if (!result.success) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      "Import data does not match the browser application export schema.",
      { details: result.error.flatten() },
    );
  }
  return { parsed: result.data };
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
      return safe(() => addRecord(db, "applications", application));
    },
    updateApplication(application) {
      return safe(() => putRecord(db, "applications", application));
    },
    async deleteApplication(id) {
      return safe(async () => {
        const tx = db.transaction(
          ["applications", ...APPLICATION_CASCADE_STORES],
          "readwrite",
        );
        const done = transactionDone(tx);
        tx.objectStore("applications").delete(id);
        for (const storeName of APPLICATION_CASCADE_STORES) {
          await deleteMatchingFromStore(
            tx.objectStore(storeName),
            "applicationId",
            id,
          );
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
      return safe(() => putChildRecord(db, "contacts", record));
    },
    addOutreachMessage(record) {
      return safe(() => addChildRecord(db, "outreachMessages", record));
    },
    addLifecycleEvent(record) {
      return safe(() => addChildRecord(db, "lifecycleEvents", record));
    },
    upsertInterview(record) {
      return safe(() => putChildRecord(db, "interviews", record));
    },
    upsertOffer(record) {
      return safe(() => putChildRecord(db, "offers", record));
    },
    upsertArtifact(record) {
      return safe(() => putChildRecord(db, "artifacts", record));
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
      return safe(async () => {
        const tx = db.transaction(STORE_NAMES, "readonly");
        const done = transactionDone(tx);
        const storeResults = await Promise.all(
          STORE_NAMES.map((storeName) =>
            requestToPromise(tx.objectStore(storeName).getAll()),
          ),
        );
        await done;
        const [
          applications,
          contacts,
          outreachMessages,
          lifecycleEvents,
          interviews,
          offers,
          artifacts,
          reminders,
          settingsAll,
        ] = storeResults;
        const result = browserApplicationExportSchema.safeParse({
          schemaVersion: DATABASE_VERSION,
          exportedAt: new Date().toISOString(),
          applications,
          contacts,
          outreachMessages,
          lifecycleEvents,
          interviews,
          offers,
          artifacts,
          reminders,
          settings: settingsAll[0],
        });
        if (!result.success) {
          throw new IndexedDbRepositoryError(
            "schema_validation_failed",
            "Export data does not match the browser application export schema.",
            { details: result.error.flatten() },
          );
        }
        return result.data;
      });
    },
    async importAllData(data, { dryRun = false, allowOverwrite = false } = {}) {
      return safe(async () => {
        const { parsed } = validateImport(data);
        const existingRecords = Object.fromEntries(
          await Promise.all(
            STORE_NAMES.map(async (name) => [name, await getAll(db, name)]),
          ),
        );
        const existingKeys = new Set(
          STORE_NAMES.flatMap((storeName) =>
            existingRecords[storeName].map(({ id }) => `${storeName}:${id}`),
          ),
        );
        const incomingRecords = STORE_NAMES.flatMap((storeName) => {
          if (storeName === "settings")
            return parsed.settings
              ? [{ storeName, id: parsed.settings.id }]
              : [];
          return parsed[storeName].map(({ id }) => ({ storeName, id }));
        });
        const conflicts = incomingRecords.filter(({ storeName, id }) =>
          existingKeys.has(`${storeName}:${id}`),
        );
        const hasExistingData = STORE_NAMES.some(
          (name) => existingRecords[name].length > 0,
        );
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
            hasExistingData,
          };
        if (hasExistingData && !allowOverwrite) {
          throw new IndexedDbRepositoryError(
            "import_conflict",
            "Import would replace existing IndexedDB records.",
            { details: { conflicts, hasExistingData } },
          );
        }
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
