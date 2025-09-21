import fs from 'node:fs/promises';
import path from 'node:path';

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setApplicationEventsDataDir(dir) {
  overrideDir = dir || undefined;
}

function getPaths() {
  const dir = resolveDataDir();
  return { dir, file: path.join(dir, 'application_events.json') };
}

async function readEventsFile(file) {
  try {
    const contents = await fs.readFile(file, 'utf8');
    const data = JSON.parse(contents);
    if (data && typeof data === 'object') {
      return data;
    }
    return {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeJsonFile(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

function normalizeDate(input) {
  const value = input ? new Date(input) : new Date();
  if (Number.isNaN(value.getTime())) {
    throw new Error(`invalid date: ${input}`);
  }
  return value.toISOString();
}

function normalizeDocuments(documents) {
  if (!documents) return undefined;
  const list = Array.isArray(documents)
    ? documents
    : String(documents)
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
  const normalized = list.map(doc => String(doc).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function parseIsoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

let writeLock = Promise.resolve();

export function logApplicationEvent(jobId, event) {
  if (!jobId || typeof jobId !== 'string') {
    return Promise.reject(new Error('job id is required'));
  }
  if (!event || typeof event.channel !== 'string' || !event.channel.trim()) {
    return Promise.reject(new Error('channel is required'));
  }

  const channel = event.channel.trim();
  let date;
  try {
    date = normalizeDate(event.date);
  } catch (err) {
    return Promise.reject(err);
  }
  const contact = sanitizeString(event.contact);
  const note = sanitizeString(event.note);
  const documents = normalizeDocuments(event.documents);
  const remindInput = event.remindAt ?? event.remind_at;
  let remindAt;
  if (remindInput !== undefined) {
    try {
      remindAt = normalizeDate(remindInput);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  const entry = { channel, date };
  if (contact) entry.contact = contact;
  if (note) entry.note = note;
  if (documents) entry.documents = documents;
  if (remindAt) entry.remind_at = remindAt;

  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const data = await readEventsFile(file);
    const history = Array.isArray(data[jobId]) ? data[jobId] : [];
    history.push(entry);
    data[jobId] = history;
    await writeJsonFile(file, data);
    return entry;
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export async function getApplicationEvents(jobId) {
  const { file } = getPaths();
  const data = await readEventsFile(file);
  if (jobId === undefined) return data;
  const history = data[jobId];
  return Array.isArray(history) ? history : [];
}

export async function getReminders({ now = new Date() } = {}) {
  const { file } = getPaths();
  const data = await readEventsFile(file);
  const reminders = [];
  const current = parseIsoTimestamp(now) ?? new Date();

  for (const [jobId, history] of Object.entries(data)) {
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      const remindAt = parseIsoTimestamp(entry?.remind_at);
      if (!remindAt) continue;

      const normalizedDate = parseIsoTimestamp(entry?.date);
      const channel = sanitizeString(entry?.channel);
      const contact = sanitizeString(entry?.contact);
      const note = sanitizeString(entry?.note);

      reminders.push({
        job_id: jobId,
        channel: channel || undefined,
        date: normalizedDate ? normalizedDate.toISOString() : undefined,
        contact: contact || undefined,
        note: note || undefined,
        remind_at: remindAt.toISOString(),
        overdue: remindAt.getTime() < current.getTime(),
      });
    }
  }

  reminders.sort((a, b) => {
    const aTime = parseIsoTimestamp(a.remind_at)?.getTime() ?? 0;
    const bTime = parseIsoTimestamp(b.remind_at)?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    if (a.job_id < b.job_id) return -1;
    if (a.job_id > b.job_id) return 1;
    return 0;
  });

  return reminders;
}
