import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let overrideDir;
// Keep this pattern aligned with src/shared/logging/sanitize-output.js.
// eslint-disable-next-line no-control-regex -- intentionally strip ASCII control characters.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setFeedbackDataDir(dir) {
  overrideDir = dir || undefined;
}

function getFilePath() {
  return path.join(resolveDataDir(), 'feedback.json');
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  const withoutControl = str.replace(CONTROL_CHARS_RE, ' ');
  const collapsed = withoutControl.replace(/\s+/g, ' ').trim();
  return collapsed ? collapsed : undefined;
}

async function readFeedbackFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => ({
        id: typeof entry.id === 'string' ? entry.id : randomUUID(),
        message: typeof entry.message === 'string' ? entry.message : '',
        source: typeof entry.source === 'string' ? entry.source : undefined,
        contact: typeof entry.contact === 'string' ? entry.contact : undefined,
        rating: typeof entry.rating === 'number' ? entry.rating : undefined,
        recorded_at:
          typeof entry.recorded_at === 'string' ? entry.recorded_at : new Date().toISOString(),
      }))
      .filter(entry => entry.message.trim());
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeFeedbackFile(file, entries) {
  const payload = { entries };
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

export async function listFeedback() {
  const file = getFilePath();
  return readFeedbackFile(file);
}

function normalizeRating(value) {
  if (value == null) return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new Error('rating must be a number');
  }
  const integer = Math.trunc(number);
  if (integer < 1 || integer > 5) {
    throw new Error('rating must be between 1 and 5');
  }
  return integer;
}

export async function recordFeedback(input = {}) {
  const message = sanitizeString(input.message);
  if (!message) {
    throw new Error('message is required');
  }

  const source = sanitizeString(input.source);
  const contact = sanitizeString(input.contact);
  const rating = normalizeRating(input.rating);

  const file = getFilePath();
  const entries = await readFeedbackFile(file);
  const entry = {
    id: randomUUID(),
    message,
    source,
    contact,
    rating,
    recorded_at: new Date().toISOString(),
  };
  entries.push(entry);
  await writeFeedbackFile(file, entries);
  return entry;
}
