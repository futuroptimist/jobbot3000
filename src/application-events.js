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

let writeLock = Promise.resolve();

function normalizeJobId(jobId) {
  if (typeof jobId !== 'string') {
    throw new Error('job id is required');
  }
  const trimmed = jobId.trim();
  if (!trimmed) {
    throw new Error('job id is required');
  }
  return trimmed;
}

function findLatestReminder(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || typeof entry !== 'object') continue;
    const reminder = typeof entry.remind_at === 'string' ? entry.remind_at.trim() : '';
    if (reminder) {
      return { index, entry };
    }
  }
  return null;
}

function cloneHistoryEntries(history) {
  if (!Array.isArray(history)) {
    return null;
  }
  return history.map(entry => {
    if (entry && typeof entry === 'object') {
      return { ...entry };
    }
    return entry;
  });
}

export function replaceApplicationEvents(jobId, updater) {
  if (typeof updater !== 'function') {
    return Promise.reject(new Error('updater function is required'));
  }

  const normalizedJobId = normalizeJobId(jobId);
  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const data = await readEventsFile(file);
    const current = cloneHistoryEntries(data[normalizedJobId]) ?? [];
    const next = await updater(current);
    if (next !== undefined && !Array.isArray(next)) {
      throw new Error('replaceApplicationEvents updater must return an array');
    }
    const normalizedHistory = Array.isArray(next)
      ? next.map(entry => (entry && typeof entry === 'object' ? { ...entry } : entry))
      : current;
    data[normalizedJobId] = normalizedHistory;
    await writeJsonFile(file, data);
    return normalizedHistory;
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

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

function normalizeReferenceDate(now) {
  if (now === undefined) return new Date();
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) throw new Error(`invalid reference timestamp: ${now}`);
    return now;
  }
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid reference timestamp: ${now}`);
  }
  return parsed;
}

function appendReminder(reminders, jobId, entry, now, includePastDue) {
  if (!entry || typeof entry !== 'object') return;
  if (typeof entry.remind_at !== 'string') return;
  const remindDate = new Date(entry.remind_at);
  if (Number.isNaN(remindDate.getTime())) return;
  const pastDue = remindDate.getTime() < now.getTime();
  if (!includePastDue && pastDue) return;

  const reminder = {
    job_id: jobId,
    remind_at: remindDate.toISOString(),
    past_due: pastDue,
  };

  const channel = sanitizeString(entry.channel);
  if (channel) reminder.channel = channel;
  const note = sanitizeString(entry.note);
  if (note) reminder.note = note;
  const contact = sanitizeString(entry.contact);
  if (contact) reminder.contact = contact;

  reminders.push(reminder);
}

export async function getApplicationReminders({ now, includePastDue = true } = {}) {
  const reference = normalizeReferenceDate(now);
  const { file } = getPaths();
  const data = await readEventsFile(file);
  const reminders = [];

  for (const [jobId, history] of Object.entries(data)) {
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      appendReminder(reminders, jobId, entry, reference, includePastDue);
    }
  }

  reminders.sort((a, b) => {
    if (a.remind_at < b.remind_at) return -1;
    if (a.remind_at > b.remind_at) return 1;
    return a.job_id.localeCompare(b.job_id);
  });

  return reminders;
}

export function snoozeApplicationReminder(jobId, options = {}) {
  const normalizedJobId = normalizeJobId(jobId);
  const untilInput =
    options.until ?? options.remindAt ?? options.remind_at ?? options.date ?? options.at;
  if (untilInput === undefined) {
    return Promise.reject(new Error('snooze until timestamp is required'));
  }

  let nextTimestamp;
  try {
    nextTimestamp = normalizeDate(untilInput);
  } catch (err) {
    return Promise.reject(err);
  }

  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const data = await readEventsFile(file);
    const history = cloneHistoryEntries(data[normalizedJobId]);

    const latest = history ? findLatestReminder(history) : null;
    if (!latest) {
      throw new Error(`no reminder found for ${normalizedJobId}`);
    }

    const updated = { ...latest.entry, remind_at: nextTimestamp };
    history[latest.index] = updated;
    data[normalizedJobId] = history;
    await writeJsonFile(file, data);
    return updated;
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}

export function completeApplicationReminder(jobId, options = {}) {
  const normalizedJobId = normalizeJobId(jobId);
  const completedInput =
    options.completedAt ?? options.completed_at ?? options.at ?? options.date ?? undefined;
  let completedAt;
  try {
    completedAt = normalizeDate(completedInput);
  } catch (err) {
    return Promise.reject(err);
  }

  const { dir, file } = getPaths();

  const run = async () => {
    await fs.mkdir(dir, { recursive: true });
    const data = await readEventsFile(file);
    const history = cloneHistoryEntries(data[normalizedJobId]);

    const latest = history ? findLatestReminder(history) : null;
    if (!latest) {
      throw new Error(`no reminder found for ${normalizedJobId}`);
    }

    const updated = { ...latest.entry };
    delete updated.remind_at;
    updated.reminder_completed_at = completedAt;
    history[latest.index] = updated;
    data[normalizedJobId] = history;
    await writeJsonFile(file, data);
    return updated;
  };

  writeLock = writeLock.then(run, run);
  return writeLock;
}
