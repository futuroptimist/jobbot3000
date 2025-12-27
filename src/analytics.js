import fs from 'node:fs/promises';
import path from 'node:path';

import { STATUSES } from './lifecycle.js';
import { OpportunitiesRepo } from './services/opportunitiesRepo.js';
import { computeSankeyEdges } from './analytics/sankey.js';

let overrideDir;

const KNOWN_STATUSES = new Set(STATUSES.map(status => status.toLowerCase()));
const STATUS_TEMPLATE = Object.freeze(Object.fromEntries(STATUSES.map(status => [status, 0])));
const CURRENCY_SYMBOL_PREFIX_RE = /^\p{Sc}+/u;
const ADDITIONAL_CURRENCY_SYMBOL_RE = /\p{Sc}/gu;
const COMPENSATION_VALUE_RE =
  /((?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d+)?)(?:\s*(k|m|b))?/gi;
const CURRENCY_CODE_PATTERN = /\b([A-Z]{3,4})\b/g;
const KNOWN_CURRENCY_CODES = new Set([
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'JPY',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'BRL',
  'MXN',
  'ZAR',
  'PLN',
  'TRY',
  'KRW',
  'ILS',
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_STATUS_DAYS = 30;
const STALE_EVENT_DAYS = 30;

function resolveReferenceDate(now) {
  if (now === undefined) return new Date();
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) {
      throw new Error(`Invalid analytics reference timestamp: ${now}`);
    }
    return now;
  }
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid analytics reference timestamp: ${now}`);
  }
  return parsed;
}

function parseRangeBoundary(value, label) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid analytics ${label} date: ${value}`);
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid analytics ${label} date: ${value}`);
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid analytics ${label} date: ${value}`);
    }
    return parsed;
  }
  throw new Error(`Invalid analytics ${label} date: ${value}`);
}

function isWithinRange(date, fromDate, toDate) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function filterEventsByRange(events, fromDate, toDate) {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (!fromDate && !toDate) return events.slice();
  const filtered = [];
  for (const entry of events) {
    const raw = typeof entry?.date === 'string' ? entry.date.trim() : '';
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!isWithinRange(parsed, fromDate, toDate)) continue;
    filtered.push(entry);
  }
  return filtered;
}

function statusWithinRange(statusEntry, fromDate, toDate) {
  if (statusEntry === undefined) return false;
  if (!fromDate && !toDate) return true;
  const iso = extractUpdatedAtValue(statusEntry);
  if (!iso) return false;
  const parsed = new Date(iso);
  return isWithinRange(parsed, fromDate, toDate);
}

function extractUpdatedAtValue(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  const candidates = [entry.updated_at, entry.updatedAt];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) continue;
    return parsed.toISOString();
  }
  return undefined;
}

function calculateAgeDays(reference, isoTimestamp) {
  if (!isoTimestamp) return 0;
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return 0;
  const diffMs = reference.getTime() - parsed.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / MS_PER_DAY);
}

function uniqueSortedJobs(jobIds) {
  if (!Array.isArray(jobIds) || jobIds.length === 0) return [];
  const set = new Set(jobIds.filter(id => typeof id === 'string' && id));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function normalizeHeatmapValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function canonicalizeLabel(label, cache) {
  const normalized = label.toLowerCase();
  const existing = cache.get(normalized);
  if (existing) return existing;
  cache.set(normalized, label);
  return label;
}

function sortCaseInsensitive(values) {
  return values.slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function findLatestEventDate(history) {
  if (!Array.isArray(history)) return undefined;
  let latest;
  for (const entry of history) {
    const raw = typeof entry?.date === 'string' ? entry.date.trim() : '';
    if (!raw) continue;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const iso = parsed.toISOString();
    if (!latest || iso > latest) {
      latest = iso;
    }
  }
  return latest;
}

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setAnalyticsDataDir(dir) {
  overrideDir = dir || undefined;
}

async function readJsonFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

async function readOpportunityEventsFromFile(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }

  const events = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;

    const opportunityUid = typeof parsed.opportunityUid === 'string' ? parsed.opportunityUid : null;
    const occurredAt = typeof parsed.occurredAt === 'string' ? parsed.occurredAt : null;
    const type = typeof parsed.type === 'string' ? parsed.type : null;
    if (!opportunityUid || !occurredAt || !type) continue;

    const eventUid =
      typeof parsed.eventUid === 'string' && parsed.eventUid.trim()
        ? parsed.eventUid.trim()
        : `${opportunityUid}:${occurredAt}:${type}:${index}`;
    let payload;
    if (parsed.payload && typeof parsed.payload === 'object') {
      payload = { ...parsed.payload };
    } else if (typeof parsed.payload === 'string') {
      const trimmed = parsed.payload.trim();
      if (trimmed) {
        try {
          const parsedPayload = JSON.parse(trimmed);
          if (parsedPayload && typeof parsedPayload === 'object') {
            payload = { ...parsedPayload };
          }
        } catch {
          // ignore invalid payload JSON
        }
      }
    }

    events.push({
      eventUid,
      opportunityUid,
      occurredAt,
      type,
      payload,
    });
  }

  return events;
}

function collectOpportunityEventsFromRepo(repo) {
  const events = [];
  if (!repo || typeof repo.listOpportunities !== 'function') return events;

  const opportunities = repo.listOpportunities();
  for (const opportunity of opportunities) {
    const history = repo.listEvents?.(opportunity.uid) ?? [];
    if (!Array.isArray(history) || history.length === 0) continue;
    for (const event of history) {
      events.push(event);
    }
  }
  return events;
}

function getPaths() {
  const dir = resolveDataDir();
  return {
    applications: path.join(dir, 'applications.json'),
    events: path.join(dir, 'application_events.json'),
  };
}

function listJobsWithEvents(events) {
  const ids = [];
  for (const [jobId, history] of Object.entries(events)) {
    if (Array.isArray(history) && history.length > 0) {
      ids.push(jobId);
    }
  }
  return ids;
}

function extractStatusValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.status === 'string') {
    return value.status.trim();
  }
  return '';
}

function getStatusCounts(statuses) {
  const counts = new Map();
  for (const value of Object.values(statuses)) {
    const key = normalizeStatusKey(value);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function normalizeStatusKey(value) {
  const extracted = extractStatusValue(value);
  return extracted ? extracted.toLowerCase() : '';
}

function extractCompanyFromStatusEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const company = entry.company ?? entry.company_name ?? entry.companyName;
  if (typeof company === 'string') {
    const trimmed = company.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

const ACCEPTANCE_STATUS = new Set(['accepted', 'acceptance', 'hired']);
const ACCEPTANCE_CHANNELS = new Set([
  'offer_accepted',
  'offer accepted',
  'accepted_offer',
  'accept offer',
  'acceptance',
  'offeraccept',
  'offer-accepted',
]);

function collectAcceptanceJobs(statuses, events) {
  const accepted = new Set();
  for (const [jobId, rawStatus] of Object.entries(statuses)) {
    const status = normalizeStatusKey(rawStatus);
    if (!status) continue;
    if (ACCEPTANCE_STATUS.has(status)) {
      accepted.add(jobId);
    }
  }
  for (const [jobId, history] of Object.entries(events)) {
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      const channel = typeof entry?.channel === 'string' ? entry.channel.trim().toLowerCase() : '';
      if (channel && ACCEPTANCE_CHANNELS.has(channel)) {
        accepted.add(jobId);
        break;
      }
    }
  }
  return accepted;
}

function unionJobIds(statuses, events) {
  const ids = new Set();
  for (const key of Object.keys(statuses)) ids.add(key);
  for (const key of Object.keys(events)) ids.add(key);
  return ids;
}

function collectJobsWithRecognizedStatuses(statuses) {
  const ids = new Set();
  for (const [jobId, rawStatus] of Object.entries(statuses)) {
    const normalized = normalizeStatusKey(rawStatus);
    if (normalized && KNOWN_STATUSES.has(normalized)) {
      ids.add(jobId);
    }
  }
  return ids;
}

const STAGE_SEQUENCE = [
  { key: 'outreach', label: 'Outreach', type: 'outreach' },
  { key: 'screening', label: 'Screening', type: 'status', status: 'screening' },
  { key: 'onsite', label: 'Onsite', type: 'status', status: 'onsite' },
  { key: 'offer', label: 'Offer', type: 'status', status: 'offer' },
  { key: 'acceptance', label: 'Acceptance', type: 'acceptance' },
];

function roundPercent(value) {
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * 100);
}

async function readAnalyticsSources() {
  const { applications, events } = getPaths();
  const [statuses, interactions] = await Promise.all([
    readJsonFile(applications),
    readJsonFile(events),
  ]);
  return { statuses, interactions };
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

async function summarizeDeliverableActivity(baseDir) {
  const entries = await safeReadDir(baseDir);
  let jobs = 0;
  let runs = 0;
  for (const entry of entries) {
    if (!isVisibleDirectory(entry)) continue;
    const jobDir = path.join(baseDir, entry.name);
    const runEntries = await safeReadDir(jobDir);
    let jobRuns = 0;
    let hasFiles = false;
    for (const runEntry of runEntries) {
      if (isVisibleDirectory(runEntry)) jobRuns += 1;
      if (isVisibleFile(runEntry)) hasFiles = true;
    }
    if (jobRuns === 0 && hasFiles) {
      jobRuns = 1;
    }
    if (jobRuns > 0) {
      jobs += 1;
      runs += jobRuns;
    }
  }
  return { jobs, runs };
}

async function summarizeInterviewActivity(baseDir) {
  const entries = await safeReadDir(baseDir);
  let jobs = 0;
  let sessions = 0;
  for (const entry of entries) {
    if (!isVisibleDirectory(entry)) continue;
    const jobDir = path.join(baseDir, entry.name);
    const sessionEntries = await safeReadDir(jobDir);
    let jobSessions = 0;
    for (const sessionEntry of sessionEntries) {
      if (isVisibleFile(sessionEntry)) jobSessions += 1;
    }
    if (jobSessions > 0) {
      jobs += 1;
      sessions += jobSessions;
    }
  }
  return { jobs, sessions };
}

async function summarizeActivity() {
  const dataDir = resolveDataDir();
  const [deliverables, interviews] = await Promise.all([
    summarizeDeliverableActivity(path.join(dataDir, 'deliverables')),
    summarizeInterviewActivity(path.join(dataDir, 'interviews')),
  ]);
  return { deliverables, interviews };
}

function cloneStatusTemplate() {
  return { ...STATUS_TEMPLATE };
}

function extractCompanyFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (typeof snapshot.company === 'string' && snapshot.company.trim()) {
    return snapshot.company.trim();
  }
  const parsedCompany = snapshot.parsed?.company;
  if (typeof parsedCompany === 'string' && parsedCompany.trim()) {
    return parsedCompany.trim();
  }
  return null;
}

async function readCompanyFromSnapshot(jobsDir, jobId) {
  if (!jobId) return null;
  const file = path.join(jobsDir, `${jobId}.json`);
  try {
    const contents = await fs.readFile(file, 'utf8');
    const snapshot = JSON.parse(contents);
    return extractCompanyFromSnapshot(snapshot);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

function createCompanySummary(name) {
  return {
    name: name ?? null,
    tracked_jobs: 0,
    with_events: 0,
    statusless_jobs: 0,
    statuses: cloneStatusTemplate(),
  };
}

function cloneCompanySummary(summary, nameOverride) {
  return {
    name: nameOverride !== undefined ? nameOverride : summary.name ?? null,
    tracked_jobs: summary.tracked_jobs,
    with_events: summary.with_events,
    statusless_jobs: summary.statusless_jobs,
    statuses: { ...summary.statuses },
  };
}

function cloneCompanySummaries(summaries) {
  return summaries.map(summary => cloneCompanySummary(summary));
}

function redactCompanySummaries(summaries) {
  let counter = 1;
  return summaries.map(summary => {
    if (!summary || typeof summary !== 'object') {
      return summary;
    }
    let nameOverride = summary.name;
    if (summary.name) {
      nameOverride = `Company ${counter}`;
      counter += 1;
    } else {
      nameOverride = null;
    }
    return cloneCompanySummary(summary, nameOverride);
  });
}

async function summarizeCompanies(statuses = {}, interactions = {}) {
  const jobIds = Array.from(unionJobIds(statuses, interactions));
  if (jobIds.length === 0) return [];
  const jobsDir = path.join(resolveDataDir(), 'jobs');
  const jobsWithEvents = new Set(listJobsWithEvents(interactions));
  const summaries = new Map();

  for (const jobId of jobIds) {
    const statusEntry = statuses[jobId];
    let company = extractCompanyFromStatusEntry(statusEntry);
    if (!company) {
      company = await readCompanyFromSnapshot(jobsDir, jobId);
    }
    if (company) {
      company = company.trim();
    }
    const key = company ? company.toLowerCase() : '__unknown__';
    let summary = summaries.get(key);
    if (!summary) {
      summary = createCompanySummary(company);
      summaries.set(key, summary);
    } else if (!summary.name && company) {
      summary.name = company;
    }
    summary.tracked_jobs += 1;
    if (jobsWithEvents.has(jobId)) {
      summary.with_events += 1;
    }
    const normalizedStatus = normalizeStatusKey(statusEntry);
    if (normalizedStatus && summary.statuses[normalizedStatus] !== undefined) {
      summary.statuses[normalizedStatus] += 1;
    } else if (jobsWithEvents.has(jobId) && !normalizedStatus) {
      summary.statusless_jobs += 1;
    }
  }

  return Array.from(summaries.values()).sort((a, b) => {
    if (a.name && b.name) return a.name.localeCompare(b.name);
    if (a.name) return -1;
    if (b.name) return 1;
    return 0;
  });
}

export async function computeAnalyticsHealth(options = {}) {
  const reference = resolveReferenceDate(options.now);
  const { statuses, interactions } = await readAnalyticsSources();
  const tracked = unionJobIds(statuses, interactions);
  const eventsList = listJobsWithEvents(interactions);
  const jobsWithEvents = new Set(eventsList);

  const missingStatusCandidates = [];
  const unknownStatusEntries = [];
  const staleStatusEntries = [];
  const staleEventEntries = [];

  let jobsWithStatus = 0;

  for (const [jobId, rawStatus] of Object.entries(statuses)) {
    const normalized = normalizeStatusKey(rawStatus);
    const statusLabel = extractStatusValue(rawStatus);
    const recognized = normalized && KNOWN_STATUSES.has(normalized);
    if (recognized) {
      jobsWithStatus += 1;
    }
    if (normalized && !recognized) {
      unknownStatusEntries.push({
        job_id: jobId,
        status: statusLabel || normalized,
      });
    }
    if (jobsWithEvents.has(jobId) && (!normalized || !recognized)) {
      missingStatusCandidates.push(jobId);
    }
    if (recognized) {
      const updatedAt = extractUpdatedAtValue(rawStatus);
      if (updatedAt) {
        const ageDays = calculateAgeDays(reference, updatedAt);
        if (ageDays > STALE_STATUS_DAYS) {
          staleStatusEntries.push({
            job_id: jobId,
            status: statusLabel || normalized,
            updated_at: updatedAt,
            age_days: ageDays,
          });
        }
      }
    }
  }

  for (const jobId of jobsWithEvents) {
    if (!(jobId in statuses)) {
      missingStatusCandidates.push(jobId);
    }
  }

  for (const [jobId, history] of Object.entries(interactions)) {
    if (!Array.isArray(history) || history.length === 0) continue;
    const latest = findLatestEventDate(history);
    if (!latest) continue;
    const ageDays = calculateAgeDays(reference, latest);
    if (ageDays > STALE_EVENT_DAYS) {
      staleEventEntries.push({
        job_id: jobId,
        last_event_at: latest,
        age_days: ageDays,
      });
    }
  }

  unknownStatusEntries.sort((a, b) => a.job_id.localeCompare(b.job_id));
  staleStatusEntries.sort((a, b) => a.job_id.localeCompare(b.job_id));
  staleEventEntries.sort((a, b) => a.job_id.localeCompare(b.job_id));

  const missingJobs = uniqueSortedJobs(missingStatusCandidates);

  return {
    generated_at: new Date(reference).toISOString(),
    summary: {
      tracked_jobs: tracked.size,
      jobs_with_status: jobsWithStatus,
      jobs_with_events: jobsWithEvents.size,
    },
    thresholds: {
      stale_status_days: STALE_STATUS_DAYS,
      stale_event_days: STALE_EVENT_DAYS,
    },
    issues: {
      missingStatus: { count: missingJobs.length, jobs: missingJobs },
      unknownStatuses: { count: unknownStatusEntries.length, entries: unknownStatusEntries },
      staleStatuses: { count: staleStatusEntries.length, entries: staleStatusEntries },
      staleEvents: { count: staleEventEntries.length, entries: staleEventEntries },
    },
  };
}

function formatIssueLine(label, items, formatter, noun = 'job') {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return `${label}: none`;
  }
  const formatted = list.map(formatter).filter(Boolean);
  const nounLabel = list.length === 1 ? noun : `${noun}s`;
  const suffix = formatted.length ? ` (${formatted.join(', ')})` : '';
  return `${label}: ${list.length} ${nounLabel}${suffix}`;
}

export function formatAnalyticsHealthReport(health) {
  if (!health || typeof health !== 'object') {
    return 'No analytics health data available';
  }

  const summary = health.summary ?? {};
  const thresholds = health.thresholds ?? {};
  const issues = health.issues ?? {};

  const lines = [];
  const generatedAt =
    typeof health.generated_at === 'string' && health.generated_at
      ? health.generated_at
      : undefined;
  lines.push(
    generatedAt ? `Analytics health (generated ${generatedAt})` : 'Analytics health',
  );

  const tracked = summary.tracked_jobs ?? 0;
  const withStatus = summary.jobs_with_status ?? 0;
  const withEvents = summary.jobs_with_events ?? 0;
  lines.push(`Tracked jobs: ${tracked}; with status: ${withStatus}; with outreach: ${withEvents}`);

  const statusThreshold = thresholds.stale_status_days ?? STALE_STATUS_DAYS;
  const eventThreshold = thresholds.stale_event_days ?? STALE_EVENT_DAYS;

  lines.push(
    formatIssueLine('Missing statuses', issues.missingStatus?.jobs, jobId => jobId),
  );

  lines.push(
    formatIssueLine(
      'Unknown statuses',
      issues.unknownStatuses?.entries,
      entry => {
        if (!entry || typeof entry.job_id !== 'string' || !entry.job_id) return undefined;
        return entry.status ? `${entry.job_id} (${entry.status})` : entry.job_id;
      },
    ),
  );

  lines.push(
    formatIssueLine(
      `Stale statuses (>${statusThreshold}d)`,
      issues.staleStatuses?.entries,
      entry => {
        if (!entry || typeof entry.job_id !== 'string' || !entry.job_id) return undefined;
        const details = [];
        if (entry.status) details.push(entry.status);
        if (entry.updated_at) details.push(`updated ${entry.updated_at}`);
        if (Number.isFinite(entry.age_days)) details.push(`${entry.age_days}d old`);
        const suffix = details.length ? ` (${details.join(', ')})` : '';
        return `${entry.job_id}${suffix}`;
      },
    ),
  );

  lines.push(
    formatIssueLine(
      `Stale outreach (>${eventThreshold}d)`,
      issues.staleEvents?.entries,
      entry => {
        if (!entry || typeof entry.job_id !== 'string' || !entry.job_id) return undefined;
        const details = [];
        if (entry.last_event_at) details.push(`last ${entry.last_event_at}`);
        if (Number.isFinite(entry.age_days)) details.push(`${entry.age_days}d old`);
        const suffix = details.length ? ` (${details.join(', ')})` : '';
        return `${entry.job_id}${suffix}`;
      },
    ),
  );

  return lines.join('\n');
}

function buildFunnel(statuses, interactions) {
  const statusCounts = getStatusCounts(statuses);
  const jobsWithEvents = listJobsWithEvents(interactions);
  const withEvents = jobsWithEvents.length;
  const acceptedJobs = collectAcceptanceJobs(statuses, interactions);
  const trackedJobs = unionJobIds(statuses, interactions).size;
  const recognizedStatusJobs = collectJobsWithRecognizedStatuses(statuses);
  const statuslessJobs = jobsWithEvents
    .filter(jobId => !recognizedStatusJobs.has(jobId))
    .sort((a, b) => a.localeCompare(b));

  const stages = [];
  let previousCount;
  for (let index = 0; index < STAGE_SEQUENCE.length; index += 1) {
    const stage = STAGE_SEQUENCE[index];
    let count = 0;
    if (stage.type === 'outreach') {
      count = withEvents;
    } else if (stage.type === 'status') {
      count = statusCounts.get(stage.status) ?? 0;
    } else if (stage.type === 'acceptance') {
      count = acceptedJobs.size;
    }

    const dropOff = previousCount != null && previousCount > count ? previousCount - count : 0;
    let conversionRate;
    if (index === 0) {
      conversionRate = 1;
    } else if (previousCount != null && previousCount > 0) {
      conversionRate = count / previousCount;
    }
    stages.push({
      key: stage.key,
      label: stage.label,
      count,
      dropOff,
      conversionRate,
    });
    previousCount = count;
  }

  let largestDropOff = null;
  for (let i = 1; i < stages.length; i += 1) {
    const stage = stages[i];
    if (!largestDropOff || stage.dropOff > largestDropOff.dropOff) {
      largestDropOff = {
        from: stages[i - 1].key,
        fromLabel: stages[i - 1].label,
        to: stage.key,
        toLabel: stage.label,
        dropOff: stage.dropOff,
      };
    }
  }

  return {
    totals: {
      trackedJobs,
      withEvents,
    },
    stages,
    largestDropOff,
    sankey: buildSankeyDiagram(stages),
    missing: {
      statuslessJobs: {
        count: statuslessJobs.length,
        ids: statuslessJobs,
      },
    },
  };
}

function buildSankeyDiagram(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return { nodes: [], links: [] };
  }

  const nodes = [];
  const nodeIndex = new Map();

  const addNode = (key, label) => {
    if (!key || nodeIndex.has(key)) {
      return nodeIndex.get(key);
    }
    const resolvedLabel = typeof label === 'string' && label.trim() ? label : key;
    const index = nodes.length;
    nodes.push({ key, label: resolvedLabel });
    nodeIndex.set(key, index);
    return index;
  };

  const links = [];
  const firstStage = stages[0];
  if (firstStage && firstStage.key) {
    addNode(firstStage.key, firstStage.label);
  }

  for (let i = 1; i < stages.length; i += 1) {
    const previous = stages[i - 1];
    const current = stages[i];
    if (!current || !current.key) continue;

    addNode(current.key, current.label);

    const prevCount = Number.isFinite(previous?.count) ? previous.count : 0;
    const currCount = Number.isFinite(current.count) ? current.count : 0;
    const forwardValue = prevCount > 0 ? Math.min(prevCount, currCount) : currCount;
    if (forwardValue > 0) {
      links.push({ source: previous.key, target: current.key, value: forwardValue });
    }

    const dropValue = Number.isFinite(current.dropOff) ? current.dropOff : 0;
    if (dropValue > 0 && previous?.key) {
      const dropKey = `${previous.key}_drop`;
      const dropLabel = previous.label ? `Drop-off after ${previous.label}` : dropKey;
      addNode(dropKey, dropLabel);
      links.push({ source: previous.key, target: dropKey, value: dropValue, drop: true });
    }
  }

  return { nodes, links };
}

function formatStageLine(stage, index) {
  const base = `${stage.label}: ${stage.count}`;
  if (index === 0) return base;
  const percent = roundPercent(stage.conversionRate);
  const percentLabel = percent === undefined ? 'n/a' : `${percent}%`;
  const dropSuffix = stage.dropOff > 0 ? `, ${stage.dropOff} drop-off` : '';
  return `${base} (${percentLabel} conversion${dropSuffix})`;
}

function stripKnownCurrencyCodes(text) {
  if (!text) return '';
  return text.replace(CURRENCY_CODE_PATTERN, (match, code) => {
    return KNOWN_CURRENCY_CODES.has(code) ? ' ' : match;
  });
}

function extractCurrencyPrefix(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { currency: '', remainder: '' };
  const symbolMatch = trimmed.match(CURRENCY_SYMBOL_PREFIX_RE);
  if (symbolMatch) {
    return {
      currency: symbolMatch[0],
      remainder: trimmed.slice(symbolMatch[0].length).trim(),
    };
  }
  const prefix = trimmed.slice(0, 4);
  const codeMatch = prefix.match(/^[A-Z]{3,4}/);
  if (codeMatch && KNOWN_CURRENCY_CODES.has(codeMatch[0])) {
    return {
      currency: codeMatch[0],
      remainder: trimmed.slice(codeMatch[0].length).trim(),
    };
  }
  return { currency: '', remainder: trimmed };
}

function toNumericAmount(value, suffix, fallbackSuffix) {
  const sanitized = value.replace(/[\s,]/g, '');
  const parsed = Number.parseFloat(sanitized);
  if (!Number.isFinite(parsed)) return null;
  const suffixKey = (suffix || fallbackSuffix || '').toLowerCase();
  if (suffixKey === 'k') return parsed * 1_000;
  if (suffixKey === 'm') return parsed * 1_000_000;
  if (suffixKey === 'b') return parsed * 1_000_000_000;
  return parsed;
}

function isRangeConnector(text) {
  if (!text) return true;
  const normalized = text.replace(/[\s,]+/g, ' ').trim().toLowerCase();
  if (!normalized) return true;
  if (/^[-–—]+$/.test(normalized)) return true;
  if (normalized === 'to') return true;
  return false;
}

function roundAmount(value) {
  return Math.round(value * 100) / 100;
}

function parseCompensationEntry(jobId, rawValue) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const { currency, remainder } = extractCurrencyPrefix(trimmed);
  const scrubbed = stripKnownCurrencyCodes(
    remainder.replace(ADDITIONAL_CURRENCY_SYMBOL_RE, ' '),
  );

  const entries = [];
  let lastSuffix;
  let previousEnd = 0;
  for (const match of scrubbed.matchAll(COMPENSATION_VALUE_RE)) {
    const [, number, suffix] = match;
    if (!number) continue;
    const start = match.index ?? scrubbed.indexOf(match[0], previousEnd);
    const gapFromPrevious = scrubbed.slice(previousEnd, start);
    previousEnd = start + match[0].length;

    const numeric = toNumericAmount(number, suffix, lastSuffix);
    if (numeric == null) continue;

    const entry = {
      numeric,
      number,
      appliedSuffix: (suffix || lastSuffix || '').toLowerCase(),
      gapFromPrevious,
    };
    entries.push(entry);

    if (suffix) {
      const appliedSuffix = suffix.toLowerCase();
      let index = entries.length - 2;
      let connector = gapFromPrevious;
      while (index >= 0) {
        const previous = entries[index];
        if (previous.appliedSuffix) break;
        if (!isRangeConnector(connector)) break;
        const updated = toNumericAmount(previous.number, appliedSuffix, appliedSuffix);
        if (updated == null) break;
        previous.numeric = updated;
        previous.appliedSuffix = appliedSuffix;
        connector = entries[index].gapFromPrevious;
        index -= 1;
      }
      lastSuffix = appliedSuffix;
    }
  }

  const values = entries.map(entry => entry.numeric);

  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const minimum = roundAmount(values[0]);
  const maximum = roundAmount(values[values.length - 1]);
  const midpoint = roundAmount((values[0] + values[values.length - 1]) / 2);
  return {
    job_id: jobId,
    currency: currency || 'unspecified',
    original: trimmed,
    minimum,
    maximum,
    midpoint,
  };
}

