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

const AGGREGATE_PROVIDER_ID = 'all';
const DEFAULT_AGGREGATE_SOURCES = Object.freeze([
  { provider: 'greenhouse', identifier: 'acme-co' },
  { provider: 'lever', identifier: 'acme' },
  { provider: 'ashby', identifier: 'acme' },
  { provider: 'smartrecruiters', identifier: 'acme' },
  { provider: 'workable', identifier: 'acme' },
]);

const BASE_PROVIDERS = Object.freeze({
  greenhouse: {
    id: 'greenhouse',
    label: 'Greenhouse',
    adapter: greenhouseAdapter,
    identifierKey: 'board',
    identifierLabel: 'Board slug',
    placeholder: 'acme-co',
    requiresIdentifier: true,
  },
  lever: {
    id: 'lever',
    label: 'Lever',
    adapter: leverAdapter,
    identifierKey: 'org',
    identifierLabel: 'Org slug',
    placeholder: 'acme',
    requiresIdentifier: true,
  },
  ashby: {
    id: 'ashby',
    label: 'Ashby',
    adapter: ashbyAdapter,
    identifierKey: 'org',
    identifierLabel: 'Org slug',
    placeholder: 'acme',
    requiresIdentifier: true,
  },
  smartrecruiters: {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    adapter: smartRecruitersAdapter,
    identifierKey: 'company',
    identifierLabel: 'Company slug',
    placeholder: 'acme',
    requiresIdentifier: true,
  },
  workable: {
    id: 'workable',
    label: 'Workable',
    adapter: workableAdapter,
    identifierKey: 'account',
    identifierLabel: 'Account slug',
    placeholder: 'acme',
    requiresIdentifier: true,
  },
});

const AGGREGATE_PROVIDER = Object.freeze({
  id: AGGREGATE_PROVIDER_ID,
  label: 'All providers',
  aggregate: true,
  identifierKey: null,
  identifierLabel: 'Saved sources',
  placeholder: '',
  requiresIdentifier: false,
});

const PROVIDERS = Object.freeze({
  [AGGREGATE_PROVIDER_ID]: AGGREGATE_PROVIDER,
  ...BASE_PROVIDERS,
});

