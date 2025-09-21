import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setIntakeDataDir(dir) {
  overrideDir = dir || undefined;
}

function getPaths() {
  const baseDir = resolveDataDir();
  const profileDir = path.join(baseDir, 'profile');
  return { profileDir, file: path.join(profileDir, 'intake.json') };
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : undefined;
}

function requireString(value, label) {
  const sanitized = sanitizeString(value);
  if (!sanitized) {
    throw new Error(`${label} is required`);
  }
  return sanitized;
}

function normalizeTimestamp(input, label) {
  if (input == null) return undefined;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid ${label} timestamp: ${input}`);
  }
  return date.toISOString();
}

function normalizeTags(input) {
  if (!input) return undefined;
  const list = Array.isArray(input)
    ? input
    : String(input)
        .split(',')
        .map(entry => entry.trim());
  const normalized = [];
  const seen = new Set();
  for (const item of list) {
    const value = sanitizeString(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : undefined;
}

async function readIntakeFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const responses = Array.isArray(parsed.responses) ? parsed.responses : [];
      return responses
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => ({
          id: typeof entry.id === 'string' ? entry.id : randomUUID(),
          question: typeof entry.question === 'string' ? entry.question : '',
          answer: typeof entry.answer === 'string' ? entry.answer : '',
          asked_at: typeof entry.asked_at === 'string' ? entry.asked_at : undefined,
          recorded_at: typeof entry.recorded_at === 'string' ? entry.recorded_at : undefined,
          tags: Array.isArray(entry.tags)
            ? entry.tags.filter(tag => typeof tag === 'string')
            : undefined,
          notes: typeof entry.notes === 'string' ? entry.notes : undefined,
        }))
        .filter(entry => entry.question && entry.answer);
    }
    return [];
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeIntakeFile(file, responses) {
  const payload = {
    responses: responses.map(entry => ({
      ...entry,
      tags: entry.tags ? entry.tags.slice() : undefined,
    })),
  };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

let writeLock = Promise.resolve();

export function recordIntakeResponse(data = {}) {
  let question;
  let answer;
  try {
    question = requireString(data.question, 'question');
    answer = requireString(data.answer, 'answer');
  } catch (err) {
    return Promise.reject(err);
  }

  let askedAt;
  try {
    askedAt = normalizeTimestamp(data.askedAt ?? data.asked_at, 'asked');
  } catch (err) {
    return Promise.reject(err);
  }

  const tags = normalizeTags(data.tags);
  const notes = sanitizeString(data.notes);
  const recordedAt = new Date().toISOString();
  const effectiveAskedAt = askedAt || recordedAt;
  const entry = {
    id: randomUUID(),
    question,
    answer,
    asked_at: effectiveAskedAt,
    recorded_at: recordedAt,
  };
  if (tags) entry.tags = tags;
  if (notes) entry.notes = notes;

  const { profileDir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(profileDir, { recursive: true });
    const existing = await readIntakeFile(file);
    existing.push(entry);
    await writeIntakeFile(file, existing);
    return {
      ...entry,
      tags: entry.tags ? entry.tags.slice() : undefined,
      notes: entry.notes,
    };
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export async function getIntakeResponses() {
  const { file } = getPaths();
  const responses = await readIntakeFile(file);
  return responses.map(entry => ({
    ...entry,
    tags: entry.tags ? entry.tags.slice() : undefined,
    notes: entry.notes,
  }));
}
