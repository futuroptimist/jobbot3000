import fs from 'node:fs/promises';
import path from 'node:path';

/** Valid application status values. */
export const STATUSES = ['no_response', 'rejected', 'next_round'];

function getPaths() {
  const dir = process.env.JOBBOT_DATA_DIR || path.resolve('data');
  return { dir, file: path.join(dir, 'applications.json') };
}

/**
 * Read a JSON file. Returns an empty object when the file is missing and rethrows
 * other errors.
 * @param {string} file
 * @returns {Promise<object>}
 */
async function readJsonFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

// Serialize writes to avoid clobbering entries when recordApplication is invoked concurrently.
let writeLock = Promise.resolve();

/**
 * Record an application's status. Throws if the lifecycle file cannot be read or contains
 * invalid JSON.
 */
export function recordApplication(id, status) {
  if (!STATUSES.includes(status)) {
    return Promise.reject(new Error(`unknown status: ${status}`));
  }
  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const data = await readJsonFile(file);
    data[id] = status;
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
    return data[id];
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
  const data = await readJsonFile(file);
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const s of Object.values(data)) {
    if (counts[s] !== undefined) counts[s] += 1;
  }
  return counts;
}
