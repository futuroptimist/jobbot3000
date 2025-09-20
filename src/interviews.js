import fs from 'node:fs/promises';
import path from 'node:path';

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setInterviewDataDir(dir) {
  overrideDir = dir || undefined;
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : undefined;
}

function requireId(value, label) {
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

function normalizeTranscript(input) {
  if (input == null) return undefined;
  const value = sanitizeString(input);
  if (!value) {
    throw new Error('transcript cannot be empty');
  }
  return value;
}

function normalizeNoteList(input, label) {
  if (input == null) return undefined;
  const items = Array.isArray(input) ? input : [input];
  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    const value = sanitizeString(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  return normalized;
}

function normalizeNotes(input) {
  if (input == null) return undefined;
  const value = sanitizeString(input);
  if (!value) {
    throw new Error('notes cannot be empty');
  }
  return value;
}

function resolveSessionPath(jobId, sessionId) {
  const baseDir = resolveDataDir();
  const jobDir = path.join(baseDir, 'interviews', jobId);
  return { jobDir, file: path.join(jobDir, `${sessionId}.json`) };
}

export async function recordInterviewSession(jobId, sessionId, data = {}) {
  const normalizedJobId = requireId(jobId, 'job id');
  const normalizedSessionId = requireId(sessionId, 'session id');

  const transcript = normalizeTranscript(data.transcript);
  const reflections = normalizeNoteList(data.reflections, 'reflections');
  const feedback = normalizeNoteList(data.feedback, 'feedback');
  const notes = normalizeNotes(data.notes);

  if (!transcript && !reflections && !feedback && !notes) {
    throw new Error('at least one session field is required');
  }

  const stage = sanitizeString(data.stage);
  const mode = sanitizeString(data.mode);
  const startedAt = normalizeTimestamp(data.startedAt ?? data.started_at, 'start');
  const endedAt = normalizeTimestamp(data.endedAt ?? data.ended_at, 'end');

  const { jobDir, file } = resolveSessionPath(normalizedJobId, normalizedSessionId);
  await fs.mkdir(jobDir, { recursive: true });

  const entry = {
    job_id: normalizedJobId,
    session_id: normalizedSessionId,
    recorded_at: new Date().toISOString(),
  };

  if (stage) entry.stage = stage;
  if (mode) entry.mode = mode;
  if (transcript) entry.transcript = transcript;
  if (reflections) entry.reflections = reflections;
  if (feedback) entry.feedback = feedback;
  if (notes) entry.notes = notes;
  if (startedAt) entry.started_at = startedAt;
  if (endedAt) entry.ended_at = endedAt;

  await fs.writeFile(file, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

  return { ...entry };
}

async function readSessionFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function getInterviewSession(jobId, sessionId) {
  const normalizedJobId = requireId(jobId, 'job id');
  const normalizedSessionId = requireId(sessionId, 'session id');
  const { file } = resolveSessionPath(normalizedJobId, normalizedSessionId);
  const data = await readSessionFile(file);
  return data ? { ...data } : null;
}
