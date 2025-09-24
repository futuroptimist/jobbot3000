import fetch from 'node-fetch';
import { extractTextFromHtml } from './fetch.js';
import { httpRequest, DEFAULT_HTTP_HEADERS, normalizeRateLimitInterval } from './services/http.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const WORKABLE_BASE = 'https://www.workable.com/api/accounts';
const WORKABLE_BASE_HEADERS = Object.freeze({ Accept: 'application/json' });
const WORKABLE_RATE_LIMIT_MS = normalizeRateLimitInterval(
  process.env.JOBBOT_WORKABLE_RATE_LIMIT_MS,
  500,
);

function sanitizeString(value) {
  if (value == null) return '';
  const trimmed = String(value).trim();
  return trimmed;
}

function normalizeToken(value) {
  if (value === undefined) return undefined;
  const trimmed = sanitizeString(value);
  return trimmed ? trimmed : undefined;
}

function getWorkableToken(explicitToken) {
  if (explicitToken !== undefined) return normalizeToken(explicitToken);
  return normalizeToken(process.env.JOBBOT_WORKABLE_TOKEN);
}

function buildWorkableHeaders(explicitToken) {
  const token = getWorkableToken(explicitToken);
  if (!token) return { ...WORKABLE_BASE_HEADERS };
  return { ...WORKABLE_BASE_HEADERS, Authorization: `Bearer ${token}` };
}

