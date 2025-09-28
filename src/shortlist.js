import fs from 'node:fs/promises';
import path from 'node:path';

import { recordJobDiscard } from './discards.js';

let overrideDir;

export function getShortlistDataDir() {
  return overrideDir;
}

const METADATA_FIELDS = ['location', 'level', 'compensation'];
const UNKNOWN_TIME_SENTINEL = '(unknown time)';

const CURRENCY_SYMBOL_RE = /^\p{Sc}/u;
const SIMPLE_NUMERIC_RE = /^\d[\d.,]*(?:\s?(?:k|m|b))?$/i;
const UNKNOWN_DISCARD_TIMESTAMP = '(unknown time)';

function getDefaultCurrencySymbol() {
  const raw = process.env.JOBBOT_SHORTLIST_CURRENCY;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) return trimmed;
  }
  return '$';
}

function normalizeCompensationValue(value) {
  const sanitized = sanitizeString(value);
  if (!sanitized) return undefined;
  if (CURRENCY_SYMBOL_RE.test(sanitized)) return sanitized;
  if (!/^\d/.test(sanitized)) return sanitized;
  if (!SIMPLE_NUMERIC_RE.test(sanitized)) return sanitized;
  return `${getDefaultCurrencySymbol()}${sanitized}`;
}

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setShortlistDataDir(dir) {
  overrideDir = dir || undefined;
}