function computeAverage(values) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundAmount(total / values.length);
}

function computeMedian(values) {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return roundAmount(values[mid]);
  }
  return roundAmount((values[mid - 1] + values[mid]) / 2);
}

function summarizeCurrencyEntries(currency, entries) {
  const sorted = entries
    .slice()
    .sort((a, b) => a.midpoint - b.midpoint || a.job_id.localeCompare(b.job_id));
  const stats = {
    count: sorted.length,
    single_value: 0,
    range: 0,
    minimum: sorted.length ? sorted[0].minimum : 0,
    maximum: sorted.length ? sorted[sorted.length - 1].maximum : 0,
    average: 0,
    median: 0,
  };

  const midpoints = [];
  for (const entry of sorted) {
    if (entry.minimum === entry.maximum) stats.single_value += 1;
    else stats.range += 1;
    midpoints.push(entry.midpoint);
  }

  stats.average = computeAverage(midpoints);
  stats.median = computeMedian(midpoints);
  if (sorted.length > 0) {
    stats.minimum = sorted.reduce(
      (min, entry) => Math.min(min, entry.minimum),
      sorted[0].minimum,
    );
    stats.maximum = sorted.reduce(
      (max, entry) => Math.max(max, entry.maximum),
      sorted[0].maximum,
    );
  }

  return { currency, stats, jobs: sorted };
}

