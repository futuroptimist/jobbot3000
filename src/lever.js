import fetch from 'node-fetch';
import { extractTextFromHtml, fetchWithRetry } from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const LEVER_BASE = 'https://api.lever.co/v0/postings';
const LEVER_HEADERS = { 'User-Agent': 'jobbot3000' };
const LEVER_RATE_LIMIT_MS = 250;

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

export async function fetchLeverJobs(
  org,
  { fetchImpl = fetch, retry, rateLimitIntervalMs = LEVER_RATE_LIMIT_MS } = {}
) {
  const slug = normalizeOrgSlug(org);
  const url = buildOrgUrl(slug);
  const response = await fetchWithRetry(url, {
    fetchImpl,
    headers: LEVER_HEADERS,
    retry,
    rateLimitKey: `lever:${slug}`,
    rateLimitIntervalMs,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Lever org ${slug}: ${response.status} ${response.statusText}`);
  }
  const jobs = await response.json();
  return { slug, jobs: Array.isArray(jobs) ? jobs : [] };
}

export async function ingestLeverBoard({
  org,
  fetchImpl = fetch,
  retry,
  rateLimitIntervalMs,
} = {}) {
  const { slug, jobs } = await fetchLeverJobs(org, { fetchImpl, retry, rateLimitIntervalMs });
  const jobIds = [];

  for (const job of jobs) {
    const hostedUrl = resolveHostedUrl(job, slug);
    const raw = extractRawDescription(job);
    const parsed = mergeParsedJob(parseJobText(raw), job);
    const id = jobIdFromSource({ provider: 'lever', url: hostedUrl });
    await saveJobSnapshot({
      id,
      raw,
      parsed,
      source: { type: 'lever', value: hostedUrl },
      requestHeaders: LEVER_HEADERS,
      fetchedAt: job.updatedAt ?? job.createdAt,
    });
    jobIds.push(id);
  }

  return { org: slug, saved: jobIds.length, jobIds };
}
