import fetch from 'node-fetch';
import { extractTextFromHtml } from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const LEVER_BASE = 'https://api.lever.co/v0/postings';

function normalizeOrgSlug(org) {
  if (!org || typeof org !== 'string' || !org.trim()) {
    throw new Error('Lever org slug is required');
  }
  return org.trim();
}

function buildOrgUrl(slug) {
  return `${LEVER_BASE}/${encodeURIComponent(slug)}?mode=json`;
}

function resolveAbsoluteUrl(job, slug) {
  const hosted = typeof job?.hostedUrl === 'string' ? job.hostedUrl.trim() : '';
  if (hosted) return hosted;
  const identifier =
    typeof job?.id === 'string' && job.id.trim()
      ? job.id.trim()
      : typeof job?.id === 'number'
        ? String(job.id)
        : '';
  const fallback = identifier || 'unknown';
  return `https://jobs.lever.co/${slug}/${fallback}`;
}

function extractLocation(job) {
  const categories = job?.categories;
  const byCategory =
    categories && typeof categories.location === 'string' ? categories.location.trim() : '';
  if (byCategory) return byCategory;
  if (typeof job?.location === 'string' && job.location.trim()) return job.location.trim();
  if (typeof job?.workplaceType === 'string' && job.workplaceType.trim()) {
    return job.workplaceType.trim();
  }
  return '';
}

function buildJobHtml(job) {
  const sections = [];
  const title = typeof job?.text === 'string' ? job.text.trim() : '';
  if (title) sections.push(`<h1>${title}</h1>`);
  const content = typeof job?.content === 'string' ? job.content.trim() : '';
  if (content) sections.push(content);
  if (Array.isArray(job?.lists)) {
    for (const entry of job.lists) {
      const heading = typeof entry?.text === 'string' ? entry.text.trim() : '';
      const listHtml = typeof entry?.content === 'string' ? entry.content.trim() : '';
      if (heading || listHtml) {
        const headingHtml = heading ? `<h2>${heading}</h2>` : '';
        sections.push(`${headingHtml}${listHtml}`);
      }
    }
  }
  const description = typeof job?.description === 'string' ? job.description.trim() : '';
  if (description) sections.push(description);
  const additionalPlain =
    typeof job?.additionalPlain === 'string' ? job.additionalPlain.trim() : '';
  if (additionalPlain) sections.push(`<p>${additionalPlain}</p>`);
  return sections.join('\n');
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  if (!merged.title) {
    const title = typeof job?.text === 'string' ? job.text.trim() : '';
    if (title) merged.title = title;
  }
  if (!merged.location) {
    const location = extractLocation(job);
    if (location) merged.location = location;
  }
  return merged;
}

export async function fetchLeverJobs(org, { fetchImpl = fetch } = {}) {
  const slug = normalizeOrgSlug(org);
  const url = buildOrgUrl(slug);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Lever org ${slug}: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const jobs = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return { slug, jobs };
}

export async function ingestLeverBoard({ org, fetchImpl = fetch } = {}) {
  const { slug, jobs } = await fetchLeverJobs(org, { fetchImpl });
  const jobIds = [];
  for (const job of jobs) {
    const absoluteUrl = resolveAbsoluteUrl(job, slug);
    const html = buildJobHtml(job);
    const text = extractTextFromHtml(html);
    const parsed = mergeParsedJob(parseJobText(text), job);
    const id = jobIdFromSource({ provider: 'lever', url: absoluteUrl });
    await saveJobSnapshot({
      id,
      raw: text,
      parsed,
      source: { type: 'lever', value: absoluteUrl },
      fetchedAt: job?.updatedAt ?? job?.createdAt,
    });
    jobIds.push(id);
  }
  return { org: slug, saved: jobIds.length, jobIds };
}
