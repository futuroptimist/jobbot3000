import fs from 'node:fs/promises';
import path from 'node:path';

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function getDiscardFilePath() {
  const dir = resolveDataDir();
  return { dir, file: path.join(dir, 'discarded_jobs.json') };
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

function normalizeJobId(jobId) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    throw new Error('job id is required');
  }
  return jobId.trim();
}

function normalizeReason(reason) {
  const value = typeof reason === 'string' ? reason.trim() : '';
  if (!value) throw new Error('reason is required');
  return value;
}

function normalizeTimestamp(input) {
  const value = input ? new Date(input) : new Date();
  if (Number.isNaN(value.getTime())) {
    throw new Error(`invalid date: ${input}`);
  }
  return value.toISOString();
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
  if (jobId === undefined) return data;
  const history = data[jobId];
  return Array.isArray(history) ? history : [];
}
