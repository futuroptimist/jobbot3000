import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Valid application status values.
 * `next_round` remains as a legacy alias for older logs.
 */
export const STATUSES = [
  'no_response',
  'screening',
  'onsite',
  'offer',
  'rejected',
  'withdrawn',
  'next_round',
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
