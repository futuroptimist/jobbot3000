import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    normalized[key] = String(value);
  }
  return normalized;
}

function toIsoTimestamp(timestamp) {
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === 'number' || typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Derive a stable job identifier from the provided source descriptor.
 * Hashing keeps identifiers filesystem-safe while letting callers deduplicate entries.
 *
 * @param {string} source
 * @returns {string}
 */
export function jobIdFromSource(source) {
  const input = typeof source === 'string' ? source : JSON.stringify(source ?? '');
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Persist the raw and parsed representation of a job posting alongside fetch metadata.
 *
 * @param {object} params
 * @param {string} params.id Stable job identifier used as the filename.
 * @param {string} params.raw Raw job content as fetched.
 * @param {any} params.parsed Parsed job payload.
 * @param {{ type?: string, value: string }} params.source Descriptor of where the job originated.
 * @param {Record<string, any>} [params.requestHeaders] Headers used during the fetch, if any.
 * @param {Date | string | number} [params.fetchedAt] Timestamp for when the snapshot was captured.
 * @returns {Promise<string>} Absolute path to the written snapshot file.
 */
export async function saveJobSnapshot({
  id,
  raw,
  parsed,
  source,
  requestHeaders,
  fetchedAt,
}) {
  if (!id || typeof id !== 'string') {
    throw new Error('job id is required');
  }
  if (!source || typeof source.value !== 'string') {
    throw new Error('source value is required');
  }

  const jobsDir = path.join(resolveDataDir(), 'jobs');
  await fs.mkdir(jobsDir, { recursive: true });

  const payload = {
    id,
    fetched_at: toIsoTimestamp(fetchedAt),
    raw: raw == null ? '' : String(raw),
    parsed: parsed ?? null,
    source: {
      type: source.type || 'unknown',
      value: source.value,
      headers: normalizeHeaders(requestHeaders),
    },
  };

  const file = path.join(jobsDir, `${id}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2));
  return file;
}
