import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let overrideDir;

const REDACTED_PLACEHOLDER = '[redacted]';
const DRAFT_FILE = 'intake-draft.json';
const SENSITIVE_TAGS = new Set([
  'compensation',
  'salary',
  'pay',
  'band',
  'visa',
  'sponsorship',
  'work authorization',
  'work_authorization',
  'work permit',
]);
const SENSITIVE_KEYWORDS = [
  'compensation',
  'salary',
  'pay range',
  'pay band',
  'visa',
  'sponsor',
  'work authorization',
  'work permit',
];

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

function getDraftPaths() {
  const baseDir = resolveDataDir();
  const profileDir = path.join(baseDir, 'profile');
  return { profileDir, file: path.join(profileDir, DRAFT_FILE) };
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
        .map(entry => {
          const statusRaw =
            typeof entry.status === 'string' ? entry.status.trim().toLowerCase() : '';
          const status = statusRaw === 'skipped' ? 'skipped' : 'answered';
          const base = {
            id: typeof entry.id === 'string' ? entry.id : randomUUID(),
            question: typeof entry.question === 'string' ? entry.question : '',
            answer: typeof entry.answer === 'string' ? entry.answer : '',
            asked_at: typeof entry.asked_at === 'string' ? entry.asked_at : undefined,
            recorded_at: typeof entry.recorded_at === 'string' ? entry.recorded_at : undefined,
            tags: Array.isArray(entry.tags)
              ? entry.tags.filter(tag => typeof tag === 'string')
              : undefined,
            notes: typeof entry.notes === 'string' ? entry.notes : undefined,
            status,
          };
          return base;
        })
        .filter(entry => entry.question && (entry.status === 'skipped' || entry.answer));
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

async function readDraftFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.draft) {
      const draft = parsed.draft;
      const question = sanitizeString(draft.question);
      if (!question) return null;
      const entry = {
        id: typeof draft.id === 'string' ? draft.id : randomUUID(),
        question,
        status: 'draft',
      };
      if (typeof draft.answer === 'string' && draft.answer.trim()) {
        entry.answer = draft.answer.trim();
      }
      if (Array.isArray(draft.tags)) {
        entry.tags = draft.tags.filter(tag => typeof tag === 'string');
      }
      if (typeof draft.notes === 'string' && draft.notes.trim()) {
        entry.notes = draft.notes.trim();
      }
      if (typeof draft.asked_at === 'string' && draft.asked_at.trim()) {
        entry.asked_at = draft.asked_at.trim();
      }
      if (typeof draft.saved_at === 'string' && draft.saved_at.trim()) {
        entry.saved_at = draft.saved_at.trim();
      }
      return entry;
    }
    return null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeDraftFile(file, draft) {
  const payload = { draft };
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

let writeLock = Promise.resolve();
let draftLock = Promise.resolve();

export function recordIntakeResponse(data = {}) {
  let question;
  try {
    question = requireString(data.question, 'question');
  } catch (err) {
    return Promise.reject(err);
  }

  const skipped = Boolean(data.skipped);

  let answer = '';
  if (!skipped) {
    try {
      answer = requireString(data.answer, 'answer');
    } catch (err) {
      return Promise.reject(err);
    }
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
    status: skipped ? 'skipped' : 'answered',
  };
  if (tags) entry.tags = tags;
  if (notes) entry.notes = notes;

  const { profileDir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(profileDir, { recursive: true });
    const existing = await readIntakeFile(file);
    existing.push(entry);
    await writeIntakeFile(file, existing);
    await clearIntakeDraft();
    return {
      ...entry,
      tags: entry.tags ? entry.tags.slice() : undefined,
      notes: entry.notes,
    };
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export function saveIntakeDraft(data = {}) {
  let question;
  try {
    question = requireString(data.question, 'question');
  } catch (err) {
    return Promise.reject(err);
  }

  const draft = {
    id: randomUUID(),
    question,
    status: 'draft',
    saved_at: new Date().toISOString(),
  };

  const answer = sanitizeString(data.answer);
  if (answer) draft.answer = answer;

  const notes = sanitizeString(data.notes);
  if (notes) draft.notes = notes;

  const tags = normalizeTags(data.tags);
  if (tags) draft.tags = tags;

  try {
    const askedAt = normalizeTimestamp(data.askedAt ?? data.asked_at, 'asked');
    if (askedAt) draft.asked_at = askedAt;
  } catch (err) {
    return Promise.reject(err);
  }

  const { profileDir, file } = getDraftPaths();

  const run = async () => {
    await fs.mkdir(profileDir, { recursive: true });
    await writeDraftFile(file, draft);
    return {
      ...draft,
      tags: draft.tags ? draft.tags.slice() : undefined,
      notes: draft.notes,
    };
  };

  draftLock = draftLock.then(run, run);
  return draftLock;
}

export async function getIntakeDraft() {
  const { file } = getDraftPaths();
  const draft = await readDraftFile(file);
  if (!draft) return null;
  return {
    ...draft,
    tags: draft.tags ? draft.tags.slice() : undefined,
    notes: draft.notes,
  };
}

export function clearIntakeDraft() {
  const { file } = getDraftPaths();
  const run = async () => {
    try {
      await fs.unlink(file);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
  };

  draftLock = draftLock.then(run, run);
  return draftLock;
}

function normalizeStatusFilter(status) {
  if (!status) return undefined;
  const list = Array.isArray(status) ? status : [status];
  const allowed = new Set();
  for (const value of list) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().toLowerCase();
    if (trimmed) allowed.add(trimmed);
  }
  return allowed.size > 0 ? allowed : undefined;
}

function hasSensitiveTag(entry) {
  if (!Array.isArray(entry.tags) || entry.tags.length === 0) return false;
  for (const tag of entry.tags) {
    if (typeof tag !== 'string') continue;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    if (SENSITIVE_TAGS.has(normalized)) return true;
  }
  return false;
}

function hasSensitiveKeyword(entry) {
  const fields = [];
  if (typeof entry.question === 'string') fields.push(entry.question);
  if (typeof entry.answer === 'string') fields.push(entry.answer);
  if (typeof entry.notes === 'string') fields.push(entry.notes);
  for (const field of fields) {
    const value = field.toLowerCase();
    if (SENSITIVE_KEYWORDS.some(keyword => value.includes(keyword))) {
      return true;
    }
  }
  return false;
}

function redactEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const shouldRedact = hasSensitiveTag(entry) || hasSensitiveKeyword(entry);
  if (!shouldRedact) return entry;
  const clone = { ...entry, redacted: true };
  if (typeof clone.answer === 'string' && clone.answer) {
    clone.answer = REDACTED_PLACEHOLDER;
  }
  if (typeof clone.notes === 'string' && clone.notes) {
    clone.notes = REDACTED_PLACEHOLDER;
  }
  return clone;
}

export async function getIntakeResponses(options = {}) {
  const { file } = getPaths();
  const responses = await readIntakeFile(file);
  const normalized = responses.map(entry => ({
    ...entry,
    tags: entry.tags ? entry.tags.slice() : undefined,
    notes: entry.notes,
  }));

  const statusFilter = normalizeStatusFilter(options.status);
  const filtered = statusFilter
    ? normalized.filter(entry => statusFilter.has(entry.status))
    : normalized;

  if (options.redact) {
    return filtered.map(redactEntry);
  }

  return filtered;
}

function splitAnswerIntoFragments(answer) {
  if (typeof answer !== 'string') return [];
  const trimmed = answer.trim();
  if (!trimmed) return [];
  const segments = trimmed.split(/\r?\n/).map(part => part.trim()).filter(Boolean);
  if (segments.length <= 1) return [trimmed];
  const deduped = [];
  const seen = new Set();
  for (const segment of segments) {
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
  }
  return deduped;
}

function normalizeTagFilters(tags) {
  if (!tags) return undefined;
  const values = Array.isArray(tags) ? tags : [tags];
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const clean = sanitizeString(value);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized.length > 0 ? normalized : undefined;
}

export async function getIntakeBulletOptions(options = {}) {
  const responses = await getIntakeResponses();
  const tagFilters = normalizeTagFilters(options.tags);
  const bullets = [];

  for (const response of responses) {
    if (response.status !== 'answered') continue;
    const fragments = splitAnswerIntoFragments(response.answer);
    if (fragments.length === 0) continue;

    const sourceTags = Array.isArray(response.tags) ? response.tags.slice() : undefined;
    if (tagFilters) {
      if (!sourceTags || sourceTags.length === 0) continue;
      const tagSet = new Set(
        sourceTags
          .map(tag => sanitizeString(tag))
          .filter(Boolean)
          .map(tag => tag.toLowerCase()),
      );
      let matches = true;
      for (const required of tagFilters) {
        if (!tagSet.has(required)) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
    }

    fragments.forEach((text, index) => {
      const entry = {
        id: `${response.id}:${index}`,
        text,
        source: {
          type: 'intake',
          question: response.question,
          response_id: response.id,
        },
      };
      if (sourceTags && sourceTags.length > 0) entry.tags = sourceTags.slice();
      if (response.notes) entry.notes = response.notes;
      if (response.asked_at) entry.source.asked_at = response.asked_at;
      if (response.recorded_at) entry.source.recorded_at = response.recorded_at;
      bullets.push(entry);
    });
  }

  return bullets;
}
