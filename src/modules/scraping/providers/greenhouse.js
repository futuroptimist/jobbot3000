import fs from "node:fs/promises";
import path from "node:path";
import {
  createIngestionBudget,
  IngestionError,
} from "../../../shared/http/ingestion-budget.js";
import { extractTextFromHtml } from "../../../shared/http/fetch.js";
import { saveJobSnapshot } from "../jobs.js";
import { JOB_SOURCE_ADAPTER_VERSION } from "../../../adapters/job-source.js";
import { parseJobText } from "../../../parser.js";
import {
  createAdapterHttpClient,
  createSnapshot,
  resolveAdapterRateLimit,
} from "../adapters/common.js";

const GREENHOUSE_BASE = "https://boards.greenhouse.io/v1/boards";

const GREENHOUSE_HEADERS = { "User-Agent": "jobbot3000" };
const GREENHOUSE_RATE_LIMIT_MS = resolveAdapterRateLimit({
  envVar: "JOBBOT_GREENHOUSE_RATE_LIMIT_MS",
  fallbackMs: 500,
});

const httpClient = createAdapterHttpClient({
  provider: "greenhouse",
  headers: GREENHOUSE_HEADERS,
  rateLimitMs: GREENHOUSE_RATE_LIMIT_MS,
});

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve("data");
}

function getCachePaths(slug) {
  const dir = path.join(resolveDataDir(), "cache", "greenhouse");
  return { dir, file: path.join(dir, `${slug}.json`) };
}

async function readCacheMetadata(slug) {
  const { file } = getCachePaths(slug);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const metadata = {};
      if (typeof parsed.etag === "string" && parsed.etag.trim()) {
        metadata.etag = parsed.etag.trim();
      }
      if (
        typeof parsed.lastModified === "string" &&
        parsed.lastModified.trim()
      ) {
        metadata.lastModified = parsed.lastModified.trim();
      }
      if (typeof parsed.fetchedAt === "string" && parsed.fetchedAt.trim()) {
        metadata.fetchedAt = parsed.fetchedAt.trim();
      }
      return metadata;
    }
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  return {};
}