export async function computeRoleHeatmap() {
  const { getShortlist, setShortlistDataDir, getShortlistDataDir } = await import(
    './shortlist.js'
  );

  const analyticsOverride = overrideDir;
  let previousShortlistOverride;
  let snapshot;

  if (analyticsOverride !== undefined) {
    if (typeof getShortlistDataDir === 'function') {
      previousShortlistOverride = getShortlistDataDir();
    }
    if (typeof setShortlistDataDir === 'function') {
      setShortlistDataDir(analyticsOverride);
    }
    try {
      snapshot = await getShortlist();
    } finally {
      if (typeof setShortlistDataDir === 'function') {
        setShortlistDataDir(previousShortlistOverride);
      }
    }
  } else {
    snapshot = await getShortlist();
  }

  const jobs = snapshot && typeof snapshot === 'object' ? snapshot.jobs : undefined;
  const entries = jobs && typeof jobs === 'object' ? Object.entries(jobs) : [];
  const totals = {
    shortlisted_jobs: entries.length,
    with_level: 0,
    with_location: 0,
    with_both: 0,
  };
  const missing = { without_level: [], without_location: [] };
  const levelLabels = new Map();
  const locationLabels = new Map();
  const levelTotals = new Map();
  const locationTotals = new Map();
  const rows = new Map();

  for (const [jobId, record] of entries) {
    const levelValue = normalizeHeatmapValue(record?.metadata?.level);
    const locationValue = normalizeHeatmapValue(record?.metadata?.location);
    const hasLevel = Boolean(levelValue);
    const hasLocation = Boolean(locationValue);

    if (hasLevel) totals.with_level += 1;
    else missing.without_level.push(jobId);

    if (hasLocation) totals.with_location += 1;
    else missing.without_location.push(jobId);

    if (!hasLevel && !hasLocation) continue;

    const level = hasLevel ? canonicalizeLabel(levelValue, levelLabels) : null;
    const location = hasLocation
      ? canonicalizeLabel(locationValue, locationLabels)
      : null;

    if (level && !rows.has(level)) {
      rows.set(level, new Map());
    }
    if (level) {
      levelTotals.set(level, (levelTotals.get(level) ?? 0) + 1);
    }
    if (location) {
      locationTotals.set(location, (locationTotals.get(location) ?? 0) + 1);
    }
    if (level && location) {
      totals.with_both += 1;
      const row = rows.get(level);
      row.set(location, (row.get(location) ?? 0) + 1);
    }
  }

  const sortedLevels = sortCaseInsensitive([...rows.keys()]);
  const sortedLocations = sortCaseInsensitive([...locationLabels.values()]);
  const matrix = sortedLevels.map(level => {
    const rowCounts = rows.get(level) ?? new Map();
    const counts = Object.fromEntries(
      sortedLocations.map(location => [location, rowCounts.get(location) ?? 0]),
    );
    return {
      level,
      counts,
      total: levelTotals.get(level) ?? 0,
    };
  });

  const locationTotalsRecord = Object.fromEntries(
    sortedLocations.map(location => [location, locationTotals.get(location) ?? 0]),
  );

  return {
    generated_at: new Date().toISOString(),
    totals,
    levels: sortedLevels,
    locations: sortedLocations,
    matrix,
    location_totals: locationTotalsRecord,
    missing: {
      without_level: missing.without_level.sort(),
      without_location: missing.without_location.sort(),
    },
  };
}

