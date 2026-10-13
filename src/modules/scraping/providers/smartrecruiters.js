import {
  createIngestionBudget,
  IngestionError,
} from "../../../shared/http/ingestion-budget.js";
import { extractTextFromHtml } from "../../../shared/http/fetch.js";
import { saveJobSnapshot } from "../jobs.js";
import { JOB_SOURCE_ADAPTER_VERSION } from "../../../adapters/job-source.js";
import { parseJobText } from "../../../parser.js";
import {
  collectPaginatedResults,
  createAdapterHttpClient,
  createSnapshot,
  resolveAdapterRateLimit,
} from "../adapters/common.js";

const SMARTRECRUITERS_BASE = "https://api.smartrecruiters.com/v1/companies";
const SMARTRECRUITERS_HEADERS = { "User-Agent": "jobbot3000" };
const DEFAULT_LIMIT = 100;
const SMARTRECRUITERS_RATE_LIMIT_MS = resolveAdapterRateLimit({
  envVar: "JOBBOT_SMARTRECRUITERS_RATE_LIMIT_MS",
  fallbackMs: 500,
});

const httpClient = createAdapterHttpClient({
  provider: "smartrecruiters",
  headers: SMARTRECRUITERS_HEADERS,
  rateLimitMs: SMARTRECRUITERS_RATE_LIMIT_MS,
});

function normalizeCompanySlug(company) {
  if (!company || typeof company !== "string" || !company.trim()) {
    throw new Error("SmartRecruiters company slug is required");
  }
  return company.trim();
}

