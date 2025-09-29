import fs from 'node:fs/promises';
import path from 'node:path';

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setActivityDataDir(dir) {
  overrideDir = dir || undefined;
}

async function safeReadDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

function isVisibleDirectory(entry) {
  return entry.isDirectory() && !entry.name.startsWith('.');
}

function isVisibleFile(entry) {
  return entry.isFile() && !entry.name.startsWith('.');
}

function parseDeliverableDirectoryTimestamp(name) {
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:Z)?$/,
  );
  if (!match) return undefined;
  const [, datePart, hour, minute, second] = match;
  const isoCandidate = `${datePart}T${hour}:${minute}:${second}Z`;
  const timestamp = Date.parse(isoCandidate);
  if (Number.isNaN(timestamp)) return undefined;
  return { iso: isoCandidate, ms: timestamp };
}

async function summarizeDeliverableRuns(jobId) {
  const jobDir = path.join(resolveDataDir(), 'deliverables', jobId);
  const entries = await safeReadDir(jobDir);
  if (entries.length === 0) return undefined;

  let runs = 0;
  let hasFiles = false;
  let latestRunTimestamp;
  let latestRunIso;
  let latestLegacyTimestamp;

  for (const entry of entries) {
    if (!isVisibleDirectory(entry) && !isVisibleFile(entry)) continue;
    const entryPath = path.join(jobDir, entry.name);
    let stats;
    try {
      stats = await fs.stat(entryPath);
    } catch {
      continue;
    }
    const mtime = stats.mtime?.getTime();
    const fromName = isVisibleDirectory(entry)
      ? parseDeliverableDirectoryTimestamp(entry.name)
      : undefined;
    let candidateTimestamp;
    if (fromName) {
      candidateTimestamp = fromName.ms;
    } else if (Number.isFinite(mtime)) {
      candidateTimestamp = mtime;
    }
    if (isVisibleDirectory(entry)) {
      runs += 1;
      if (candidateTimestamp !== undefined) {
        if (latestRunTimestamp === undefined || candidateTimestamp > latestRunTimestamp) {
          latestRunTimestamp = candidateTimestamp;
          latestRunIso = fromName?.iso ?? new Date(candidateTimestamp).toISOString();
        }
      }
    } else if (Number.isFinite(mtime)) {
      if (latestLegacyTimestamp === undefined || mtime > latestLegacyTimestamp) {
        latestLegacyTimestamp = mtime;
      }
    }
    if (isVisibleFile(entry)) hasFiles = true;
  }

  if (runs === 0 && hasFiles) runs = 1;
  if (runs === 0) return undefined;

  const summary = { runs };
  let latestTimestamp = latestRunTimestamp;
  if (latestTimestamp === undefined && runs === 1 && hasFiles) {
    latestTimestamp = latestLegacyTimestamp;
  }
  if (latestTimestamp !== undefined) {
    summary.last_run_at = latestRunIso ?? new Date(latestTimestamp).toISOString();
  }
  return summary;
}

async function readJsonFile(file) {
  try {
    const contents = await fs.readFile(file, 'utf8');
    return JSON.parse(contents);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function normalizeTightenThis(heuristics) {
  const tighten = heuristics?.critique?.tighten_this;
  if (!Array.isArray(tighten)) return undefined;
  const cleaned = tighten
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function coerceIsoTimestamp(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

async function summarizeInterviewSessions(jobId, options = {}) {
  const jobDir = path.join(resolveDataDir(), 'interviews', jobId);
  const entries = await safeReadDir(jobDir);
  if (entries.length === 0) return undefined;

  const sessions = [];
  const afterRaw = typeof options.after === 'string' ? options.after.trim() : undefined;
  const afterTimestamp = afterRaw ? new Date(afterRaw) : undefined;
  const afterMs = afterTimestamp && !Number.isNaN(afterTimestamp.getTime())
    ? afterTimestamp.getTime()
    : undefined;
  for (const entry of entries) {
    if (!isVisibleFile(entry)) continue;
    const filePath = path.join(jobDir, entry.name);
    let payload;
    try {
      payload = await readJsonFile(filePath);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== 'object') continue;

    const sessionId =
      typeof payload.session_id === 'string' ? payload.session_id.trim() : undefined;
    let recordedAt = coerceIsoTimestamp(payload.recorded_at);
    let recordedAtSource;
    if (recordedAt) {
      recordedAtSource = 'recorded_at';
    } else {
      const startedAt = coerceIsoTimestamp(payload.started_at);
      if (startedAt) {
        recordedAt = startedAt;
        recordedAtSource = 'started_at';
      }
    }
    let fallbackTime;
    if (!recordedAt) {
      try {
        const stats = await fs.stat(filePath);
        const mtimeMs = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : stats.mtime?.getTime();
        if (Number.isFinite(mtimeMs)) {
          fallbackTime = new Date(mtimeMs).toISOString();
          recordedAtSource = 'file_mtime';
        }
      } catch {
        // Ignore filesystem errors when deriving fallback timestamps.
      }
    }
    sessions.push({
      session_id: sessionId,
      recorded_at: recordedAt ?? fallbackTime,
      recorded_at_source: recordedAtSource,
      stage: typeof payload.stage === 'string' ? payload.stage.trim() : undefined,
      mode: typeof payload.mode === 'string' ? payload.mode.trim() : undefined,
      critique: normalizeTightenThis(payload.heuristics),
    });
  }

  if (sessions.length === 0) return undefined;

  sessions.sort((a, b) => {
    const aTime = a.recorded_at ? Date.parse(a.recorded_at) : NaN;
    const bTime = b.recorded_at ? Date.parse(b.recorded_at) : NaN;
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) return bTime - aTime;
    if (!Number.isNaN(aTime)) return -1;
    if (!Number.isNaN(bTime)) return 1;
    return (b.session_id || '').localeCompare(a.session_id || '');
  });

  const lastSession = sessions[0];
  const summary = { sessions: sessions.length };
  if (lastSession) {
    const detail = {};
    if (lastSession.session_id) detail.session_id = lastSession.session_id;
    if (lastSession.recorded_at) detail.recorded_at = lastSession.recorded_at;
    if (lastSession.recorded_at_source) detail.recorded_at_source = lastSession.recorded_at_source;
    if (lastSession.stage) detail.stage = lastSession.stage;
    if (lastSession.mode) detail.mode = lastSession.mode;
    if (lastSession.critique) {
      detail.critique = { tighten_this: lastSession.critique };
    }
    if (Object.keys(detail).length > 0) {
      summary.last_session = detail;
    }
  }
  if (afterMs !== undefined) {
    const sessionsAfter = sessions.reduce((count, session) => {
      if (!session.recorded_at) return count;
      const ts = Date.parse(session.recorded_at);
      if (Number.isNaN(ts)) return count;
      return ts > afterMs ? count + 1 : count;
    }, 0);
    summary.sessions_after_last_deliverable = sessionsAfter;
  }
  return summary;
}

export async function summarizeJobActivity(jobId) {
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    return null;
  }

  const trimmedId = jobId.trim();
  const deliverables = await summarizeDeliverableRuns(trimmedId);
  const interviews = await summarizeInterviewSessions(trimmedId, {
    after: deliverables?.last_run_at,
  });

  const result = {};
  if (deliverables) result.deliverables = deliverables;
  if (interviews) result.interviews = interviews;

  return Object.keys(result).length === 0 ? null : result;
}

export { summarizeDeliverableRuns, summarizeInterviewSessions };