function sanitizeHeadersForSnapshot(headers) {
  const sanitized = { ...DEFAULT_HTTP_HEADERS };
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function normalizeAccountSlug(account) {
  const slug = sanitizeString(account);
  if (!slug) {
    throw new Error('Workable account slug is required');
  }
  return slug;
}

function buildJobsUrl(slug) {
  return `${WORKABLE_BASE}/${encodeURIComponent(slug)}/jobs`;
}

function resolveShortcode(job) {
  const direct = sanitizeString(job?.shortcode);
  if (direct) return direct;
  const id = sanitizeString(job?.id);
  if (id) return id;
  throw new Error('Workable job shortcode is required');
}

function buildJobDetailUrl(slug, shortcode) {
  return `${WORKABLE_BASE}/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(shortcode)}`;
}

function toPlainText(value) {
  const str = sanitizeString(value);
  if (!str) return '';
  return extractTextFromHtml(str);
}

function appendPlain(parts, value) {
  const text = toPlainText(value);
  if (text) parts.push(text);
}

function collectSectionText(sections) {
  if (!sections) return [];
  const parts = [];
  const entries = Array.isArray(sections)
    ? sections
    : typeof sections === 'object'
      ? Object.values(sections)
      : [];
  for (const section of entries) {
    if (!section || typeof section !== 'object') continue;
    const title = sanitizeString(section.title);
    if (title) parts.push(title);
    appendPlain(parts, section.content ?? section.description ?? section.body);
  }
  return parts;
}

function gatherDetailText(detail, job) {
  const parts = [];
  const fields = [
    detail?.full_description,
    detail?.description,
    detail?.description_html,
    detail?.descriptionRaw,
    detail?.requirements,
    detail?.benefits,
    job?.full_description,
    job?.description,
    job?.description_html,
  ];
  for (const field of fields) {
    appendPlain(parts, field);
  }
  parts.push(...collectSectionText(detail?.sections));
  parts.push(...collectSectionText(detail?.content?.sections));
  if (!parts.length) {
    appendPlain(parts, detail?.summary);
    appendPlain(parts, job?.summary);
  }
  return parts.filter(Boolean).join('\n\n');
}

function extractLocation(detail, job) {
  const attempt = (candidate) => {
    if (!candidate) return '';
    if (typeof candidate === 'string') return sanitizeString(candidate);
    if (typeof candidate.location_str === 'string') return sanitizeString(candidate.location_str);
    const fields = [candidate.city, candidate.state, candidate.region, candidate.country]
      .map(sanitizeString)
      .filter(Boolean);
    return fields.join(', ').trim();
  };
  return (
    attempt(detail?.location) ||
    attempt(detail?.locations?.[0]) ||
    attempt(job?.location) ||
    attempt(job?.locations?.[0]) ||
    ''
  );
}

function mergeParsedJob(parsed, job, detail) {
  const merged = { ...parsed };
  const title =
    sanitizeString(detail?.title) ||
    sanitizeString(detail?.full_title) ||
    sanitizeString(job?.title) ||
    sanitizeString(job?.full_title);
  if (!merged.title && title) merged.title = title;
  const location = extractLocation(detail, job);
  if (!merged.location && location) merged.location = location;
  const employmentType = sanitizeString(detail?.employment_type || job?.employment_type);
  if (employmentType) merged.employmentType = employmentType;
  const department = sanitizeString(detail?.department || job?.department);
  if (department) merged.department = department;
  return merged;
}

function resolveCanonicalUrl({ job, detail, account, shortcode }) {
  const urlCandidates = [
    detail?.application_url,
    detail?.url,
    detail?.shortlink,
    job?.application_url,
    job?.url,
    job?.shortlink,
  ];
  for (const candidate of urlCandidates) {
    const normalized = sanitizeString(candidate);
    if (normalized) return normalized;
  }
  const encodedAccount = encodeURIComponent(account);
  const encodedShortcode = encodeURIComponent(shortcode);
  return `https://apply.workable.com/${encodedAccount}/j/${encodedShortcode}/`;
}

function selectFetchedAt(detail, job) {
  const candidates = [detail?.updated_at, detail?.published_at, job?.updated_at, job?.published_at];
  for (const candidate of candidates) {
    const normalized = sanitizeString(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

export async function fetchWorkableJobs(
  account,
  { fetchImpl = fetch, retry, headers, token } = {},
) {
  const slug = normalizeAccountSlug(account);
  const url = buildJobsUrl(slug);
  const rateLimitKey = `workable:${slug}`;
  const requestHeaders = headers ? { ...headers } : buildWorkableHeaders(token);
  const response = await httpRequest(url, {
    fetchImpl,
    retry,
    headers: requestHeaders,
    rateLimit: { key: rateLimitKey, intervalMs: WORKABLE_RATE_LIMIT_MS },
  });
  if (!response.ok) {
    const statusLabel = `${response.status} ${response.statusText}`;
    throw new Error(`Failed to fetch Workable account ${slug}: ${statusLabel}`);
  }
  const payload = await response.json();
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return { slug, jobs };
}

export async function ingestWorkableBoard({
  account,
  fetchImpl = fetch,
  retry,
  headers,
  token,
} = {}) {
  const { slug, jobs } = await fetchWorkableJobs(account, { fetchImpl, retry, headers, token });
  const jobIds = [];
  const rateLimitKey = `workable:${slug}`;

  for (const job of jobs) {
    const shortcode = resolveShortcode(job);
    const detailUrl = buildJobDetailUrl(slug, shortcode);
    const detailHeaders = headers ? { ...headers } : buildWorkableHeaders(token);
    const detailResponse = await httpRequest(detailUrl, {
      fetchImpl,
      retry,
      headers: detailHeaders,
      rateLimit: { key: rateLimitKey, intervalMs: WORKABLE_RATE_LIMIT_MS },
    });
    if (!detailResponse.ok) {
      const statusLabel = `${detailResponse.status} ${detailResponse.statusText}`;
      throw new Error(`Failed to fetch Workable job ${shortcode}: ${statusLabel}`);
    }
    const detail = await detailResponse.json();
    const raw = gatherDetailText(detail, job);
    const parsed = mergeParsedJob(parseJobText(raw), job, detail);
    const canonical = resolveCanonicalUrl({ job, detail, account: slug, shortcode });
    const fetchedAt = selectFetchedAt(detail, job);
    const id = jobIdFromSource({ provider: 'workable', url: canonical });
    await saveJobSnapshot({
      id,
      raw,
      parsed,
      source: { type: 'workable', value: canonical },
      requestHeaders: sanitizeHeadersForSnapshot(detailHeaders),
      fetchedAt,
    });
    jobIds.push(id);
  }

  return { account: slug, saved: jobIds.length, jobIds };
}

