// Import-only policy: export remains available for repairing legacy backups.
export const IMPORT_LIMITS_V1 = Object.freeze({
  policyVersion: 1,
  bytes: 8 * 1024 * 1024,
  csvRows: 5000,
  csvColumns: 64,
  ndjsonLines: 10002,
  lineBytes: 1024 * 1024,
  depth: 32,
  units: 100000,
  stringLength: 65536,
  records: 10000,
  applications: 1000,
  lifecycleEvents: 5000,
  contactEdges: 20000,
  supersessionChain: 128,
  issues: 50,
});

export const IMPORT_STORES = Object.freeze([
  "applications",
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
  "settings",
]);
export const IMPORT_REPAIR_HINT =
  "Keep the original backup. Repair a copy and preview it again. Nothing was imported.";
export class ImportAdmissionError extends Error {
  constructor(
    code = "import_admission_failed",
    issues = [],
    truncated = false,
  ) {
    super(
      code === "import_ownership_failed"
        ? "A contact reference does not belong to its application. " +
            "Choose a contact for this application or remove the optional reference. " +
            IMPORT_REPAIR_HINT
        : "Import data is malformed or exceeds import policy limits. " +
            IMPORT_REPAIR_HINT,
    );
    this.name = "ImportAdmissionError";
    this.code = code;
    this.issues = issues.slice(0, IMPORT_LIMITS_V1.issues);
    this.truncated = truncated;
  }
}
export const rejectImport = () => {
  throw new ImportAdmissionError();
};
export const assertImportFileSize = (byteLength) => {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > IMPORT_LIMITS_V1.bytes
  )
    rejectImport();
};
const assertBytes = (text, maximum) => {
  if (
    typeof text !== "string" ||
    text.length > maximum ||
    new TextEncoder().encode(text).length > maximum
  )
    rejectImport();
};
// JSON.parse remains the syntax authority. This scan bounds nesting before it runs.
export const preflightJson = (text, work = { units: 0 }) => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let scalar = false;
  const unit = () => {
    if (++work.units > IMPORT_LIMITS_V1.units) rejectImport();
  };
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      unit();
      quoted = true;
      scalar = false;
    } else if (char === "{" || char === "[") {
      unit();
      scalar = false;
      if (++depth > IMPORT_LIMITS_V1.depth) rejectImport();
    } else if (char === "}" || char === "]") {
      depth--;
      scalar = false;
    } else if (/\s|[:,]/.test(char)) scalar = false;
    else if (!scalar) {
      unit();
      scalar = true;
    }
  }
};
export function* importNdjsonLines(text) {
  let start = 0;
  let sourceLine = 1;
  let count = 0;
  for (let index = 0; index <= text.length; index++) {
    if (index !== text.length && text[index] !== "\n") continue;
    const line = text.slice(start, index);
    assertBytes(line, IMPORT_LIMITS_V1.lineBytes);
    if (line.trim()) {
      if (++count > IMPORT_LIMITS_V1.ndjsonLines) rejectImport();
      yield { line, sourceLine };
    }
    start = index + 1;
    sourceLine++;
  }
}
export const assertImportTextBudget = (text, format) => {
  assertBytes(text, IMPORT_LIMITS_V1.bytes);
  if (format === "json") preflightJson(text);
  if (format === "ndjson") {
    const work = { units: 0 };
    for (const { line } of importNdjsonLines(text)) preflightJson(line, work);
  }
};
// Inspect descriptors, never read an accessor. Shared/cyclic object graphs are not JSON trees.
export const assertImportObjectBudget = (input, work = { units: 0 }) => {
  const seen = new Set();
  const stack = [[input, 1, false]];
  while (stack.length) {
    const [value, depth, optional] = stack.pop();
    if (++work.units > IMPORT_LIMITS_V1.units || depth > IMPORT_LIMITS_V1.depth)
      rejectImport();
    if (value === undefined && optional) continue;
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (value.length > IMPORT_LIMITS_V1.stringLength) rejectImport();
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) continue;
    if (typeof value !== "object" || seen.has(value)) rejectImport();
    seen.add(value);
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      rejectImport();
    const keys = Reflect.ownKeys(value);
    if (array && value.length > IMPORT_LIMITS_V1.units) rejectImport();
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || key.length > IMPORT_LIMITS_V1.stringLength)
        rejectImport();
      if (!array && ++work.units > IMPORT_LIMITS_V1.units) rejectImport();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!("value" in descriptor) || !descriptor.enumerable) rejectImport();
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) rejectImport();
      stack.push([descriptor.value, depth + 1, !array]);
    }
    if (array && keys.length !== value.length + 1) rejectImport();
  }
  return work;
};
export const assertImportRowsBudget = (rows) => {
  assertImportObjectBudget(rows);
  if (!Array.isArray(rows) || rows.length > IMPORT_LIMITS_V1.csvRows)
    rejectImport();
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).length > IMPORT_LIMITS_V1.csvColumns
    )
      rejectImport();
  }
};
export const assertImportCandidateBudget = (
  candidate,
  { kind = "backup", rejectDuplicateIds = true } = {},
) => {
  assertImportObjectBudget(candidate);
  if (!candidate || Array.isArray(candidate) || typeof candidate !== "object")
    rejectImport();
  if (
    kind === "partial" &&
    Object.keys(candidate).some((key) => !IMPORT_STORES.includes(key))
  ) {
    rejectImport();
  }
  let count = 0;
  let edges = 0;
  for (const store of IMPORT_STORES) {
    const records = candidate[store];
    if (records === undefined) continue;
    if (store === "settings" && kind === "backup") {
      count++;
      continue;
    }
    if (!Array.isArray(records)) rejectImport();
    count += records.length;
    if (records.length > (IMPORT_LIMITS_V1[store] ?? IMPORT_LIMITS_V1.records))
      rejectImport();
    const ids = new Set();
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record))
        rejectImport();
      // Normalize the identity as the schema does, before partial merge can hide a duplicate.
      if (typeof record.id === "string") {
        const id = record.id.trim();
        if (rejectDuplicateIds && ids.has(id)) rejectImport();
        ids.add(id);
      }
      if (store === "interviews" && record.contactIds !== undefined) {
        if (!Array.isArray(record.contactIds)) rejectImport();
        edges += record.contactIds.length;
      }
      if (
        ["outreachMessages", "reminders"].includes(store) &&
        record.contactId !== undefined
      )
        edges++;
    }
  }
  if (count > IMPORT_LIMITS_V1.records || edges > IMPORT_LIMITS_V1.contactEdges)
    rejectImport();
  const events = candidate.lifecycleEvents ?? [];
  const normalizedId = (value) =>
    typeof value === "string" ? value.trim() : value;
  const byId = new Map(events.map((event) => [normalizedId(event.id), event]));
  for (const event of events) {
    let cursor = event;
    const visited = new Set();
    while (cursor) {
      if (
        visited.has(cursor) ||
        visited.size >= IMPORT_LIMITS_V1.supersessionChain
      )
        rejectImport();
      visited.add(cursor);
      cursor = byId.get(normalizedId(cursor.supersedesEventId));
    }
  }
};
