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
import {
  BROWSER_BACKUP_SCHEMA_VERSION,
  LOCAL_SETTINGS_SCHEMA_VERSION,
  upgradeBrowserExportToV2,
} from "./browserDataMigration.js";

export const DATABASE_NAME = "jobbot3000";
export const INDEXEDDB_DATABASE_VERSION = 2;
export const DATABASE_VERSION = INDEXEDDB_DATABASE_VERSION;

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

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const epochOccurredAtValues = new Set([
  "1970-01-01",
  "1970-01-01T00:00:00.000Z",
  "1970-01-01T00:00:00Z",
]);

const removeBlankOptionalFields = (record, fields) =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !(fields.includes(key) && value === ""),
    ),
  );

const inferOccurredAtPrecision = (record) => {
  if (["instant", "date", "unknown"].includes(record.occurredAtPrecision))
    return record.occurredAtPrecision;
  if (record.occurredAtHasTime === true) return "instant";
  if (record.occurredAtHasTime === false) return "date";
  if (epochOccurredAtValues.has(record.occurredAt)) return "unknown";
  if (isoDate.test(String(record.occurredAt))) return "date";
  return "instant";
};

const normalizeRecordForStore = (storeName, record) => {
  if (storeName === "applications") {
    const normalized = removeBlankOptionalFields(record, [
      "source",
      "postingUrl",
      "location",
      "compensationText",
      "notes",
    ]);
    if (!normalized.origin)
      return {
        ...normalized,
        origin: normalized.source === "referral" ? "referral" : "other_unknown",
      };
    return normalized;
  }
  if (storeName === "lifecycleEvents") {
    const normalized = removeBlankOptionalFields(record, [
      "note",
      "rawEventType",
      "previousStatus",
      "supersedesEventId",
      "stageLabel",
      "channel",
      "actor",
      "sourceArtifact",
      "actionStatus",
      "details",
    ]);
    const eventType =
      normalized.eventType ??
      (normalized.status === "applied"
        ? "application_submitted"
        : "status_changed");
    return {
      ...normalized,
      eventType,
      occurredAtPrecision: inferOccurredAtPrecision(normalized),
      inferred: normalized.inferred ?? false,
    };
  }
  if (
    storeName === "settings" &&
    record.schemaVersion !== LOCAL_SETTINGS_SCHEMA_VERSION
  )
    return { ...record, schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION };
  return record;
};

const parseRecord = (storeName, record) => {
  const result = STORE_SCHEMAS[storeName].safeParse(
    normalizeRecordForStore(storeName, record),
  );
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

    const interviews = createStore(db, "interviews");
    if (interviews) {
      ensureIndex(interviews, "by_applicationId", "applicationId");
    }

    const offers = createStore(db, "offers");
    if (offers) {
      ensureIndex(offers, "by_applicationId", "applicationId");
    }

    const artifacts = createStore(db, "artifacts");
    if (artifacts) {
      ensureIndex(artifacts, "by_applicationId", "applicationId");
    }

    const reminders = createStore(db, "reminders");
    if (reminders) {
      ensureIndex(reminders, "by_applicationId", "applicationId");
    }
    createStore(db, "settings");
  },
  2(_db, transaction) {
    const applications = transaction.objectStore("applications");
    ensureIndex(applications, "by_origin", "origin");
    const lifecycleEvents = transaction.objectStore("lifecycleEvents");
    ensureIndex(lifecycleEvents, "by_occurredAt", "occurredAt");

    const storeResults = {};
    let remaining = STORE_NAMES.length;
    const fail = (error) => {
      transaction.abort();
      throw error;
    };
    for (const storeName of STORE_NAMES) {
      const request = transaction.objectStore(storeName).getAll();
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        storeResults[storeName] = request.result;
        remaining -= 1;
        if (remaining > 0) return;
        try {
          const migrationCreatedAt = new Date().toISOString();
          const { data } = upgradeBrowserExportToV2(
            {
              schemaVersion: 1,
              exportedAt: migrationCreatedAt,
              applications: storeResults.applications ?? [],
              contacts: storeResults.contacts ?? [],
              outreachMessages: storeResults.outreachMessages ?? [],
              lifecycleEvents: storeResults.lifecycleEvents ?? [],
              interviews: storeResults.interviews ?? [],
              offers: storeResults.offers ?? [],
              artifacts: storeResults.artifacts ?? [],
              reminders: storeResults.reminders ?? [],
              settings: storeResults.settings?.[0],
            },
            { migrationCreatedAt },
          );
          const validation = browserApplicationExportSchema.safeParse(data);
          if (!validation.success) {
            throw new IndexedDbRepositoryError(
              "schema_validation_failed",
              "IndexedDB migration data does not match the v2 schema.",
              { details: validation.error.flatten() },
            );
          }
          for (const storeName of STORE_NAMES)
            transaction.objectStore(storeName).clear();
          for (const storeName of STORE_NAMES.filter(
            (name) => name !== "settings",
          ))
            for (const record of validation.data[storeName])
              transaction.objectStore(storeName).put(record);
          if (validation.data.settings)
            transaction.objectStore("settings").put(validation.data.settings);
        } catch (error) {
          fail(error);
        }
      };
    }
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
  const upgraded = upgradeBrowserExportToV2(data);
  const result = browserApplicationExportSchema.safeParse(upgraded.data);
  if (!result.success) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      "Import data does not match the browser application export schema.",
      { details: result.error.flatten() },
    );
  }
  return { parsed: result.data, warnings: upgraded.warnings };
};