export async function computeCompensationSummary() {
  const { getShortlist, setShortlistDataDir, getShortlistDataDir } = await import(
    './shortlist.js'
  );

  const analyticsOverride = overrideDir;
  let previousShortlistOverride;

  let snapshot;
  if (analyticsOverride !== undefined) {
    if (typeof getShortlistDataDir === 'function') {
      previousShortlistOverride = getShortlistDataDir();
    }
    if (typeof setShortlistDataDir === 'function') {
      setShortlistDataDir(analyticsOverride);
    }
    try {
      snapshot = await getShortlist();
    } finally {
      if (typeof setShortlistDataDir === 'function') {
        setShortlistDataDir(previousShortlistOverride);
      }
    }
  } else {
    snapshot = await getShortlist();
  }
  const jobs = snapshot && typeof snapshot === 'object' ? snapshot.jobs : undefined;
  const entries = jobs && typeof jobs === 'object' ? Object.entries(jobs) : [];

  const totals = {
    shortlisted_jobs: entries.length,
    with_compensation: 0,
    parsed: 0,
    unparsed: 0,
  };

  const grouped = new Map();
  const issues = [];

  for (const [jobId, record] of entries) {
    const compensation = record?.metadata?.compensation;
    if (typeof compensation !== 'string' || !compensation.trim()) {
      continue;
    }
    totals.with_compensation += 1;
    const parsed = parseCompensationEntry(jobId, compensation);
    if (!parsed) {
      totals.unparsed += 1;
      issues.push({ job_id: jobId, value: compensation });
      continue;
    }
    totals.parsed += 1;
    const key = parsed.currency;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(parsed);
  }

  const currencies = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, list]) => summarizeCurrencyEntries(currency, list));

  issues.sort((a, b) => a.job_id.localeCompare(b.job_id));

  return {
    generated_at: new Date().toISOString(),
    totals,
    currencies,
    issues,
  };
}

