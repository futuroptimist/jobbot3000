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
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

// Serialize writes to avoid clobbering entries when recordApplication is invoked concurrently.
let writeLock = Promise.resolve();

/**
 * Record an application's status. Throws if the lifecycle file cannot be read or contains
 * invalid JSON.
 */
function normalizeEntry(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.status === 'string') return { ...value };
    return { status: undefined, ...value };
  }
  if (typeof value === 'string') return { status: value };
  return {};
}

function normalizeLifecycle(data) {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(
    Object.entries(data).map(([id, value]) => [id, normalizeEntry(value)]),
  );
}

function sanitizeMetadata(metadata = {}) {
  const result = {};
  if (metadata.channel) result.channel = String(metadata.channel);
  if (metadata.date) result.date = String(metadata.date);
  if (metadata.contact) result.contact = String(metadata.contact);
  if (metadata.notes) result.notes = String(metadata.notes);
  if (metadata.documents !== undefined) {
    const docs = Array.isArray(metadata.documents)
      ? metadata.documents
      : [metadata.documents];
    const filtered = docs.map(doc => String(doc)).filter(Boolean);
    if (filtered.length) result.documents = filtered;
  }
  return result;
}

export function recordApplication(id, status, metadata) {
  if (!STATUSES.includes(status)) {
    return Promise.reject(new Error(`unknown status: ${status}`));
  }
  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const existing = normalizeLifecycle(await readLifecycleFile(file));
    const payload = {
      status,
      ...sanitizeMetadata(metadata),
      updated_at: new Date().toISOString(),
    };
    existing[id] = payload;
    await writeJsonFile(file, existing);
    return payload;
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
  const data = normalizeLifecycle(await readLifecycleFile(file));
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const entry of Object.values(data)) {
    const status = entry && entry.status;
    if (counts[status] !== undefined) counts[status] += 1;
  }
  return counts;
}