const validateSupersessionGraph = (events) => {
  const byId = new Map(events.map((event) => [event.id, event]));
  for (const event of events) {
    if (!event.supersedesEventId) continue;
    const target = byId.get(event.supersedesEventId);
    if (!target) {
      throw new IndexedDbRepositoryError(
        "schema_validation_failed",
        "Superseded lifecycle event does not exist.",
        { details: { supersedesEventId: event.supersedesEventId } },
      );
    }
    if (target.applicationId !== event.applicationId) {
      throw new IndexedDbRepositoryError(
        "schema_validation_failed",
        "Superseded lifecycle event belongs to another application.",
        { details: { supersedesEventId: event.supersedesEventId } },
      );
    }
    const seen = new Set([event.id]);
    let cursor = target;
    while (cursor?.supersedesEventId) {
      if (seen.has(cursor.supersedesEventId)) {
        throw new IndexedDbRepositoryError(
          "schema_validation_failed",
          "Lifecycle event supersession chain must be acyclic.",
          { details: { eventId: event.id } },
        );
      }
      seen.add(cursor.supersedesEventId);
      cursor = byId.get(cursor.supersedesEventId);
    }
  }
};

const parseLifecycleMutation = async (db, mutation) => {
  const operationTime = mutation.operationTime ?? new Date().toISOString();
  const applicationInput = mutation.application ?? mutation.upsertApplication;
  if (!applicationInput?.id) {
    throw new IndexedDbRepositoryError(
      "schema_validation_failed",
      "Lifecycle mutation requires an application.",
    );
  }
  const existingApplication = await getAll(db, "applications").then((rows) =>
    rows.find((row) => row.id === applicationInput.id),
  );
  const application = parseRecord("applications", {
    ...applicationInput,
    updatedAt: applicationInput.updatedAt ?? operationTime,
    createdAt:
      applicationInput.createdAt ??
      existingApplication?.createdAt ??
      operationTime,
  });
  const previousStatus = existingApplication?.status;
  const childRecords = mutation.records ?? {};
  const parsed = {
    application,
    contacts: (childRecords.contacts ?? mutation.contacts ?? []).map((row) =>
      parseRecord("contacts", row),
    ),
    outreachMessages: (
      childRecords.outreachMessages ??
      mutation.outreachMessages ??
      []
    ).map((row) => parseRecord("outreachMessages", row)),
    interviews: (childRecords.interviews ?? mutation.interviews ?? []).map(
      (row) => parseRecord("interviews", row),
    ),
    offers: (childRecords.offers ?? mutation.offers ?? []).map((row) =>
      parseRecord("offers", row),
    ),
    artifacts: (childRecords.artifacts ?? mutation.artifacts ?? []).map((row) =>
      parseRecord("artifacts", row),
    ),
    reminders: (childRecords.reminders ?? mutation.reminders ?? []).map((row) =>
      parseRecord("reminders", row),
    ),
    lifecycleEvents: (
      childRecords.lifecycleEvents ??
      mutation.lifecycleEvents ??
      []
    ).map((row) =>
      parseRecord("lifecycleEvents", {
        ...row,
        previousStatus: row.previousStatus ?? previousStatus,
        createdAt: row.createdAt ?? operationTime,
      }),
    ),
  };
  for (const [storeName, rows] of Object.entries(parsed)) {
    if (storeName === "application") continue;
    for (const row of rows) {
      if (row.applicationId !== application.id) {
        throw new IndexedDbRepositoryError(
          "schema_validation_failed",
          "Lifecycle mutation child records must reference the mutated application.",
          { details: { storeName, applicationId: row.applicationId } },
        );
      }
    }
  }
  const contacts = new Set(parsed.contacts.map((row) => row.id));
  for (const row of [...parsed.outreachMessages, ...parsed.reminders])
    if (row.contactId && !contacts.has(row.contactId)) {
      const existing = await getAll(db, "contacts");
      if (
        !existing.some(
          (contact) =>
            contact.id === row.contactId &&
            contact.applicationId === application.id,
        )
      )
        throw new IndexedDbRepositoryError(
          "schema_validation_failed",
          "Lifecycle mutation references an unknown contact.",
        );
    }
  const existingEvents = await getAll(db, "lifecycleEvents");
  validateSupersessionGraph([...existingEvents, ...parsed.lifecycleEvents]);
  return { operationTime, previousStatus, ...parsed };
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
          schemaVersion: BROWSER_BACKUP_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          applications,
          contacts,
          outreachMessages,
          lifecycleEvents,
          interviews,
          offers,
          artifacts,
          reminders,
          settings: settingsAll[0]
            ? {
                ...settingsAll[0],
                schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
              }
            : undefined,
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
    // Full-restore operation: non-dry-run imports replace every store.
    // Callers should dry-run first and set allowOverwrite when existing data may be cleared.
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
    listRecords(storeName) {
      return safe(() => getAll(db, storeName));
    },
    upsertApplication(record) {
      return safe(() => putRecord(db, "applications", record));
    },
    createLifecycleEvent(record) {
      return safe(() => addChildRecord(db, "lifecycleEvents", record));
    },
    createArtifact(record) {
      return safe(() => addChildRecord(db, "artifacts", record));
    },
    createOutreachMessage(record) {
      return safe(() => addChildRecord(db, "outreachMessages", record));
    },
    createInterview(record) {
      return safe(() => addChildRecord(db, "interviews", record));
    },
    createOffer(record) {
      return safe(() => addChildRecord(db, "offers", record));
    },

    async commitLifecycleMutation(mutation) {
      return safe(async () => {
        const parsed = await parseLifecycleMutation(db, mutation);
        const stores = [
          "applications",
          "contacts",
          "outreachMessages",
          "interviews",
          "offers",
          "artifacts",
          "reminders",
          "lifecycleEvents",
        ].filter(
          (storeName) =>
            storeName === "applications" || parsed[storeName]?.length > 0,
        );
        const tx = db.transaction(stores, "readwrite");
        const done = transactionDone(tx);
        tx.objectStore("applications").put(parsed.application);
        for (const storeName of stores.filter(
          (name) => name !== "applications" && name !== "lifecycleEvents",
        ))
          for (const row of parsed[storeName])
            tx.objectStore(storeName).put(row);
        if (stores.includes("lifecycleEvents"))
          for (const row of parsed.lifecycleEvents)
            tx.objectStore("lifecycleEvents").add(row);
        await done;
        return {
          application: parsed.application,
          lifecycleEvents: parsed.lifecycleEvents,
          previousStatus: parsed.previousStatus,
          operationTime: parsed.operationTime,
        };
      });
    },
    async importPartialData(recordsByStore) {
      return safe(async () => {
        const storeNames = Object.entries(recordsByStore)
          .filter(([, rows]) => rows.length)
          .map(([name]) => name);
        if (!storeNames.length) return;
        const parsedRowsByStore = Object.fromEntries(
          Object.entries(recordsByStore).map(([storeName, rows]) => [
            storeName,
            rows.map((row) => parseRecord(storeName, row)),
          ]),
        );
        const existing = Object.fromEntries(
          await Promise.all(
            STORE_NAMES.map(async (name) => [name, await getAll(db, name)]),
          ),
        );
        const merged = Object.fromEntries(
          STORE_NAMES.map((name) => {
            const byId = new Map(
              (existing[name] ?? []).map((record) => [record.id, record]),
            );
            for (const record of parsedRowsByStore[name] ?? [])
              byId.set(record.id, record);
            return [name, [...byId.values()]];
          }),
        );
        const validation = browserApplicationExportSchema.safeParse({
          schemaVersion: BROWSER_BACKUP_SCHEMA_VERSION,
          exportedAt: new Date(0).toISOString(),
          applications: merged.applications,
          contacts: merged.contacts,
          outreachMessages: merged.outreachMessages,
          lifecycleEvents: merged.lifecycleEvents,
          interviews: merged.interviews,
          offers: merged.offers,
          artifacts: merged.artifacts,
          reminders: merged.reminders,
          settings: merged.settings[0]
            ? {
                ...merged.settings[0],
                schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
              }
            : undefined,
        });
        if (!validation.success)
          throw new IndexedDbRepositoryError(
            "schema_validation_failed",
            "Bulk records would violate browser application references.",
            { details: validation.error.flatten() },
          );
        const tx = db.transaction(storeNames, "readwrite");
        const done = transactionDone(tx);
        for (const [storeName, rows] of Object.entries(parsedRowsByStore))
          for (const row of rows) tx.objectStore(storeName).put(row);
        await done;
      });
    },
    async _deleteByApplicationId(storeName, applicationId) {
      return deleteFromIndex(db, storeName, "applicationId", applicationId);
    },
  };
};
