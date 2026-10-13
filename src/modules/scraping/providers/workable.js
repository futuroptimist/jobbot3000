import { createIngestionBudget } from "../../../shared/http/ingestion-budget.js";
import { extractTextFromHtml } from "../../../shared/http/fetch.js";
import { saveJobSnapshot } from "../jobs.js";
import { JOB_SOURCE_ADAPTER_VERSION } from "../../../adapters/job-source.js";
import { parseJobText } from "../../../parser.js";
import {
  createAdapterHttpClient,
  createSnapshot,
  resolveAdapterRateLimit,
} from "../adapters/common.js";
import { getListingProviderToken } from "../provider-tokens.js";

const WORKABLE_BASE = "https://www.workable.com/api/accounts";
const WORKABLE_BASE_HEADERS = Object.freeze({
  "User-Agent": "jobbot3000",
  Accept: "application/json",
});
const WORKABLE_RATE_LIMIT_MS = resolveAdapterRateLimit({
  envVar: "JOBBOT_WORKABLE_RATE_LIMIT_MS",
  fallbackMs: 500,
});

const httpClient = createAdapterHttpClient({
  provider: "workable",
  headers: WORKABLE_BASE_HEADERS,
  rateLimitMs: WORKABLE_RATE_LIMIT_MS,
});

function sanitizeString(value) {
  if (value == null) return "";
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
  const stored = getListingProviderToken("workable");
  if (stored) return normalizeToken(stored);
  return normalizeToken(process.env.JOBBOT_WORKABLE_TOKEN);
}

function buildWorkableHeaders(explicitToken) {
  const token = getWorkableToken(explicitToken);
  if (!token) return { ...WORKABLE_BASE_HEADERS };
  return { ...WORKABLE_BASE_HEADERS, Authorization: `Bearer ${token}` };
}

function sanitizeHeadersForSnapshot(headers) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function normalizeAccountSlug(account) {
  const slug = sanitizeString(account);
  if (!slug) {
    throw new Error("Workable account slug is required");
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
  throw new Error("Workable job shortcode is required");
}

function buildJobDetailUrl(slug, shortcode) {
  return `${WORKABLE_BASE}/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(shortcode)}`;
}

function toPlainText(value) {
  const str = sanitizeString(value);
  if (!str) return "";
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
    : typeof sections === "object"
      ? Object.values(sections)
      : [];
  for (const section of entries) {
    if (!section || typeof section !== "object") continue;
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
  return parts.filter(Boolean).join("\n\n");
}

function extractLocation(detail, job) {
  const attempt = (candidate) => {
    if (!candidate) return "";
    if (typeof candidate === "string") return sanitizeString(candidate);
    if (typeof candidate.location_str === "string")
      return sanitizeString(candidate.location_str);
    const fields = [
      candidate.city,
      candidate.state,
      candidate.region,
      candidate.country,
    ]
      .map(sanitizeString)
      .filter(Boolean);
    return fields.join(", ").trim();
  };
  return (
    attempt(detail?.location) ||
    attempt(detail?.locations?.[0]) ||
    attempt(job?.location) ||
    attempt(job?.locations?.[0]) ||
    ""
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
  const employmentType = sanitizeString(
    detail?.employment_type || job?.employment_type,
  );
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
  const candidates = [
    detail?.updated_at,
    detail?.published_at,
    job?.updated_at,
    job?.published_at,
  ];
  for (const candidate of candidates) {
    const normalized = sanitizeString(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

export async function fetchWorkableJobs(
  account,
  { budget = createIngestionBudget(), retry, headers, token } = {},
) {
  budget.charge("pages");
  const slug = normalizeAccountSlug(account);
  const url = buildJobsUrl(slug);
  const requestHeaders = headers || buildWorkableHeaders(token);
  const payload = await httpClient.json(url, {
    budget,
    bodyKind: "list",
    retry,
    headers: requestHeaders,
    rateLimit: { key: `workable:${slug}` },
    onError: ({ response }) => {
      const statusLabel = `${response.status} ${response.statusText}`;
      return new Error(
        `Failed to fetch Workable account ${slug}: ${statusLabel}`,
      );
    },
  });
  const jobsArray = Array.isArray(payload?.jobs)
    ? payload.jobs
    : Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.results)
        ? payload.results
        : [];
  budget.charge("jobs", jobsArray.length);
  return { account: slug, jobs: jobsArray };
}

async function toWorkableSnapshot(job, context) {
  const {
    slug,
    budget = createIngestionBudget(),
    retry,
    headers,
    rateLimitKey,
    snapshotHeaders,
  } = context || {};
  if (!slug) {
    throw new Error(
      "Workable account slug is required for snapshot normalization",
    );
  }
  const shortcode = resolveShortcode(job);
  const detailUrl = buildJobDetailUrl(slug, shortcode);
  const detail = await httpClient.json(detailUrl, {
    budget,
    headers,
    retry,
    rateLimit: { key: rateLimitKey },
    onError: ({ response }) => {
      const statusLabel = `${response.status} ${response.statusText}`;
      return new Error(
        `Failed to fetch Workable job ${shortcode}: ${statusLabel}`,
      );
    },
  });
  const raw = gatherDetailText(detail, job);
  const parsed = mergeParsedJob(parseJobText(raw), job, detail);
  const canonicalUrl = resolveCanonicalUrl({
    job,
    detail,
    account: slug,
    shortcode,
  });
  const sanitizedHeaders = sanitizeHeadersForSnapshot(
    snapshotHeaders || headers || {},
  );
  budget.check();
  return createSnapshot({
    provider: "workable",
    url: canonicalUrl,
    raw,
    parsed,
    headers: sanitizedHeaders,
    fetchedAt: selectFetchedAt(detail, job),
  });
}

export const workableAdapter = {
  provider: "workable",
  version: JOB_SOURCE_ADAPTER_VERSION,
  async listOpenings({
    account,
    budget = createIngestionBudget(),
    retry,
    token,
  } = {}) {
    const headers = buildWorkableHeaders(token);
    const result = await fetchWorkableJobs(account, {
      budget,
      retry,
      headers,
      token,
    });
    const rateLimitKey = `workable:${result.account}`;
    const snapshotHeaders = sanitizeHeadersForSnapshot(headers);
    return {
      jobs: result.jobs,
      context: {
        slug: result.account,
        budget,
        retry,
        headers,
        rateLimitKey,
        snapshotHeaders,
      },
    };
  },
  async normalizeJob(job, context = {}) {
    return toWorkableSnapshot(job, context);
  },
  toApplicationEvent() {
    return null;
  },
};

export async function ingestWorkableBoard({
  account,
  budget = createIngestionBudget(),
  retry,
} = {}) {
  const { jobs, context } = await workableAdapter.listOpenings({
    account,
    budget,
    retry,
  });
  const jobIds = [];

  try {
    for (const job of jobs) {
      const snapshot = await workableAdapter.normalizeJob(job, context);
      budget.check();
      budget.progress.completed++;
      await saveJobSnapshot(snapshot);
      budget.progress.saved++;
      budget.progress.jobIds.push(snapshot.id);
      jobIds.push(snapshot.id);
    }
  } catch (error) {
    throw budget.annotate(error);
  }

  return { account: context.slug, saved: jobIds.length, jobIds };
}
