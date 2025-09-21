import fs from 'node:fs/promises';
import path from 'node:path';

let overrideDir;

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

function countJobsWithEvents(events) {
  let count = 0;
  for (const history of Object.values(events)) {
    if (Array.isArray(history) && history.length > 0) {
      count += 1;
    }
  }
  return count;
}

function getStatusCounts(statuses) {
  const counts = new Map();
  for (const value of Object.values(statuses)) {
    if (typeof value !== 'string') continue;
    const key = value.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
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
    if (typeof rawStatus !== 'string') continue;
    const status = rawStatus.trim().toLowerCase();
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

export async function computeFunnel() {
  const { applications, events } = getPaths();
  const [statuses, interactions] = await Promise.all([
    readJsonFile(applications),
    readJsonFile(events),
  ]);

  const statusCounts = getStatusCounts(statuses);
  const withEvents = countJobsWithEvents(interactions);
  const acceptedJobs = collectAcceptanceJobs(statuses, interactions);
  const trackedJobs = unionJobIds(statuses, interactions).size;

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
  };
}

function formatStageLine(stage, index) {
  const base = `${stage.label}: ${stage.count}`;
  if (index === 0) return base;
  const percent = roundPercent(stage.conversionRate);
  const percentLabel = percent === undefined ? 'n/a' : `${percent}%`;
  const dropSuffix = stage.dropOff > 0 ? `, ${stage.dropOff} drop-off` : '';
  return `${base} (${percentLabel} conversion${dropSuffix})`;
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
  return lines.join('\n');
}
