import fs from 'node:fs/promises';
import path from 'node:path';

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function getDiscardFilePath() {
  const dir = resolveDataDir();
  return { dir, file: path.join(dir, 'discarded_jobs.json') };
}

function sanitizeString(value) {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.trim();
}

function normalizeJobId(jobId) {
  const value = sanitizeString(jobId);
  if (!value) {
    throw new Error('job id is required');
  }
  return value;
}

function normalizeReason(reason) {
  const value = sanitizeString(reason);
  if (!value) throw new Error('reason is required');
  return value;
}

function normalizeTimestamp(input) {
  const candidate = input ? new Date(input) : new Date();
  if (Number.isNaN(candidate.getTime())) {
    throw new Error(`invalid date: ${input}`);
  }
  return candidate.toISOString();
}

function normalizeTags(tags) {
  if (!tags) return undefined;
  const list = Array.isArray(tags)
    ? tags
    : String(tags)
        .split(',')
        .map(entry => entry.trim());
  const normalized = [];
  const seen = new Set();
  for (const item of list) {
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function toIsoTimestamp(value) {
  if (value == null) return 'unknown time';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown time';
  }
  return date.toISOString();
}

function normalizeTagList(tags) {
  if (!Array.isArray(tags)) return undefined;
  const normalized = [];
  const seen = new Set();
  for (const tag of tags) {
    const value = sanitizeString(tag);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDiscardEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const normalized = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const rawReason = sanitizeString(entry.reason);
    const reason = rawReason || 'Unknown reason';
    const sourceTimestamp = entry.discarded_at ?? entry.discardedAt;
    const discardedAt = toIsoTimestamp(sourceTimestamp);
    const normalizedTimestamp =
      typeof discardedAt === 'string' && discardedAt.toLowerCase() === 'unknown time'
        ? '(unknown time)'
        : discardedAt;
    const tags = normalizeTagList(entry.tags);
    const payload = { reason, discarded_at: normalizedTimestamp };
    if (tags) payload.tags = tags.slice();
    normalized.push(payload);
  }
  normalized.sort((a, b) => {
    const aTime = Date.parse(a.discarded_at);
    const bTime = Date.parse(b.discarded_at);
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    if (aTime === bTime) return 0;
    return aTime > bTime ? -1 : 1;
  });
  return normalized;
}

function normalizeDiscardArchive(data) {
  if (!data || typeof data !== 'object') return {};
  const normalized = {};
  const jobIds = Object.keys(data).sort((a, b) => a.localeCompare(b));
  for (const jobId of jobIds) {
    normalized[jobId] = normalizeDiscardEntries(data[jobId]);
  }
  return normalized;
}

async function readDiscardFile(file) {
  try {
    const contents = await fs.readFile(file, 'utf8');
    const data = JSON.parse(contents);
    if (data && typeof data === 'object') {
      return data;
    }
    return {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeJsonFile(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

let writeLock = Promise.resolve();

export function recordJobDiscard(jobId, { reason, date, tags } = {}) {
  let normalizedId;
  let normalizedReason;
  try {
    normalizedId = normalizeJobId(jobId);
    normalizedReason = normalizeReason(reason);
  } catch (err) {
    return Promise.reject(err);
  }

  let timestamp;
  try {
    timestamp = normalizeTimestamp(date);
  } catch (err) {
    return Promise.reject(err);
  }

  const normalizedTags = normalizeTags(tags);
  const { dir, file } = getDiscardFilePath();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const data = await readDiscardFile(file);
    const history = Array.isArray(data[normalizedId]) ? data[normalizedId] : [];
    const entry = { reason: normalizedReason, discarded_at: timestamp };
    if (normalizedTags) entry.tags = normalizedTags;
    history.push(entry);
    data[normalizedId] = history;
    await writeJsonFile(file, data);
    return entry;
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export async function getDiscardedJobs(jobId) {
  const { file } = getDiscardFilePath();
  const data = await readDiscardFile(file);
  if (jobId === undefined) {
    return normalizeDiscardArchive(data);
  }
  const history = Array.isArray(data[jobId]) ? data[jobId] : [];
  return normalizeDiscardEntries(history);
}

export { normalizeDiscardEntries, normalizeDiscardArchive };
