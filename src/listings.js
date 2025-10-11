import fs from 'node:fs/promises';
import path from 'node:path';

import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { smartRecruitersAdapter } from './smartrecruiters.js';
import { workableAdapter } from './workable.js';
import { saveJobSnapshot } from './jobs.js';
import { syncShortlistJob, addJobTags } from './shortlist.js';
import { getLifecycleEntry, recordApplication } from './lifecycle.js';
import { getDiscardedJobs, recordJobDiscard } from './discards.js';

const PROVIDERS = Object.freeze({
  greenhouse: {
    id: 'greenhouse',
    label: 'Greenhouse',
    adapter: greenhouseAdapter,
    identifierKey: 'board',
    identifierLabel: 'Board slug',
    placeholder: 'acme-co',
  },
  lever: {
    id: 'lever',
    label: 'Lever',
    adapter: leverAdapter,
    identifierKey: 'org',
    identifierLabel: 'Org slug',
    placeholder: 'acme',
  },
  ashby: {
    id: 'ashby',
    label: 'Ashby',
    adapter: ashbyAdapter,
    identifierKey: 'org',
    identifierLabel: 'Org slug',
    placeholder: 'acme',
  },
  smartrecruiters: {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    adapter: smartRecruitersAdapter,
    identifierKey: 'company',
    identifierLabel: 'Company slug',
    placeholder: 'acme',
  },
  workable: {
    id: 'workable',
    label: 'Workable',
    adapter: workableAdapter,
    identifierKey: 'account',
    identifierLabel: 'Account slug',
    placeholder: 'acme',
  },
});

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function sanitizeString(value) {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.trim();
}

function ensureProvider(provider) {
  const key = sanitizeString(provider).toLowerCase();
  const entry = PROVIDERS[key];
  if (!entry) {
    throw new Error(`Unsupported listings provider: ${provider}`);
  }
  return entry;
}

export function listListingProviders() {
  return Object.values(PROVIDERS).map(provider => ({
    id: provider.id,
    label: provider.label,
    identifierKey: provider.identifierKey,
    identifierLabel: provider.identifierLabel,
    placeholder: provider.placeholder,
  }));
}

async function listExistingJobIds() {
  const jobsDir = path.join(resolveDataDir(), 'jobs');
  try {
    const entries = await fs.readdir(jobsDir, { withFileTypes: true });
    const ids = new Set();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      ids.add(entry.name.slice(0, -5));
    }
    return ids;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return new Set();
    }
    throw err;
  }
}

async function listArchivedJobIds() {
  const archive = await getDiscardedJobs();
  const archived = new Set();
  const entries = archive && typeof archive === 'object' ? Object.entries(archive) : [];
  for (const [jobId, history] of entries) {
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      if (!entry || typeof entry !== 'object') continue;
      const reason = sanitizeString(entry.reason).toLowerCase();
      if (reason.includes('archive')) {
        archived.add(jobId);
        break;
      }
      if (Array.isArray(entry.tags)) {
        for (const tag of entry.tags) {
          if (sanitizeString(tag).toLowerCase() === 'archived') {
            archived.add(jobId);
            break;
          }
        }
        if (archived.has(jobId)) break;
      }
    }
  }
  return archived;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function createSnippet(text, maxLength = 320) {
  const source = sanitizeString(text);
  if (!source) return '';
  if (source.length <= maxLength) return source;
  return `${source.slice(0, maxLength - 1)}…`;
}

function detectRemoteFlag({ location, job }) {
  const sources = [];
  if (location) sources.push(location);
  if (job && typeof job === 'object') {
    const candidates = [
      job.remote,
      job.isRemote,
      job.workplaceType,
      job.workplace_type,
      job.workplace,
      job.location,
      job.location?.name,
      job.locations,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        sources.push(candidate);
      } else if (Array.isArray(candidate)) {
        for (const value of candidate) {
          if (typeof value === 'string') sources.push(value);
        }
      }
    }
  }
  const joined = sources
    .map(value => sanitizeString(value).toLowerCase())
    .filter(Boolean)
    .join(' ');
  if (!joined) return false;
  return /remote|distributed|anywhere/i.test(joined);
}

function normalizeRequirements(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const list = Array.isArray(parsed.requirements) ? parsed.requirements : [];
  return list
    .map(item => sanitizeString(item))
    .filter(Boolean)
    .slice(0, 8);
}

function buildListingSummary({ provider, identifier, snapshot, job, context }) {
  const parsed = snapshot?.parsed && typeof snapshot.parsed === 'object' ? snapshot.parsed : {};
  const rawBody = typeof parsed.body === 'string' ? parsed.body : snapshot?.raw;
  const title = sanitizeString(parsed.title) || sanitizeString(job?.title) || 'Untitled role';
  const company =
    sanitizeString(parsed.company) || sanitizeString(context?.slug) || sanitizeString(identifier);
  const location =
    sanitizeString(parsed.location) ||
    sanitizeString(job?.location?.name) ||
    sanitizeString(job?.location);
  const team =
    sanitizeString(parsed.team) ||
    sanitizeString(job?.department) ||
    sanitizeString(job?.departments);
  const compensation = sanitizeString(parsed.compensation);
  const requirements = normalizeRequirements(parsed);
  const remote = detectRemoteFlag({ location, job });
  const snippet = createSnippet(rawBody);
  const postedAt =
    sanitizeString(job?.updated_at ?? job?.updatedAt ?? job?.created_at ?? job?.createdAt) ||
    sanitizeString(snapshot?.fetchedAt);

  const metadata = {};
  if (location) metadata.location = location;
  if (compensation) metadata.compensation = compensation;

  return {
    jobId: snapshot.id,
    provider,
    identifier,
    title,
    company,
    location,
    team,
    compensation,
    remote,
    url: snapshot?.source?.value || '',
    snippet,
    requirements,
    posted_at: postedAt || null,
    metadata,
  };
}

