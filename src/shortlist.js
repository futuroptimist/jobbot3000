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
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return { discards: {} };
    }
    if (!data.discards || typeof data.discards !== 'object') {
      data.discards = {};
    }
    return data;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { discards: {} };
    }
    throw err;
  }
}

async function writeJsonFile(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

function toIsoTimestamp(input) {
  if (input instanceof Date) return input.toISOString();
  if (typeof input === 'string' || typeof input === 'number') {
    const date = new Date(input);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function normalizeReason(reason) {
  if (reason == null) return '';
  return String(reason).trim();
}

export async function discardJob(jobId, reason, { discardedAt } = {}) {
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('job id is required');
  }
  const normalizedReason = normalizeReason(reason);
  if (!normalizedReason) {
    throw new Error('reason is required');
  }

  const entry = {
    jobId,
    reason: normalizedReason,
    discardedAt: toIsoTimestamp(discardedAt),
  };

  const { dir, file } = getPaths();
  await fs.mkdir(dir, { recursive: true });
  const data = await readShortlistFile(file);
  const history = Array.isArray(data.discards[jobId]) ? data.discards[jobId] : [];
  const updatedHistory = [...history, entry];
  data.discards[jobId] = updatedHistory;
  await writeJsonFile(file, data);
  return entry;
}

export async function getDiscardedJobs(jobId) {
  const { file } = getPaths();
  const data = await readShortlistFile(file);
  if (jobId === undefined) {
    return data.discards;
  }
  const history = data.discards[jobId];
  return Array.isArray(history) ? history : [];
}
