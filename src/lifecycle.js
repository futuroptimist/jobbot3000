import fs from 'node:fs/promises';
import path from 'node:path';

export const STATUSES = ['no_response', 'rejected', 'next_round'];

function paths() {
  const dir = process.env.JOBBOT_DATA_DIR || path.resolve('data');
  return { dir, file: path.join(dir, 'applications.json') };
}

export async function recordApplication(id, status) {
  if (!STATUSES.includes(status)) {
    throw new Error(`unknown status: ${status}`);
  }
  const { dir, file } = paths();
  await fs.mkdir(dir, { recursive: true });
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    /* ignore missing file */
  }
  data[id] = status;
  await fs.writeFile(file, JSON.stringify(data, null, 2));
  return data[id];
}

export async function getLifecycleCounts() {
  const { file } = paths();
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    /* ignore missing file */
  }
  const counts = {};
  for (const s of STATUSES) counts[s] = 0;
  for (const s of Object.values(data)) {
    if (counts[s] !== undefined) counts[s] += 1;
  }
  return counts;
}
