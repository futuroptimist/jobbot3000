import fetch from 'node-fetch';
import { extractTextFromHtml } from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const GREENHOUSE_BASE = 'https://boards.greenhouse.io/v1/boards';

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

export async function fetchGreenhouseJobs(board, { fetchImpl = fetch } = {}) {
  const slug = normalizeBoardSlug(board);
  const url = buildBoardUrl(slug);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Greenhouse board ${slug}: ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return { slug, jobs };
}

export async function ingestGreenhouseBoard({ board, fetchImpl = fetch } = {}) {
  const { slug, jobs } = await fetchGreenhouseJobs(board, { fetchImpl });
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
      fetchedAt: job.updated_at,
    });
    jobIds.push(id);
  }

  return { board: slug, saved: jobIds.length, jobIds };
}
