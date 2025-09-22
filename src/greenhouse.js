import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';
import { extractTextFromHtml, fetchWithRetry } from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const GREENHOUSE_BASE = 'https://boards.greenhouse.io/v1/boards';

const GREENHOUSE_HEADERS = { 'User-Agent': 'jobbot3000' };

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function getCachePaths(slug) {
  const dir = path.join(resolveDataDir(), 'cache', 'greenhouse');
  return { dir, file: path.join(dir, `${slug}.json`) };
}

async function readCacheMetadata(slug) {
  const { file } = getCachePaths(slug);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const metadata = {};
      if (typeof parsed.etag === 'string' && parsed.etag.trim()) {
        metadata.etag = parsed.etag.trim();
      }
      if (typeof parsed.lastModified === 'string' && parsed.lastModified.trim()) {
        metadata.lastModified = parsed.lastModified.trim();
      }
      return metadata;
    }
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  return {};
}

async function writeCacheMetadata(slug, metadata) {
  const entries = {};
  if (metadata.etag) entries.etag = metadata.etag;
  if (metadata.lastModified) entries.lastModified = metadata.lastModified;

  const { dir, file } = getCachePaths(slug);
  if (Object.keys(entries).length === 0) {
    await fs.rm(file, { force: true });
    return;
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function getResponseHeader(response, name) {
  if (!response || !response.headers) return undefined;
  const headers = response.headers;
  if (typeof headers.get === 'function') {
    const direct = headers.get(name);
    if (direct) return direct;
    const lower = headers.get(name.toLowerCase());
    if (lower) return lower;
    return undefined;
  }
  const direct = headers[name];
  if (typeof direct === 'string' && direct) return direct;
  const lower = headers[name.toLowerCase()];
  if (typeof lower === 'string' && lower) return lower;
  return undefined;
}

function normalizeBoardSlug(board) {
  if (!board || typeof board !== 'string' || !board.trim()) {
    throw new Error('Greenhouse board slug is required');
  }
  return board.trim();
}

function buildBoardUrl(slug) {
  return `${GREENHOUSE_BASE}/${encodeURIComponent(slug)}/jobs?content=true`;
}

function resolveAbsoluteUrl(job, slug) {
  const value = typeof job.absolute_url === 'string' && job.absolute_url.trim()
    ? job.absolute_url.trim()
    : `https://boards.greenhouse.io/${slug}/jobs/${job.id}`;
  return value;
}

function extractLocation(job) {
  const name = job?.location?.name;
  return typeof name === 'string' ? name.trim() : '';
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  if (!merged.title && typeof job.title === 'string') merged.title = job.title;
  const location = extractLocation(job);
  if (!merged.location && location) merged.location = location;
  return merged;
}

export async function fetchGreenhouseJobs(board, { fetchImpl = fetch, retry } = {}) {
  const slug = normalizeBoardSlug(board);
  const url = buildBoardUrl(slug);
  const cacheMetadata = await readCacheMetadata(slug);
  const headers = { ...GREENHOUSE_HEADERS };
  if (cacheMetadata.etag) headers['If-None-Match'] = cacheMetadata.etag;
  if (cacheMetadata.lastModified) headers['If-Modified-Since'] = cacheMetadata.lastModified;

  const response = await fetchWithRetry(url, {
    fetchImpl,
    headers,
    retry,
  });

  const etag = getResponseHeader(response, 'etag');
  const lastModified = getResponseHeader(response, 'last-modified');
  const metadataToPersist = {};
  if (etag) metadataToPersist.etag = etag;
  else if (response.status === 304 && cacheMetadata.etag) {
    metadataToPersist.etag = cacheMetadata.etag;
  }
  if (lastModified) metadataToPersist.lastModified = lastModified;
  else if (response.status === 304 && cacheMetadata.lastModified) {
    metadataToPersist.lastModified = cacheMetadata.lastModified;
  }
  await writeCacheMetadata(slug, metadataToPersist);

  if (response.status === 304) {
    return { slug, jobs: [], notModified: true };
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Greenhouse board ${slug}: ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return { slug, jobs };
}

export async function ingestGreenhouseBoard({ board, fetchImpl = fetch, retry } = {}) {
  const { slug, jobs } = await fetchGreenhouseJobs(board, { fetchImpl, retry });
  const jobIds = [];

  for (const job of jobs) {
    const absoluteUrl = resolveAbsoluteUrl(job, slug);
    const html = typeof job.content === 'string' ? job.content : '';
    const text = html ? extractTextFromHtml(html) : '';
    const parsed = mergeParsedJob(parseJobText(text), job);
    const id = jobIdFromSource({ provider: 'greenhouse', url: absoluteUrl });
    await saveJobSnapshot({
      id,
      raw: text,
      parsed,
      source: { type: 'greenhouse', value: absoluteUrl },
      requestHeaders: GREENHOUSE_HEADERS,
      fetchedAt: job.updated_at,
    });
    jobIds.push(id);
  }

  return { board: slug, saved: jobIds.length, jobIds };
}
