import fs from 'node:fs/promises';
import path from 'node:path';

let overrideDir;

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

async function readShortlistFile(file) {
  try {
    const contents = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { jobs: {} };
    }
    if (!parsed.jobs || typeof parsed.jobs !== 'object' || Array.isArray(parsed.jobs)) {
      return { jobs: {} };
    }
    return { jobs: { ...parsed.jobs } };
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
  if (tag == null) return undefined;
  const trimmed = String(tag).trim();
  return trimmed ? trimmed : undefined;
}

function ensureJobRecord(store, jobId) {
  if (!store.jobs[jobId] || typeof store.jobs[jobId] !== 'object') {
    store.jobs[jobId] = { tags: [], discarded: [] };
  } else {
    const record = store.jobs[jobId];
    if (!Array.isArray(record.tags)) record.tags = [];
    if (!Array.isArray(record.discarded)) record.discarded = [];
  }
  return store.jobs[jobId];
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

export function discardJob(jobId, reason) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    return Promise.reject(new Error('job id is required'));
  }
  const normalizedReason = reason == null ? '' : String(reason).trim();
  if (!normalizedReason) {
    return Promise.reject(new Error('reason is required'));
  }

  const jobKey = jobId.trim();
  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const store = await readShortlistFile(file);
    const record = ensureJobRecord(store, jobKey);
    const entry = {
      reason: normalizedReason,
      discarded_at: new Date().toISOString(),
    };
    record.discarded.push(entry);
    await writeJsonFile(file, store);
    return entry;
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export async function getShortlist(jobId) {
  const { file } = getPaths();
  const store = await readShortlistFile(file);
  if (jobId === undefined) {
    return store;
  }
  const record = store.jobs[jobId];
  if (!record) {
    return { tags: [], discarded: [] };
  }
  const tags = Array.isArray(record.tags) ? record.tags.slice() : [];
  const discarded = Array.isArray(record.discarded) ? record.discarded.slice() : [];
  return { tags, discarded };
}