async function writeCacheMetadata(slug, metadata) {
  const entries = {};
  if (metadata.etag) entries.etag = metadata.etag;
  if (metadata.lastModified) entries.lastModified = metadata.lastModified;
  if (metadata.fetchedAt) entries.fetchedAt = metadata.fetchedAt;

  const { dir, file } = getCachePaths(slug);
  if (Object.keys(entries).length === 0) {
    await fs.rm(file, { force: true });
    return;
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function getResponseHeader(response, name) {
  if (!response || !response.headers) return undefined;
  const headers = response.headers;
  if (typeof headers.get === "function") {
    const direct = headers.get(name);
    if (direct) return direct;
    const lower = headers.get(name.toLowerCase());
    if (lower) return lower;
    return undefined;
  }
  const direct = headers[name];
  if (typeof direct === "string" && direct) return direct;
  const lower = headers[name.toLowerCase()];
  if (typeof lower === "string" && lower) return lower;
  return undefined;
}

function normalizeBoardSlug(board) {
  if (!board || typeof board !== "string" || !board.trim()) {
    throw new Error("Greenhouse board slug is required");
  }
  return board.trim();
}

function buildBoardUrl(slug) {
  return `${GREENHOUSE_BASE}/${encodeURIComponent(slug)}/jobs?content=true`;
}

function resolveAbsoluteUrl(job, slug) {
  const value =
    typeof job.absolute_url === "string" && job.absolute_url.trim()
      ? job.absolute_url.trim()
      : `https://boards.greenhouse.io/${slug}/jobs/${job.id}`;
  return value;
}

function extractLocation(job) {
  const name = job?.location?.name;
  return typeof name === "string" ? name.trim() : "";
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  if (!merged.title && typeof job.title === "string") merged.title = job.title;
  const location = extractLocation(job);
  if (!merged.location && location) merged.location = location;
  return merged;
}

export async function fetchGreenhouseJobs(
  board,
  { budget = createIngestionBudget(), retry } = {},
) {
  budget.charge("pages");
  const slug = normalizeBoardSlug(board);
  const url = buildBoardUrl(slug);
  const cacheMetadata = await readCacheMetadata(slug);
  const headers = { ...GREENHOUSE_HEADERS };
  if (cacheMetadata.etag) headers["If-None-Match"] = cacheMetadata.etag;
  if (cacheMetadata.lastModified)
    headers["If-Modified-Since"] = cacheMetadata.lastModified;

  const response = await httpClient.request(url, {
    budget,
    bodyKind: "list",
    retry,
    headers,
    rateLimit: {
      key: `greenhouse:${slug}`,
      lastInvokedAt: cacheMetadata.fetchedAt,
    },
  });

  const notModified = response.status === 304;
  if (
    notModified &&
    (response.url !== url ||
      (!cacheMetadata.etag && !cacheMetadata.lastModified))
  ) {
    throw new IngestionError(
      "PAYLOAD_INVALID",
      "Unexpected non-conditional or redirected 304",
    );
  }
  const etag = getResponseHeader(response, "etag");
  const lastModified = getResponseHeader(response, "last-modified");
  const metadataToPersist = { fetchedAt: new Date().toISOString() };
  if (etag) metadataToPersist.etag = etag;
  else if (notModified && cacheMetadata.etag) {
    metadataToPersist.etag = cacheMetadata.etag;
  }
  if (lastModified) metadataToPersist.lastModified = lastModified;
  else if (notModified && cacheMetadata.lastModified) {
    metadataToPersist.lastModified = cacheMetadata.lastModified;
  }

  if (notModified) {
    await writeCacheMetadata(slug, metadataToPersist);
    return { slug, jobs: [], notModified: true };
  }

  if (!response.ok) {
    throw new IngestionError("HTTP_STATUS", "Provider request failed");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new IngestionError(
      "PAYLOAD_INVALID",
      "Provider response is not valid JSON",
    );
  }
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  budget.charge("jobs", jobs.length);
  budget.check();
  await writeCacheMetadata(
    slug,
    response.url && response.url !== url
      ? { fetchedAt: metadataToPersist.fetchedAt }
      : metadataToPersist,
  );
  return { slug, jobs, notModified: false };
}

function toGreenhouseSnapshot(job, slug) {
  if (!slug) {
    throw new Error(
      "Greenhouse board slug is required for snapshot normalization",
    );
  }
  const absoluteUrl = resolveAbsoluteUrl(job, slug);
  const html = typeof job.content === "string" ? job.content : "";
  const raw = html ? extractTextFromHtml(html) : "";
  const parsed = mergeParsedJob(parseJobText(raw), job);
  return createSnapshot({
    provider: "greenhouse",
    url: absoluteUrl,
    raw,
    parsed,
    headers: GREENHOUSE_HEADERS,
    fetchedAt: job.updated_at,
  });
}

export const greenhouseAdapter = {
  provider: "greenhouse",
  version: JOB_SOURCE_ADAPTER_VERSION,
  async listOpenings({ board, budget = createIngestionBudget(), retry } = {}) {
    const result = await fetchGreenhouseJobs(board, { budget, retry });
    return {
      jobs: result.jobs,
      context: {
        slug: result.slug,
        budget,
        notModified: Boolean(result.notModified),
      },
    };
  },
  normalizeJob(job, context = {}) {
    const budget = context.budget ?? createIngestionBudget();
    budget.check();
    const slug = context.slug || context.board;
    const snapshot = toGreenhouseSnapshot(job, slug);
    budget.check();
    return snapshot;
  },
  toApplicationEvent() {
    return null;
  },
};

export async function ingestGreenhouseBoard({
  board,
  budget = createIngestionBudget(),
  retry,
} = {}) {
  const { jobs, context } = await greenhouseAdapter.listOpenings({
    board,
    budget,
    retry,
  });
  const jobIds = [];
  try {
    for (const job of jobs) {
      const snapshot = greenhouseAdapter.normalizeJob(job, context);
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

  return {
    board: context.slug,
    saved: jobIds.length,
    jobIds,
    notModified: Boolean(context.notModified),
  };
}