function isAggregateProvider(provider) {
  return Boolean(provider && provider.aggregate === true);
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeAggregateSources(rawSources) {
  if (!Array.isArray(rawSources)) {
    return [];
  }
  const normalized = [];
  const seen = new Set();
  for (const entry of rawSources) {
    if (!entry || typeof entry !== 'object') continue;
    const providerId = sanitizeString(entry.provider).toLowerCase();
    if (!providerId || !BASE_PROVIDERS[providerId]) continue;
    const identifier = sanitizeString(entry.identifier);
    if (!identifier) continue;
    const limit =
      Number.isFinite(entry.limit) && entry.limit > 0 ? Math.trunc(entry.limit) : undefined;
    const key = `${providerId}:${identifier}:${limit ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ provider: providerId, identifier, limit });
  }
  return normalized;
}

async function loadAggregateSources() {
  const overridePath = path.join(resolveDataDir(), 'listings', 'sources.json');
  const fallbackPath = path.resolve('config', 'listings', 'sources.json');
  const overrideSources = await readJsonFile(overridePath);
  if (overrideSources) {
    const normalized = normalizeAggregateSources(overrideSources);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  const fallbackSources = await readJsonFile(fallbackPath);
  const normalizedFallback = normalizeAggregateSources(
    fallbackSources ?? DEFAULT_AGGREGATE_SOURCES,
  );
  if (normalizedFallback.length > 0) {
    return normalizedFallback;
  }
  return normalizeAggregateSources(DEFAULT_AGGREGATE_SOURCES);
}

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function sanitizeString(value) {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.trim();
}

function ensureProvider(provider, { allowAggregate = false } = {}) {
  const key = sanitizeString(provider).toLowerCase();
  const entry = PROVIDERS[key];
  if (!entry) {
    throw new Error(`Unsupported listings provider: ${provider}`);
  }
  if (isAggregateProvider(entry) && !allowAggregate) {
    throw new Error('Aggregate listings provider cannot be used for this operation');
  }
  return entry;
}

export function listListingProviders() {
  const orderedProviders = [AGGREGATE_PROVIDER, ...Object.values(BASE_PROVIDERS)];
  return orderedProviders.map(provider => ({
    id: provider.id,
    label: provider.label,
    identifierKey: provider.identifierKey,
    identifierLabel: provider.identifierLabel,
    placeholder: provider.placeholder,
    requiresIdentifier: provider.requiresIdentifier !== false,
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

function normalizeIdentifier(value) {
  const identifier = sanitizeString(value);
  return identifier; // optional; empty string means unknown
}

async function normalizeSnapshot(adapter, job, context) {
  const normalizedContext = context && typeof context === 'object' ? { ...context } : {};
  return adapter.normalizeJob(job, normalizedContext);
}

function coerceFilters({ location, title, team, department, remote }) {
  const filters = {};
  if (location !== undefined) filters.location = location;
  if (title !== undefined) filters.title = title;
  if (team !== undefined) {
    filters.team = team;
  } else if (department !== undefined) {
    filters.team = department;
  }
  if (remote !== undefined) filters.remote = remote;
  return filters;
}

async function collectListingStatusSets() {
  const [existingIds, archivedIds] = await Promise.all([
    listExistingJobIds(),
    listArchivedJobIds(),
  ]);
  return {
    existingIds: existingIds instanceof Set ? existingIds : new Set(existingIds ?? []),
    archivedIds: archivedIds instanceof Set ? archivedIds : new Set(archivedIds ?? []),
  };
}

function applyListingState(listings, { existingIds, archivedIds }) {
  const ingestedIds = existingIds ?? new Set();
  const archived = archivedIds ?? new Set();
  return listings.map(listing => ({
    ...listing,
    ingested: ingestedIds.has(listing.jobId),
    archived: archived.has(listing.jobId),
  }));
}

async function loadProviderSummaries(providerEntry, options = {}) {
  const targetIdentifier = normalizeIdentifier(options.identifier);
  if (!targetIdentifier) {
    return { identifier: '', summaries: [] };
  }
  const args = { [providerEntry.identifierKey]: targetIdentifier };
  const { jobs, context } = await providerEntry.adapter.listOpenings(args);
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
      summaries.push(summary);
    } catch {
      // Skip jobs that fail to normalize so one bad posting doesn't break the listing.
    }
  }
  const filters = coerceFilters(options);
  const filtered = filterListings(summaries, filters);
  return { identifier: targetIdentifier, summaries: filtered };
}

function limitListings(listings, limit) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return listings;
  }
  return listings.slice(0, Math.trunc(limit));
}

function toTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function sortListingsByRecency(listings) {
  return listings
    .slice()
    .sort((a, b) => {
      const aTime = toTimestamp(a?.posted_at);
      const bTime = toTimestamp(b?.posted_at);
      if (aTime && bTime) {
        return bTime - aTime;
      }
      if (aTime) return -1;
      if (bTime) return 1;
      const aTitle = sanitizeString(a?.title);
      const bTitle = sanitizeString(b?.title);
      return aTitle.localeCompare(bTitle);
    });
}

async function buildProviderListings(providerEntry, options, statusSets) {
  const { identifier, summaries } = await loadProviderSummaries(providerEntry, options);
  if (!identifier) {
    return {
      provider: providerEntry.id,
      identifier: '',
      listings: [],
      total: 0,
      allListings: [],
    };
  }
  const listingsWithState = applyListingState(summaries, statusSets);
  const total = listingsWithState.length;
  const limited = limitListings(listingsWithState, options.limit);
  return {
    provider: providerEntry.id,
    identifier,
    listings: limited,
    total,
    allListings: listingsWithState,
  };
}

export async function fetchListings(options = {}) {
  const providerEntry = ensureProvider(options.provider, { allowAggregate: true });
  const limit =
    Number.isFinite(options.limit) && options.limit > 0 ? Math.trunc(options.limit) : undefined;
  const statusSets = await collectListingStatusSets();

  if (isAggregateProvider(providerEntry)) {
    const sources = await loadAggregateSources();
    if (sources.length === 0) {
      return {
        provider: providerEntry.id,
        identifier: '',
        fetched_at: new Date().toISOString(),
        total: 0,
        listings: [],
      };
    }

    const aggregated = [];
    const seen = new Set();
    for (const source of sources) {
      try {
        const sourceProvider = ensureProvider(source.provider);
        const result = await buildProviderListings(
          sourceProvider,
          {
            ...options,
            provider: source.provider,
            identifier: source.identifier,
            limit:
              Number.isFinite(source.limit) && source.limit > 0
                ? Math.trunc(source.limit)
                : undefined,
          },
          statusSets,
        );
        for (const listing of result.allListings) {
          if (!listing || typeof listing !== 'object') continue;
          if (!listing.jobId) continue;
          if (seen.has(listing.jobId)) continue;
          seen.add(listing.jobId);
          aggregated.push(listing);
        }
      } catch {
        // Skip failing sources so one misconfigured provider does not block aggregation.
      }
    }

    const sorted = sortListingsByRecency(aggregated);
    const limitedResults = limitListings(sorted, limit);
    return {
      provider: providerEntry.id,
      identifier: '',
      fetched_at: new Date().toISOString(),
      total: sorted.length,
      listings: limitedResults,
    };
  }

  const result = await buildProviderListings(
    providerEntry,
    {
      ...options,
      identifier: options.identifier,
      limit,
    },
    statusSets,
  );

  return {
    provider: providerEntry.id,
    identifier: result.identifier,
    fetched_at: new Date().toISOString(),
    total: result.total,
    listings: result.listings,
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

