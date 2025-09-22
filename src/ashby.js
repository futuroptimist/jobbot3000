import fetch from 'node-fetch';
import {
  extractTextFromHtml,
  fetchWithRetry,
  setFetchRateLimit,
  normalizeRateLimitInterval,
} from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const ASHBY_BASE = 'https://jobs.ashbyhq.com/api/postings';

const ASHBY_HEADERS = {
  'User-Agent': 'jobbot3000',
  Accept: 'application/json',
};
const ASHBY_RATE_LIMIT_MS = normalizeRateLimitInterval(
  process.env.JOBBOT_ASHBY_RATE_LIMIT_MS,
  500,
);

function normalizeOrgSlug(org) {
  if (!org || typeof org !== 'string' || !org.trim()) {
    throw new Error('Ashby org slug is required');
  }
  return org.trim();
}

function buildOrgUrl(slug) {
  const params = new URLSearchParams({
    organizationSlug: slug,
    includeCompensation: 'true',
    includeUnlisted: 'false',
  });
  return `${ASHBY_BASE}?${params.toString()}`;
}

function deriveJobUrl(job, slug) {
  const fromJob = typeof job.jobPostingUrl === 'string' ? job.jobPostingUrl.trim() : '';
  if (fromJob) return fromJob;
  const jobId = typeof job.id === 'string' && job.id.trim() ? job.id.trim() : '';
  if (jobId) return `https://jobs.ashbyhq.com/${slug}/job/${jobId}`;
  return `https://jobs.ashbyhq.com/${slug}`;
}

function selectRawDescription(job) {
  const text = typeof job.descriptionText === 'string' ? job.descriptionText.trim() : '';
  if (text) return text;
  const html = typeof job.descriptionHtml === 'string' ? job.descriptionHtml : '';
  if (html && html.trim()) return extractTextFromHtml(html);
  const summary = typeof job.summary === 'string' ? job.summary.trim() : '';
  return summary;
}

function extractLocation(job) {
  const location = typeof job.locationName === 'string' ? job.locationName.trim() : '';
  if (location) return location;
  const secondary = Array.isArray(job?.secondaryLocations) ? job.secondaryLocations : [];
  for (const entry of secondary) {
    if (entry && typeof entry.name === 'string' && entry.name.trim()) {
      return entry.name.trim();
    }
  }
  return '';
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  const title = typeof job.title === 'string' ? job.title.trim() : '';
  if (!merged.title && title) merged.title = title;
  const location = extractLocation(job);
  if (!merged.location && location) merged.location = location;
  const employmentType = typeof job.employmentType === 'string' ? job.employmentType.trim() : '';
  if (employmentType) merged.employmentType = employmentType;
  const workplaceType = typeof job.workplaceType === 'string' ? job.workplaceType.trim() : '';
  if (workplaceType) merged.workplaceType = workplaceType;
  return merged;
}

export async function fetchAshbyJobs(org, { fetchImpl = fetch, retry } = {}) {
  const slug = normalizeOrgSlug(org);
  const url = buildOrgUrl(slug);
  const rateLimitKey = `ashby:${slug}`;
  if (ASHBY_RATE_LIMIT_MS > 0) {
    setFetchRateLimit(rateLimitKey, ASHBY_RATE_LIMIT_MS);
  } else {
    setFetchRateLimit(rateLimitKey, 0);
  }
  const response = await fetchWithRetry(url, {
    fetchImpl,
    headers: ASHBY_HEADERS,
    retry,
    rateLimitKey,
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Ashby org ${slug}: ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  const jobPostings = Array.isArray(payload?.jobPostings) ? payload.jobPostings : [];
  return { slug, jobPostings };
}

export async function ingestAshbyBoard({ org, fetchImpl = fetch, retry } = {}) {
  const { slug, jobPostings } = await fetchAshbyJobs(org, { fetchImpl, retry });
  const jobIds = [];

  for (const job of jobPostings) {
    const jobUrl = deriveJobUrl(job, slug);
    const raw = selectRawDescription(job);
    const parsed = mergeParsedJob(parseJobText(raw), job);
    const id = jobIdFromSource({ provider: 'ashby', url: jobUrl });
    await saveJobSnapshot({
      id,
      raw,
      parsed,
      source: { type: 'ashby', value: jobUrl },
      requestHeaders: ASHBY_HEADERS,
      fetchedAt: job.updatedAt ?? job.publishedDate,
    });
    jobIds.push(id);
  }

  return { org: slug, saved: jobIds.length, jobIds };
}