function getPaths() {
  const dir = resolveDataDir();
  return { dir, file: path.join(dir, 'shortlist.json') };
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDiscardTags(input) {
  if (!input) return undefined;
  const list = Array.isArray(input) ? input : [input];
  const normalized = [];
  const seen = new Set();
  for (const candidate of list) {
    const value = sanitizeString(candidate);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDiscardTimestamp(input) {
  if (input instanceof Date) return input.toISOString();
  const value = sanitizeString(input);
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

function normalizeDiscardEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const reason = sanitizeString(entry.reason);
  const rawTimestamp = entry.discarded_at ?? entry.discardedAt ?? entry.date;
  const tags = normalizeDiscardTags(entry.tags);
  const normalized = {};
  if (reason) normalized.reason = reason;
  if (tags) normalized.tags = tags;
  let discardedAt = normalizeDiscardTimestamp(rawTimestamp);
  if (!discardedAt && (normalized.reason || normalized.tags)) {
    discardedAt = UNKNOWN_TIME_SENTINEL;
  }
  if (discardedAt) normalized.discarded_at = discardedAt;
  if (Object.keys(normalized).length === 0) return null;
  return normalized;
}

function normalizeDiscardList(list) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  for (const entry of list) {
    const value = normalizeDiscardEntry(entry);
    if (value) normalized.push(value);
  }
  return normalized;
}

function cloneDiscardList(list) {
  if (!Array.isArray(list)) return [];
  const clones = list.map(entry => {
    const clone = { ...entry };
    if (Array.isArray(clone.tags)) clone.tags = clone.tags.slice();
    clone.discarded_at = normalizeDiscardTimestampForSnapshot(clone.discarded_at);
    return clone;
  });
  clones.sort(compareDiscardEntries);
  return clones;
}

function normalizeDiscardTimestampForSnapshot(value) {
  const sanitized = sanitizeString(value);
  if (!sanitized) return UNKNOWN_DISCARD_TIMESTAMP;
  const lower = sanitized.toLowerCase();
  if (lower === 'unknown time' || sanitized === UNKNOWN_DISCARD_TIMESTAMP) {
    return UNKNOWN_DISCARD_TIMESTAMP;
  }
  return sanitized;
}

function compareDiscardEntries(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const aTime = Date.parse(a.discarded_at);
  const bTime = Date.parse(b.discarded_at);
  const aValid = !Number.isNaN(aTime);
  const bValid = !Number.isNaN(bTime);
  if (aValid && bValid) {
    if (aTime === bTime) return 0;
    return aTime > bTime ? -1 : 1;
  }
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function getLastDiscardSummary(discarded) {
  if (!Array.isArray(discarded) || discarded.length === 0) return undefined;
  const latest = discarded[0];
  const summary = {};
  if (latest.reason) summary.reason = latest.reason;
  if (latest.discarded_at) summary.discarded_at = latest.discarded_at;
  if (Array.isArray(latest.tags) && latest.tags.length > 0) {
    summary.tags = latest.tags.slice();
  }
  return Object.keys(summary).length === 0 ? undefined : summary;
}

function normalizeSyncedAt(input) {
  if (input instanceof Date) return input.toISOString();
  if (input == null) return undefined;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid sync timestamp: ${input}`);
  }
  return date.toISOString();
}

function normalizeExistingMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  const normalized = {};
  for (const field of METADATA_FIELDS) {
    const rawValue = metadata[field];
    const value =
      field === 'compensation'
        ? normalizeCompensationValue(rawValue)
        : sanitizeString(rawValue);
    if (value) normalized[field] = value;
  }
  const syncedInput = metadata.synced_at ?? metadata.syncedAt;
  const synced = sanitizeString(syncedInput);
  if (synced) {
    try {
      normalized.synced_at = normalizeSyncedAt(synced);
    } catch {
      // Ignore invalid timestamps from older data
    }
  }
  return normalized;
}

async function readShortlistFile(file) {
  try {
    const contents = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(contents);
    const store = { jobs: {} };
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const jobs =
        parsed.jobs && typeof parsed.jobs === 'object' && !Array.isArray(parsed.jobs)
          ? parsed.jobs
          : {};
      for (const [jobId, rawRecord] of Object.entries(jobs)) {
        if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
          store.jobs[jobId] = { tags: [], discarded: [], metadata: {} };
          continue;
        }
        store.jobs[jobId] = {
          tags: Array.isArray(rawRecord.tags) ? rawRecord.tags.slice() : [],
          discarded: normalizeDiscardList(rawRecord.discarded),
          metadata: normalizeExistingMetadata(rawRecord.metadata),
        };
      }
    }
    return store;
  } catch (err) {
    if (err && err.code === 'ENOENT') return { jobs: {} };
    throw err;
  }
}

async function writeJsonFile(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

function normalizeTag(tag) {
  return sanitizeString(tag);
}

function normalizeTagList(list) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  const seen = new Set();
  for (const entry of list) {
    const value = normalizeTag(entry);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function ensureJobRecord(store, jobId) {
  const existing = store.jobs[jobId];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    store.jobs[jobId] = { tags: [], discarded: [], metadata: {} };
  } else {
    const record = existing;
    record.tags = normalizeTagList(record.tags);
    if (!Array.isArray(record.discarded)) record.discarded = [];
    else record.discarded = normalizeDiscardList(record.discarded);
    record.metadata = normalizeExistingMetadata(record.metadata);
  }
  return store.jobs[jobId];
}

function sanitizeMetadataInput(metadata) {
  const source = metadata ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('metadata must be an object');
  }
  const normalized = {};
  for (const field of METADATA_FIELDS) {
    const rawValue = source[field];
    const value =
      field === 'compensation'
        ? normalizeCompensationValue(rawValue)
        : sanitizeString(rawValue);
    if (value) normalized[field] = value;
  }
  const explicitSynced = source.syncedAt ?? source.synced_at;
  if (explicitSynced !== undefined) {
    normalized.synced_at = normalizeSyncedAt(explicitSynced);
  }
  if (!normalized.synced_at) {
    normalized.synced_at = new Date().toISOString();
  }
  return normalized;
}

function cloneRecord(record) {
  const clonedDiscards = cloneDiscardList(record.discarded);
  const summary = getLastDiscardSummary(clonedDiscards);
  const cloned = {
    tags: Array.isArray(record.tags) ? record.tags.slice() : [],
    discarded: clonedDiscards,
    metadata: record.metadata ? { ...record.metadata } : {},
  };
  cloned.discard_count = cloned.discarded.length;
  if (summary) cloned.last_discard = summary;
  return cloned;
}

function normalizeFilterTags(tags) {
  if (!tags) return undefined;
  const list = Array.isArray(tags) ? tags : [tags];
  const normalized = [];
  const seen = new Set();
  for (const tag of list) {
    const value = sanitizeString(tag);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFilters(filters = {}) {
  const normalized = {};
  for (const field of METADATA_FIELDS) {
    const value = sanitizeString(filters[field]);
    if (!value) continue;
    if (field === 'compensation') {
      const normalizedComp = normalizeCompensationValue(value);
      if (normalizedComp) {
        normalized[field] = normalizedComp.toLowerCase();
        continue;
      }
    }
    normalized[field] = value.toLowerCase();
  }
  const tags = normalizeFilterTags(filters.tags);
  if (tags) normalized.tags = tags;
  return normalized;
}

function matchesFilters(record, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  const metadata = record.metadata || {};
  for (const [field, filterValue] of Object.entries(filters)) {
    if (field === 'tags') continue;
    const candidate = sanitizeString(metadata[field]);
    if (!candidate || candidate.toLowerCase() !== filterValue) {
      return false;
    }
  }

  if (filters.tags && filters.tags.length > 0) {
    const recordTags = Array.isArray(record.tags) ? record.tags : [];
    if (recordTags.length === 0) return false;
    const tagSet = new Set();
    for (const tag of recordTags) {
      const value = sanitizeString(tag);
      if (value) tagSet.add(value.toLowerCase());
    }
    if (tagSet.size === 0) return false;
    for (const required of filters.tags) {
      if (!tagSet.has(required)) return false;
    }
  }

  return true;
}

let writeLock = Promise.resolve();

export function addJobTags(jobId, tags) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    return Promise.reject(new Error('job id is required'));
  }
  const normalizedTags = [];
  const newKeys = new Set();
  for (const tag of tags) {
    const clean = normalizeTag(tag);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (newKeys.has(key)) continue;
    newKeys.add(key);
    normalizedTags.push({ value: clean, key });
  }
  if (normalizedTags.length === 0) {
    return Promise.reject(new Error('at least one tag is required'));
  }

  const jobKey = jobId.trim();
  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const store = await readShortlistFile(file);
    const record = ensureJobRecord(store, jobKey);
    const existing = new Set(
      record.tags
        .map(tag => (typeof tag === 'string' ? tag.toLowerCase() : ''))
        .filter(Boolean),
    );
    for (const { value, key } of normalizedTags) {
      if (existing.has(key)) continue;
      existing.add(key);
      record.tags.push(value);
    }
    await writeJsonFile(file, store);
    return record.tags.slice();
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export function discardJob(jobId, reason, options = {}) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    return Promise.reject(new Error('job id is required'));
  }
  const normalizedReason = reason == null ? '' : String(reason).trim();
  if (!normalizedReason) {
    return Promise.reject(new Error('reason is required'));
  }

  const { tags, date } = options;

  const jobKey = jobId.trim();
  const { dir, file } = getPaths();

  const run = async () => {
    const archiveEntry = await recordJobDiscard(jobKey, {
      reason: normalizedReason,
      tags,
      date,
    });

    await fs.mkdir(dir, { recursive: true });
    const store = await readShortlistFile(file);
    const record = ensureJobRecord(store, jobKey);
    record.discarded.push({ ...archiveEntry });
    await writeJsonFile(file, store);
    return { ...archiveEntry };
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export async function getShortlist(jobId) {
  const { file } = getPaths();
  const store = await readShortlistFile(file);
  if (jobId === undefined) {
    const snapshot = { jobs: {} };
    for (const [id, record] of Object.entries(store.jobs)) {
      snapshot.jobs[id] = cloneRecord(record);
    }
    return snapshot;
  }
  const record = store.jobs[jobId];
  if (!record) {
    return { tags: [], discarded: [], metadata: {} };
  }
  return cloneRecord(record);
}

export function syncShortlistJob(jobId, metadata) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    return Promise.reject(new Error('job id is required'));
  }

  let normalizedMetadata;
  try {
    normalizedMetadata = sanitizeMetadataInput(metadata);
  } catch (err) {
    return Promise.reject(err);
  }

  const jobKey = jobId.trim();
  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const store = await readShortlistFile(file);
    const record = ensureJobRecord(store, jobKey);
    record.metadata = { ...record.metadata, ...normalizedMetadata };
    await writeJsonFile(file, store);
    return { ...record.metadata };
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export async function filterShortlist(filters) {
  const normalizedFilters = normalizeFilters(filters);
  const { file } = getPaths();
  const store = await readShortlistFile(file);
  if (Object.keys(normalizedFilters).length === 0) {
    const snapshot = { jobs: {} };
    for (const [id, record] of Object.entries(store.jobs)) {
      snapshot.jobs[id] = cloneRecord(record);
    }
    return snapshot;
  }

  const result = { jobs: {} };
  for (const [jobId, record] of Object.entries(store.jobs)) {
    if (matchesFilters(record, normalizedFilters)) {
      result.jobs[jobId] = cloneRecord(record);
    }
  }
  return result;
}
