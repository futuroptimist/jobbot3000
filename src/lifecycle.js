import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Valid application status values.
 * `next_round` remains as a legacy alias for older logs.
 * Acceptance synonyms (`accepted`, `acceptance`, `hired`) feed analytics rollups.
 */
export const STATUSES = [
  'no_response',
  'screening',
  'onsite',
  'offer',
  'rejected',
  'withdrawn',
  'next_round',
  'accepted',
  'acceptance',
  'hired',
];

function getPaths() {
  const dir = process.env.JOBBOT_DATA_DIR || path.resolve('data');
  return { dir, file: path.join(dir, 'applications.json') };
}

/**
 * Read lifecycle JSON from disk, returning an empty object when the file is missing.
 *
 * @param {string} file
 * @returns {Promise<object>}
 */
async function readLifecycleFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Atomically write `data` as pretty JSON to `file`.
 *
 * @param {string} file
 * @param {object} data
 * @returns {Promise<void>}
 */
async function writeJsonFile(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

// Serialize writes to avoid clobbering entries when recordApplication is invoked concurrently.
let writeLock = Promise.resolve();

function normalizeNote(note) {
  if (note === undefined) return undefined;
  const value = typeof note === 'string' ? note : String(note);
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('note cannot be empty');
  }
  return trimmed;
}

function normalizeTimestamp(input) {
  const source = input ?? undefined;
  const date = source instanceof Date ? source : source ? new Date(source) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid status timestamp: ${input}`);
  }
  return date.toISOString();
}

function extractStatus(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const value = entry.status;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function normalizeLifecycleEntry(jobId, entry) {
  if (!jobId) return null;
  const status = extractStatus(entry);
  if (typeof status !== 'string') return null;
  const normalizedStatus = status.trim();
  if (!STATUSES.includes(normalizedStatus)) return null;

  let updatedAt;
  if (entry && typeof entry === 'object') {
    const rawUpdated = entry.updated_at ?? entry.updatedAt;
    if (typeof rawUpdated === 'string' && rawUpdated.trim()) {
      const parsed = new Date(rawUpdated);
      if (!Number.isNaN(parsed.getTime())) {
        updatedAt = parsed.toISOString();
      }
    }
  }

  let note;
  if (entry && typeof entry === 'object' && typeof entry.note === 'string') {
    const trimmed = entry.note.trim();
    if (trimmed) note = trimmed;
  }

  return {
    job_id: jobId,
    status: normalizedStatus,
    updated_at: updatedAt,
    note,
  };
}

/**
 * Record an application's status. Throws if the lifecycle file cannot be read or contains
 * invalid JSON.
 */
export function recordApplication(id, status, options = {}) {
  if (!STATUSES.includes(status)) {
    return Promise.reject(new Error(`unknown status: ${status}`));
  }

  let note;
  try {
    note = normalizeNote(options.note ?? options.notes);
  } catch (err) {
    return Promise.reject(err);
  }

  let updatedAt;
  try {
    updatedAt = normalizeTimestamp(options.date ?? options.updatedAt ?? options.updated_at);
  } catch (err) {
    return Promise.reject(err);
  }

  const entry = { status, updated_at: updatedAt };
  if (note) entry.note = note;

  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const data = await readLifecycleFile(file);
    data[id] = entry;
    await writeJsonFile(file, data);
    return status;
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

/**
 * Return counts of application statuses. Throws if the lifecycle file cannot be read or contains
 * invalid JSON.
 */
export async function getLifecycleCounts() {
  const { file } = getPaths();
  const data = await readLifecycleFile(file);
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const value of Object.values(data)) {
    const status = extractStatus(value);
    if (status && counts[status] !== undefined) {
      counts[status] += 1;
    }
  }
  return counts;
}

function compareLifecycleEntries(a, b) {
  if (!a || !b) return 0;
  const aTime = a.updated_at ? Date.parse(a.updated_at) : NaN;
  const bTime = b.updated_at ? Date.parse(b.updated_at) : NaN;
  const aValid = !Number.isNaN(aTime);
  const bValid = !Number.isNaN(bTime);
  if (aValid && bValid) {
    if (aTime === bTime) return a.job_id.localeCompare(b.job_id);
    return bTime - aTime;
  }
  if (aValid) return -1;
  if (bValid) return 1;
  return a.job_id.localeCompare(b.job_id);
}

function sortBoardJobs(jobs) {
  jobs.sort(compareLifecycleEntries);
}

/**
 * Group lifecycle entries by status in the defined STATUSES order.
 * Returns an array of columns so callers can render a Kanban-style board.
 */
export async function getLifecycleBoard() {
  const { file } = getPaths();
  const data = await readLifecycleFile(file);
  const columns = STATUSES.map(status => ({ status, jobs: [] }));
  const columnByStatus = new Map(columns.map(column => [column.status, column]));

  for (const [jobId, raw] of Object.entries(data)) {
    const normalized = normalizeLifecycleEntry(jobId, raw);
    if (!normalized) continue;
    const column = columnByStatus.get(normalized.status);
    if (!column) continue;
    column.jobs.push(normalized);
  }

  for (const column of columns) {
    sortBoardJobs(column.jobs);
  }

  return columns;
}

function normalizeLifecycleJobId(jobId) {
  if (typeof jobId !== 'string') return '';
  return jobId.trim();
}

export async function getLifecycleEntry(jobId) {
  const normalizedId = normalizeLifecycleJobId(jobId);
  if (!normalizedId) {
    throw new Error('job id is required');
  }

  const { file } = getPaths();
  const data = await readLifecycleFile(file);
  const raw = data[normalizedId];
  if (!raw) return null;
  const normalized = normalizeLifecycleEntry(normalizedId, raw);
  return normalized ?? null;
}

function normalizeStatusesFilter(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return { values: [], set: null };
  }

  const normalized = [];
  const seen = new Set();
  for (const candidate of statuses) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed) || !STATUSES.includes(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  if (normalized.length === 0) {
    return { values: [], set: null };
  }

  return { values: normalized, set: new Set(normalized) };
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const truncated = Math.trunc(parsed);
  if (truncated <= 0) return fallback;
  return truncated;
}

function normalizePageSize(value) {
  const normalized = normalizePositiveInteger(value, 20);
  return Math.min(normalized, 100);
}

export async function listLifecycleEntries(options = {}) {
  const { values: statuses, set: statusSet } = normalizeStatusesFilter(options.statuses);
  const pageSize = normalizePageSize(options.pageSize);
  const { file } = getPaths();
  const data = await readLifecycleFile(file);
  const entries = [];

  for (const [jobId, raw] of Object.entries(data)) {
    const normalized = normalizeLifecycleEntry(jobId, raw);
    if (!normalized) continue;
    if (statusSet && !statusSet.has(normalized.status)) continue;
    entries.push(normalized);
  }

  entries.sort(compareLifecycleEntries);

  const totalEntries = entries.length;
  const totalPages = totalEntries === 0 ? 0 : Math.ceil(totalEntries / pageSize);
  let page = normalizePositiveInteger(options.page, 1);
  if (totalPages > 0) {
    page = Math.min(Math.max(page, 1), totalPages);
  } else {
    page = 1;
  }

  const start = (page - 1) * pageSize;
  const paginated = entries.slice(start, start + pageSize);

  return {
    entries: paginated,
    pagination: {
      page,
      pageSize,
      totalEntries,
      totalPages,
    },
    filters: {
      statuses,
    },
  };
}
