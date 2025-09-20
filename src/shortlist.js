import fs from 'node:fs/promises';
import path from 'node:path';

import { recordJobDiscard } from './discards.js';

let overrideDir;

const METADATA_FIELDS = ['location', 'level', 'compensation'];

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
    const value = sanitizeString(metadata[field]);
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
          discarded: Array.isArray(rawRecord.discarded)
            ? rawRecord.discarded.map(entry => ({ ...entry }))
            : [],
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

function ensureJobRecord(store, jobId) {
  const existing = store.jobs[jobId];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    store.jobs[jobId] = { tags: [], discarded: [], metadata: {} };
  } else {
    const record = existing;
    if (!Array.isArray(record.tags)) record.tags = [];
    if (!Array.isArray(record.discarded)) record.discarded = [];
    record.metadata = normalizeExistingMetadata(record.metadata);
  }
  return store.jobs[jobId];
}

function sanitizeMetadataInput(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('metadata is required');
  }
  const normalized = {};
  for (const field of METADATA_FIELDS) {
    const value = sanitizeString(metadata[field]);
    if (value) normalized[field] = value;
  }
  const explicitSynced = metadata.syncedAt ?? metadata.synced_at;
  if (explicitSynced !== undefined) {
    normalized.synced_at = normalizeSyncedAt(explicitSynced);
  }
  if (Object.keys(normalized).length === 0) {
    throw new Error('at least one metadata field is required');
  }
  if (!normalized.synced_at) {
    normalized.synced_at = new Date().toISOString();
  }
  return normalized;
}

function cloneRecord(record) {
  return {
    tags: Array.isArray(record.tags) ? record.tags.slice() : [],
    discarded: Array.isArray(record.discarded)
      ? record.discarded.map(entry => ({ ...entry }))
      : [],
    metadata: record.metadata ? { ...record.metadata } : {},
  };
}

function normalizeFilters(filters = {}) {
  const normalized = {};
  for (const field of METADATA_FIELDS) {
    const value = sanitizeString(filters[field]);
    if (value) normalized[field] = value.toLowerCase();
  }
  return normalized;
}

function matchesFilters(record, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  const metadata = record.metadata || {};
  for (const [field, filterValue] of Object.entries(filters)) {
    const candidate = sanitizeString(metadata[field]);
    if (!candidate || candidate.toLowerCase() !== filterValue) {
      return false;
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
  for (const tag of tags) {
    const clean = normalizeTag(tag);
    if (clean) normalizedTags.push(clean);
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
    for (const tag of normalizedTags) {
      if (!record.tags.includes(tag)) {
        record.tags.push(tag);
      }
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