function matchesFilter(value, filter) {
  const candidate = sanitizeString(value).toLowerCase();
  const target = sanitizeString(filter).toLowerCase();
  if (!target) return true;
  return candidate.includes(target);
}

function filterListings(listings, filters = {}) {
  if (!filters || Object.keys(filters).length === 0) {
    return listings;
  }
  const locationFilter = sanitizeString(filters.location);
  const titleFilter = sanitizeString(filters.title);
  const teamFilter = sanitizeString(filters.team ?? filters.department);
  const remoteFilter = toBoolean(filters.remote);

  return listings.filter(listing => {
    if (locationFilter && !matchesFilter(listing.location, locationFilter)) {
      return false;
    }
    if (titleFilter && !matchesFilter(listing.title, titleFilter)) {
      return false;
    }
    if (teamFilter && !matchesFilter(listing.team, teamFilter)) {
      return false;
    }
    if (remoteFilter !== undefined && listing.remote !== remoteFilter) {
      return false;
    }
    return true;
  });
}

function normalizeIdentifier(value, provider) {
  const identifier = sanitizeString(value);
  if (!identifier) {
    throw new Error(`A ${provider.identifierLabel.toLowerCase()} is required`);
  }
  return identifier;
}

async function normalizeSnapshot(adapter, job, context) {
  const normalizedContext = context && typeof context === 'object' ? { ...context } : {};
  return adapter.normalizeJob(job, normalizedContext);
}

export async function fetchListings({
  provider,
  identifier,
  location,
  title,
  team,
  department,
  remote,
  limit,
} = {}) {
  const providerEntry = ensureProvider(provider);
  const targetIdentifier = normalizeIdentifier(identifier, providerEntry);
  const args = { [providerEntry.identifierKey]: targetIdentifier };
  const { jobs, context } = await providerEntry.adapter.listOpenings(args);
  const existingIdsPromise = listExistingJobIds();
  const archivedIdsPromise = listArchivedJobIds();

  const summaries = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    try {
      const snapshot = await normalizeSnapshot(providerEntry.adapter, job, context);
      const summary = buildListingSummary({
        provider: providerEntry.id,
        identifier: targetIdentifier,
        snapshot,
        job,
        context,
      });
      summary.jobId = snapshot.id;
      summaries.push({ summary, snapshot });
    } catch {
      // Skip jobs that fail to normalize so one bad posting doesn't break the listing.
    }
  }

  const filtered = filterListings(
    summaries.map(entry => entry.summary),
    { location, title, team: team ?? department, remote },
  );

  const limited = Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered;
  const [existingIds, archivedIds] = await Promise.all([existingIdsPromise, archivedIdsPromise]);

  const listings = limited.map(summary => ({
    ...summary,
    ingested: existingIds.has(summary.jobId),
    archived: archivedIds.has(summary.jobId),
  }));

  return {
    provider: providerEntry.id,
    identifier: targetIdentifier,
    fetched_at: new Date().toISOString(),
    total: filtered.length,
    listings,
  };
}

function buildShortlistMetadata(metadata = {}) {
  const normalized = {};
  if (metadata.location) normalized.location = metadata.location;
  if (metadata.compensation) normalized.compensation = metadata.compensation;
  return normalized;
}

async function ensureLifecycleTracking(jobId) {
  const existing = await getLifecycleEntry(jobId);
  if (existing) return existing;
  await recordApplication(jobId, 'no_response', {
    note: 'Listing ingested via web interface',
    date: new Date().toISOString(),
  });
  return getLifecycleEntry(jobId);
}

export async function ingestListing({ provider, identifier, jobId } = {}) {
  const providerEntry = ensureProvider(provider);
  const targetIdentifier = normalizeIdentifier(identifier, providerEntry);
  const desiredJobId = sanitizeString(jobId);
  if (!desiredJobId) {
    throw new Error('A listing jobId is required for ingestion');
  }

  const args = { [providerEntry.identifierKey]: targetIdentifier };
  const { jobs, context } = await providerEntry.adapter.listOpenings(args);

  let matchedSnapshot = null;
  let matchedSummary = null;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    let snapshot;
    try {
      snapshot = await normalizeSnapshot(providerEntry.adapter, job, context);
    } catch {
      continue;
    }
    if (snapshot.id !== desiredJobId) {
      continue;
    }
    matchedSnapshot = snapshot;
    matchedSummary = buildListingSummary({
      provider: providerEntry.id,
      identifier: targetIdentifier,
      snapshot,
      job,
      context,
    });
    break;
  }

  if (!matchedSnapshot || !matchedSummary) {
    throw new Error('Listing could not be located for ingestion');
  }

  await saveJobSnapshot(matchedSnapshot);
  await syncShortlistJob(matchedSnapshot.id, buildShortlistMetadata(matchedSummary.metadata));
  await addJobTags(matchedSnapshot.id, ['listing', providerEntry.id]);
  await ensureLifecycleTracking(matchedSnapshot.id);

  return {
    jobId: matchedSnapshot.id,
    listing: {
      ...matchedSummary,
      ingested: true,
      archived: false,
    },
  };
}

export async function archiveListing({ jobId, reason } = {}) {
  const normalizedId = sanitizeString(jobId);
  if (!normalizedId) {
    throw new Error('jobId is required to archive a listing');
  }
  const archiveReason = sanitizeString(reason) || 'Archived listing';
  const entry = await recordJobDiscard(normalizedId, {
    reason: archiveReason,
    tags: ['archived'],
    date: new Date().toISOString(),
  });
  return { jobId: normalizedId, archived_at: entry.discarded_at, reason: entry.reason };
}

