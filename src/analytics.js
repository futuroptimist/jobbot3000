import fs from 'node:fs/promises';
import path from 'node:path';

import { STATUSES } from './lifecycle.js';

let overrideDir;

const KNOWN_STATUSES = new Set(STATUSES.map(status => status.toLowerCase()));
const CURRENCY_SYMBOL_PREFIX_RE = /^\p{Sc}+/u;
const ADDITIONAL_CURRENCY_SYMBOL_RE = /\p{Sc}/gu;
const COMPENSATION_VALUE_RE = /(\d+(?:[.,]\d+)?)(?:\s*(k|m|b))?/gi;
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

export async function computeFunnel() {
  const { statuses, interactions } = await readAnalyticsSources();
  return buildFunnel(statuses, interactions);
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

export async function exportAnalyticsSnapshot() {
  const { statuses, interactions } = await readAnalyticsSources();
  const activity = await summarizeActivity();
  const funnel = buildFunnel(statuses, interactions);
  const statusCounts = getStatusCounts(statuses);
  const statusTotals = {};
  for (const status of STATUSES) {
    statusTotals[status] = statusCounts.get(status) ?? 0;
  }

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
  };
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