async function applyAnalyticsFilters(statuses, interactions, options = {}) {
  const fromDate = parseRangeBoundary(options.from, 'from');
  const toDate = parseRangeBoundary(options.to, 'to');
  if (fromDate && toDate && fromDate > toDate) {
    throw new Error('Analytics from date must not be after the to date');
  }

  const companyValue = typeof options.company === 'string' ? options.company.trim() : '';
  const companyFilter = companyValue ? companyValue.toLowerCase() : '';

  if (!fromDate && !toDate && !companyFilter) {
    return { statuses, interactions };
  }

  const filteredStatuses = {};
  const filteredInteractions = {};
  const jobIds = unionJobIds(statuses, interactions);
  const jobsDir = companyFilter ? path.join(resolveDataDir(), 'jobs') : null;
  const companyCache = new Map();

  for (const jobId of jobIds) {
    const statusEntry = statuses[jobId];

    if (companyFilter) {
      let companyName = extractCompanyFromStatusEntry(statusEntry);
      if (!companyName) {
        if (companyCache.has(jobId)) {
          companyName = companyCache.get(jobId);
        } else {
          companyName = jobsDir ? await readCompanyFromSnapshot(jobsDir, jobId) : null;
          companyCache.set(jobId, companyName);
        }
      }
      const normalizedCompany =
        typeof companyName === 'string' ? companyName.trim().toLowerCase() : '';
      if (normalizedCompany !== companyFilter) {
        continue;
      }
    }

    const events = interactions[jobId];
    const filteredEvents = filterEventsByRange(events, fromDate, toDate);
    const includeEvents = filteredEvents.length > 0;
    const includeStatus = statusWithinRange(statusEntry, fromDate, toDate);

    if (!includeEvents && !includeStatus) {
      continue;
    }

    if (includeStatus && statusEntry !== undefined) {
      filteredStatuses[jobId] = statusEntry;
    }
    if (includeEvents) {
      filteredInteractions[jobId] = filteredEvents;
    }
  }

  return { statuses: filteredStatuses, interactions: filteredInteractions };
}

