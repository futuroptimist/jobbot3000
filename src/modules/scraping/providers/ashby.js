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

const ASHBY_BASE = "https://jobs.ashbyhq.com/api/postings";

const ASHBY_HEADERS = {
  "User-Agent": "jobbot3000",
  Accept: "application/json",
};
const ASHBY_RATE_LIMIT_MS = resolveAdapterRateLimit({
  envVar: "JOBBOT_ASHBY_RATE_LIMIT_MS",
  fallbackMs: 500,
});

const httpClient = createAdapterHttpClient({
  provider: "ashby",
  headers: ASHBY_HEADERS,
  rateLimitMs: ASHBY_RATE_LIMIT_MS,
});

function normalizeOrgSlug(org) {
  if (!org || typeof org !== "string" || !org.trim()) {
    throw new Error("Ashby org slug is required");
  }
  return org.trim();
}

function buildOrgUrl(slug) {
  const params = new URLSearchParams({
    organizationSlug: slug,
    includeCompensation: "true",
    includeUnlisted: "false",
  });
  return `${ASHBY_BASE}?${params.toString()}`;
}

function deriveJobUrl(job, slug) {
  const fromJob =
    typeof job.jobPostingUrl === "string" ? job.jobPostingUrl.trim() : "";
  if (fromJob) return fromJob;
  const jobId =
    typeof job.id === "string" && job.id.trim() ? job.id.trim() : "";
  if (jobId) return `https://jobs.ashbyhq.com/${slug}/job/${jobId}`;
  return `https://jobs.ashbyhq.com/${slug}`;
}

function selectRawDescription(job) {
  const text =
    typeof job.descriptionText === "string" ? job.descriptionText.trim() : "";
  if (text) return text;
  const html =
    typeof job.descriptionHtml === "string" ? job.descriptionHtml : "";
  if (html && html.trim()) return extractTextFromHtml(html);
  const summary = typeof job.summary === "string" ? job.summary.trim() : "";
  return summary;
}

function extractLocation(job) {
  const location =
    typeof job.locationName === "string" ? job.locationName.trim() : "";
  if (location) return location;
  const secondary = Array.isArray(job?.secondaryLocations)
    ? job.secondaryLocations
    : [];
  for (const entry of secondary) {
    if (entry && typeof entry.name === "string" && entry.name.trim()) {
      return entry.name.trim();
    }
  }
  return "";
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  const title = typeof job.title === "string" ? job.title.trim() : "";
  if (!merged.title && title) merged.title = title;
  const location = extractLocation(job);
  if (!merged.location && location) merged.location = location;
  const employmentType =
    typeof job.employmentType === "string" ? job.employmentType.trim() : "";
  if (employmentType) merged.employmentType = employmentType;
  const workplaceType =
    typeof job.workplaceType === "string" ? job.workplaceType.trim() : "";
  if (workplaceType) merged.workplaceType = workplaceType;
  return merged;
}

export async function fetchAshbyJobs(
  org,
  { budget = createIngestionBudget(), retry } = {},
) {
  budget.charge("pages");
  const slug = normalizeOrgSlug(org);
  const url = buildOrgUrl(slug);
  const payload = await httpClient.json(url, {
    budget,
    bodyKind: "list",
    retry,
    rateLimit: { key: `ashby:${slug}` },
  });
  const jobPostings = Array.isArray(payload?.jobPostings)
    ? payload.jobPostings
    : [];
  budget.charge("jobs", jobPostings.length);
  return { slug, jobPostings };
}

function toAshbySnapshot(job, slug) {
  if (!slug) {
    throw new Error("Ashby org slug is required for snapshot normalization");
  }
  const jobUrl = deriveJobUrl(job, slug);
  const raw = selectRawDescription(job);
  const parsed = mergeParsedJob(parseJobText(raw), job);
  return createSnapshot({
    provider: "ashby",
    url: jobUrl,
    raw,
    parsed,
    headers: ASHBY_HEADERS,
    fetchedAt: job.updatedAt ?? job.publishedDate,
  });
}

export const ashbyAdapter = {
  provider: "ashby",
  version: JOB_SOURCE_ADAPTER_VERSION,
  async listOpenings({ org, budget = createIngestionBudget(), retry } = {}) {
    const result = await fetchAshbyJobs(org, { budget, retry });
    return {
      jobs: result.jobPostings,
      context: { slug: result.slug, budget },
    };
  },
  normalizeJob(job, context = {}) {
    const budget = context.budget ?? createIngestionBudget();
    budget.check();
    const slug = context.slug || context.org;
    const snapshot = toAshbySnapshot(job, slug);
    budget.check();
    return snapshot;
  },
  toApplicationEvent() {
    return null;
  },
};

export async function ingestAshbyBoard({
  org,
  budget = createIngestionBudget(),
  retry,
} = {}) {
  const { jobs, context } = await ashbyAdapter.listOpenings({
    org,
    budget,
    retry,
  });
  const jobIds = [];

  try {
    for (const job of jobs) {
      const snapshot = ashbyAdapter.normalizeJob(job, context);
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

  return { org: context.slug, saved: jobIds.length, jobIds };
}