function buildListUrl(slug, offset) {
  const url = new URL(
    `${SMARTRECRUITERS_BASE}/${encodeURIComponent(slug)}/postings`,
  );
  url.searchParams.set("limit", String(DEFAULT_LIMIT));
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

function resolveDetailUrl(slug, posting) {
  const prefix = `${SMARTRECRUITERS_BASE}/${encodeURIComponent(slug)}/postings/`;
  let id =
    typeof posting?.id === "string"
      ? posting.id.trim()
      : String(posting?.id ?? "");
  const ref = posting?.ref;
  if (ref !== undefined) {
    let url;
    try {
      url = new URL(ref);
    } catch {
      throw new IngestionError("URL_POLICY", "Invalid posting reference");
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.origin !== "https://api.smartrecruiters.com" ||
      !url.href.startsWith(prefix)
    ) {
      throw new IngestionError(
        "URL_POLICY",
        "Posting reference does not match provider contract",
      );
    }
    const suffix = url.href.slice(prefix.length);
    try {
      if (!id) id = decodeURIComponent(suffix);
    } catch {
      throw new IngestionError("URL_POLICY", "Invalid posting identifier");
    }
    if (!id || suffix !== encodeURIComponent(id)) {
      throw new IngestionError("URL_POLICY", "Conflicting posting reference");
    }
  }
  if (!id)
    throw new IngestionError(
      "PAYLOAD_INVALID",
      "Posting identifier is missing",
    );
  return `${prefix}${encodeURIComponent(id)}`;
}

function toPlainText(html) {
  if (!html) return "";
  return extractTextFromHtml(html);
}

function extractSectionsText(detail) {
  const sections = detail?.jobAd?.sections;
  if (!sections || typeof sections !== "object") return "";
  const parts = [];
  for (const section of Object.values(sections)) {
    if (!section || typeof section !== "object") continue;
    const title = typeof section.title === "string" ? section.title.trim() : "";
    const text = typeof section.text === "string" ? section.text : "";
    const safeTitle = title ? toPlainText(title) : "";
    const safeText = text ? toPlainText(text) : "";
    if (safeTitle) parts.push(safeTitle);
    if (safeText) parts.push(safeText);
  }
  return parts.filter(Boolean).join("\n\n");
}

function mergeParsedJob(parsed, posting, detail) {
  const merged = { ...parsed };
  const name =
    (typeof detail?.name === "string" && detail.name.trim()) ||
    (typeof posting?.name === "string" && posting.name.trim()) ||
    "";
  const location =
    (typeof detail?.location?.fullLocation === "string" &&
      detail.location.fullLocation.trim()) ||
    (typeof posting?.location?.fullLocation === "string" &&
      posting.location.fullLocation.trim()) ||
    "";
  if (!merged.title && name) merged.title = name;
  if (!merged.location && location) merged.location = location;
  return merged;
}

export async function fetchSmartRecruitersPostings(
  company,
  { budget = createIngestionBudget(), retry } = {},
) {
  const slug = normalizeCompanySlug(company);
  const rateLimitKey = `smartrecruiters:${slug}`;
  const postings = await collectPaginatedResults(
    async ({ offset }) => {
      const url = buildListUrl(slug, offset);
      const payload = await httpClient.json(url, {
        budget,
        bodyKind: "list",
        retry,
        rateLimit: { key: rateLimitKey },
        onError: ({ response }) => {
          const statusLabel = `${response.status} ${response.statusText}`;
          return new Error(
            `Failed to fetch SmartRecruiters company ${slug}: ${statusLabel}`,
          );
        },
      });
      const items = Array.isArray(payload?.content) ? payload.content : [];
      const totalFound =
        typeof payload?.totalFound === "number"
          ? payload.totalFound
          : offset + items.length;
      const nextOffset = offset + items.length;
      const hasMore = nextOffset < totalFound && items.length >= DEFAULT_LIMIT;
      return {
        items,
        nextOffset,
        done: !hasMore,
      };
    },
    { budget },
  );

  return { slug, postings };
}

async function toSmartRecruitersSnapshot(posting, context) {
  const {
    slug,
    budget = createIngestionBudget(),
    retry,
    rateLimitKey,
  } = context || {};
  if (!slug) {
    throw new Error(
      "SmartRecruiters company slug is required for snapshot normalization",
    );
  }
  const detailUrl = resolveDetailUrl(slug, posting);
  const detail = await httpClient.json(detailUrl, {
    budget,
    retry,
    rateLimit: { key: rateLimitKey },
    onError: ({ response }) => {
      const statusLabel = `${response.status} ${response.statusText}`;
      const postingId = posting?.id ?? "";
      return new Error(
        `Failed to fetch SmartRecruiters posting ${postingId}: ${statusLabel}`,
      );
    },
  });
  const sectionsText = extractSectionsText(detail);
  const raw = sectionsText || toPlainText(detail?.jobAd?.text) || "";
  const parsed = mergeParsedJob(parseJobText(raw), posting, detail);
  const postingUrl =
    (typeof detail?.postingUrl === "string" && detail.postingUrl.trim()) ||
    (typeof posting?.postingUrl === "string" && posting.postingUrl.trim()) ||
    (typeof posting?.applyUrl === "string" && posting.applyUrl.trim()) ||
    detailUrl;
  budget.check();
  return createSnapshot({
    provider: "smartrecruiters",
    url: postingUrl,
    raw,
    parsed,
    headers: SMARTRECRUITERS_HEADERS,
    fetchedAt: detail?.releasedDate ?? posting?.releasedDate,
  });
}

export const smartRecruitersAdapter = {
  provider: "smartrecruiters",
  version: JOB_SOURCE_ADAPTER_VERSION,
  async listOpenings({
    company,
    budget = createIngestionBudget(),
    retry,
  } = {}) {
    const result = await fetchSmartRecruitersPostings(company, {
      budget,
      retry,
    });
    const rateLimitKey = `smartrecruiters:${result.slug}`;
    return {
      jobs: result.postings,
      context: { slug: result.slug, budget, retry, rateLimitKey },
    };
  },
  async normalizeJob(posting, context = {}) {
    return toSmartRecruitersSnapshot(posting, context);
  },
  toApplicationEvent() {
    return null;
  },
};

export async function ingestSmartRecruitersBoard({
  company,
  budget = createIngestionBudget(),
  retry,
} = {}) {
  const { jobs, context } = await smartRecruitersAdapter.listOpenings({
    company,
    budget,
    retry,
  });
  const jobIds = [];

  try {
    for (const posting of jobs) {
      const snapshot = await smartRecruitersAdapter.normalizeJob(
        posting,
        context,
      );
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

  return { company: context.slug, saved: jobIds.length, jobIds };
}