export async function computeFunnel(options = {}) {
  const { statuses, interactions } = await readAnalyticsSources();
  const filtered = await applyAnalyticsFilters(statuses, interactions, options);
  return buildFunnel(filtered.statuses, filtered.interactions);
}

function countEventChannels(events) {
  const counts = new Map();
  for (const history of Object.values(events)) {
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      const raw = typeof entry?.channel === 'string' ? entry.channel.trim() : '';
      if (!raw) continue;
      const key = raw.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export async function computeActivitySummary() {
  const activity = await summarizeActivity();
  const deliverables = {
    jobs: activity?.deliverables?.jobs ?? 0,
    runs: activity?.deliverables?.runs ?? 0,
  };
  const interviews = {
    jobs: activity?.interviews?.jobs ?? 0,
    sessions: activity?.interviews?.sessions ?? 0,
  };
  return {
    generated_at: new Date().toISOString(),
    deliverables,
    interviews,
  };
}

export async function exportAnalyticsSnapshot(options = {}) {
  const { redactCompanies = false } = options;
  const { statuses, interactions } = await readAnalyticsSources();
  const activity = await summarizeActivity();
  const funnel = buildFunnel(statuses, interactions);
  const statusCounts = getStatusCounts(statuses);
  const statusTotals = {};
  for (const status of STATUSES) {
    statusTotals[status] = statusCounts.get(status) ?? 0;
  }

  const companySummaries = await summarizeCompanies(statuses, interactions);
  const companies = redactCompanies
    ? redactCompanySummaries(companySummaries)
    : cloneCompanySummaries(companySummaries);

  return {
    generated_at: new Date().toISOString(),
    totals: funnel.totals,
    statuses: statusTotals,
    channels: countEventChannels(interactions),
    funnel: {
      stages: funnel.stages,
      largestDropOff: funnel.largestDropOff,
      sankey: funnel.sankey,
      missing: {
        statuslessJobs: {
          count: funnel.missing?.statuslessJobs?.count ?? 0,
        },
      },
    },
    activity,
    companies,
  };
}

export function formatAnalyticsCsv(snapshot) {
  const stages = Array.isArray(snapshot?.funnel?.stages) ? snapshot.funnel.stages : [];
  const lines = ['stage,label,count,conversion_rate,drop_off'];
  for (const stage of stages) {
    const rawKey = typeof stage?.key === "string" ? stage.key.trim() : "";
    const rawLabel = typeof stage?.label === "string" ? stage.label.trim() : "";
    const label = rawLabel || rawKey || "Stage";
    const countValue = Number(stage?.count);
    const conversionValue = Number(stage?.conversionRate);
    const dropValue = Number(stage?.dropOff);
    lines.push(
      [
        formatCsvValue(rawKey || label),
        formatCsvValue(label),
        formatCsvValue(Number.isFinite(countValue) ? countValue : ""),
        formatCsvValue(Number.isFinite(conversionValue) ? conversionValue : ""),
        formatCsvValue(Number.isFinite(dropValue) ? dropValue : ""),
      ].join(","),
    );
  }
  if (lines.length === 1) {
    lines.push(["", "", "", "", ""].map(value => formatCsvValue(value)).join(","));
  }
  return lines.join("\n") + "\n";
}

function formatCsvValue(value) {
  const asString = value === null || value === undefined ? "" : String(value);
  if (
    asString.includes(",") ||
    asString.includes("\"") ||
    asString.includes("\n") ||
    asString.includes("\r")
  ) {
    return '"' + asString.replace(/"/g, '""') + '"';
  }
  return asString;
}

export function formatFunnelReport(funnel) {
  if (!funnel || !Array.isArray(funnel.stages) || funnel.stages.length === 0) {
    return 'No analytics data available';
  }
  const lines = funnel.stages.map((stage, index) => formatStageLine(stage, index));
  if (funnel.largestDropOff && funnel.largestDropOff.dropOff > 0) {
    lines.push(
      `Largest drop-off: ${funnel.largestDropOff.fromLabel} → ${funnel.largestDropOff.toLabel} (` +
        `${funnel.largestDropOff.dropOff} lost)`
    );
  } else {
    lines.push('Largest drop-off: none');
  }
  const tracked = funnel.totals?.trackedJobs ?? 0;
  const withEvents = funnel.totals?.withEvents ?? 0;
  lines.push(`Tracked jobs: ${tracked} total; ${withEvents} with outreach events`);
  const missing = funnel.missing?.statuslessJobs;
  if (missing && missing.count > 0) {
    const ids = Array.isArray(missing.ids) ? missing.ids.filter(Boolean) : [];
    const suffix = ids.length > 0 ? ` (${ids.join(', ')})` : '';
    const noun = missing.count === 1 ? 'job' : 'jobs';
    lines.push(
      `Missing data: ${missing.count} ${noun} with outreach but no status recorded${suffix}`,
    );
  }
  return lines.join('\n');
}

function padColumn(value, width) {
  const str = String(value);
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}

export function formatRoleHeatmap(heatmap) {
  const totals = heatmap?.totals ?? {};
  const shortlisted = totals.shortlisted_jobs ?? 0;
  const withLevel = totals.with_level ?? 0;
  const withLocation = totals.with_location ?? 0;
  const withBoth = totals.with_both ?? 0;
  const summaryLine =
    `Role/location heatmap (${shortlisted} shortlisted; ${withLevel} with level; ` +
    `${withLocation} with location; ${withBoth} with both)`;

  const levels = Array.isArray(heatmap?.levels) ? heatmap.levels : [];
  const locations = Array.isArray(heatmap?.locations) ? heatmap.locations : [];
  const matrix = Array.isArray(heatmap?.matrix) ? heatmap.matrix : [];
  const locationTotals = heatmap?.location_totals ?? {};
  const lines = [summaryLine];

  if (levels.length === 0 || locations.length === 0 || matrix.length === 0) {
    lines.push('No level or location metadata recorded in the shortlist.');
  } else {
    const columns = ['Level/Location', ...locations, 'Total'];
    const widths = columns.map(col => col.length);

    for (const row of matrix) {
      const level = typeof row?.level === 'string' ? row.level : 'Unknown';
      widths[0] = Math.max(widths[0], level.length);
      const counts = row?.counts ?? {};
      locations.forEach((location, index) => {
        const value = counts[location] ?? 0;
        widths[index + 1] = Math.max(widths[index + 1], String(value).length);
      });
      widths[widths.length - 1] = Math.max(
        widths[widths.length - 1],
        String(row?.total ?? 0).length,
      );
    }

    locations.forEach((location, index) => {
      widths[index + 1] = Math.max(
        widths[index + 1],
        String(locationTotals?.[location] ?? 0).length,
      );
    });
    widths[widths.length - 1] = Math.max(
      widths[widths.length - 1],
      String(withLevel).length,
    );

    lines.push(columns.map((column, index) => padColumn(column, widths[index])).join(' | '));
    lines.push(
      widths
        .map(width => padColumn('-'.repeat(Math.min(width, 40)), width))
        .join('-+-'),
    );

    for (const row of matrix) {
      const counts = row?.counts ?? {};
      const cells = [
        padColumn(row?.level ?? 'Unknown', widths[0]),
        ...locations.map((location, index) =>
          padColumn(counts[location] ?? 0, widths[index + 1]),
        ),
        padColumn(row?.total ?? 0, widths[widths.length - 1]),
      ];
      lines.push(cells.join(' | '));
    }

    const totalsRow = [
      padColumn('Totals', widths[0]),
      ...locations.map((location, index) =>
        padColumn(locationTotals?.[location] ?? 0, widths[index + 1]),
      ),
      padColumn(withLevel, widths[widths.length - 1]),
    ];
    lines.push(totalsRow.join(' | '));
  }

  const missing = heatmap?.missing ?? {};
  if (Array.isArray(missing.without_level) && missing.without_level.length > 0) {
    lines.push(`Missing level metadata: ${missing.without_level.join(', ')}`);
  }
  if (
    Array.isArray(missing.without_location) &&
    missing.without_location.length > 0
  ) {
    lines.push(`Missing location metadata: ${missing.without_location.join(', ')}`);
  }

  return lines.join('\n');
}

export async function computeOpportunitySankey() {
  const repo = new OpportunitiesRepo();
  try {
    let events = [];
    const fallbackFile = path.join(resolveDataDir(), 'opportunities', 'events.ndjson');
    if (repo.sqlite) {
      events = collectOpportunityEventsFromRepo(repo);
      if (events.length === 0) {
        const fallbackEvents = await readOpportunityEventsFromFile(fallbackFile);
        if (fallbackEvents.length > 0) {
          events = fallbackEvents;
        }
      }
    } else {
      events = await readOpportunityEventsFromFile(fallbackFile);
      if (events.length === 0) {
        events = collectOpportunityEventsFromRepo(repo);
      }
    }

    return {
      generated_at: new Date().toISOString(),
      edges: computeSankeyEdges(events),
    };
  } finally {
    repo.close();
  }
}

export function formatSankeyReport(report) {
  const edges = Array.isArray(report?.edges) ? report.edges : [];
  if (edges.length === 0) {
    return 'No opportunity events recorded';
  }

  const sorted = edges
    .slice()
    .sort((a, b) => {
      const sourceA = typeof a?.source === 'string' ? a.source : '';
      const sourceB = typeof b?.source === 'string' ? b.source : '';
      const sourceCompare = sourceA.localeCompare(sourceB);
      if (sourceCompare !== 0) return sourceCompare;
      const targetA = typeof a?.target === 'string' ? a.target : '';
      const targetB = typeof b?.target === 'string' ? b.target : '';
      return targetA.localeCompare(targetB);
    });

  return sorted
    .map(edge => {
      const source = typeof edge?.source === 'string' && edge.source.trim()
        ? edge.source.trim()
        : 'unknown';
      const target = typeof edge?.target === 'string' && edge.target.trim()
        ? edge.target.trim()
        : 'unknown';
      const count = Number.isFinite(edge?.count) ? edge.count : 0;
      return `${source} → ${target}: ${count}`;
    })
    .join('\n');
}
