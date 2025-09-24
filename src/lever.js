import fetch from 'node-fetch';
import {
  extractTextFromHtml,
  fetchWithRetry,
  setFetchRateLimit,
  normalizeRateLimitInterval,
} from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { JOB_SOURCE_ADAPTER_VERSION } from './adapters/job-source.js';
import { parseJobText } from './parser.js';

const LEVER_BASE = 'https://api.lever.co/v0/postings';
const LEVER_HEADERS = { 'User-Agent': 'jobbot3000' };
const LEVER_RATE_LIMIT_MS = normalizeRateLimitInterval(
  process.env.JOBBOT_LEVER_RATE_LIMIT_MS,
  500,
);

function normalizeOrgSlug(org) {
  if (!org || typeof org !== 'string' || !org.trim()) {
    throw new Error('Lever org slug is required');
  }
  return org.trim();
}

function buildOrgUrl(slug) {
  return `${LEVER_BASE}/${encodeURIComponent(slug)}?mode=json`;
}

function resolveHostedUrl(job, slug) {
  const fromJob = typeof job.hostedUrl === 'string' ? job.hostedUrl.trim() : '';
  if (fromJob) return fromJob;
  const jobId = typeof job.id === 'string' && job.id.trim() ? job.id.trim() : String(job.id ?? '');
  if (jobId) return `https://jobs.lever.co/${slug}/${jobId}`;
  return `https://jobs.lever.co/${slug}`;
}

function extractRawDescription(job) {
  const plain = typeof job.descriptionPlain === 'string' ? job.descriptionPlain.trim() : '';
  if (plain) return plain;
  const html = typeof job.description === 'string' ? job.description : '';
  if (html && html.trim()) return extractTextFromHtml(html);
  const fallback = typeof job.text === 'string' ? job.text.trim() : '';
  return fallback;
}

function extractLocation(job) {
  const loc = job?.categories?.location;
  return typeof loc === 'string' ? loc.trim() : '';
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  const title = typeof job.text === 'string' ? job.text.trim() : '';
  if (!merged.title && title) merged.title = title;
  const location = extractLocation(job);
  if (!merged.location && location) merged.location = location;
  return merged;
}

export async function fetchLeverJobs(org, { fetchImpl = fetch, retry } = {}) {
  const slug = normalizeOrgSlug(org);
  const url = buildOrgUrl(slug);
  const rateLimitKey = `lever:${slug}`;
  if (LEVER_RATE_LIMIT_MS > 0) {
    setFetchRateLimit(rateLimitKey, LEVER_RATE_LIMIT_MS);
  } else {
    setFetchRateLimit(rateLimitKey, 0);
  }
  const response = await fetchWithRetry(url, {
    fetchImpl,
    headers: LEVER_HEADERS,
    retry,
    rateLimitKey,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Lever org ${slug}: ${response.status} ${response.statusText}`);
  }
  const jobs = await response.json();
  return { slug, jobs: Array.isArray(jobs) ? jobs : [] };
}

function toLeverSnapshot(job, slug) {
  if (!slug) {
    throw new Error('Lever org slug is required for snapshot normalization');
  }
  const hostedUrl = resolveHostedUrl(job, slug);
  const raw = extractRawDescription(job);
  const parsed = mergeParsedJob(parseJobText(raw), job);
  const id = jobIdFromSource({ provider: 'lever', url: hostedUrl });
  return {
    id,
    raw,
    parsed,
    source: { type: 'lever', value: hostedUrl },
    requestHeaders: LEVER_HEADERS,
    fetchedAt: job.updatedAt ?? job.createdAt,
  };
}

export const leverAdapter = {
  provider: 'lever',
  version: JOB_SOURCE_ADAPTER_VERSION,
  async listOpenings({ org, fetchImpl = fetch, retry } = {}) {
    const result = await fetchLeverJobs(org, { fetchImpl, retry });
    return {
      jobs: result.jobs,
      context: { slug: result.slug },
    };
  },
  normalizeJob(job, context = {}) {
    const slug = context.slug || context.org;
    return toLeverSnapshot(job, slug);
  },
  toApplicationEvent() {
    return null;
  },
};

export async function ingestLeverBoard({ org, fetchImpl = fetch, retry } = {}) {
  const { jobs, context } = await leverAdapter.listOpenings({ org, fetchImpl, retry });
  const jobIds = [];

  for (const job of jobs) {
    const snapshot = leverAdapter.normalizeJob(job, context);
    await saveJobSnapshot(snapshot);
    jobIds.push(snapshot.id);
  }

  return { org: context.slug, saved: jobIds.length, jobIds };
}
