import fetch from 'node-fetch';
import { extractTextFromHtml } from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const LEVER_BASE = 'https://api.lever.co/v0/postings';

function normalizeOrgSlug(org) {
  if (!org || typeof org !== 'string' || !org.trim()) {
    throw new Error('Lever organization slug is required');
  }
  return org.trim();
}

function buildPostingsUrl(slug) {
  return `${LEVER_BASE}/${encodeURIComponent(slug)}?mode=json`;
}

function resolveHostedUrl(job, slug) {
  if (typeof job?.hostedUrl === 'string' && job.hostedUrl.trim()) {
    return job.hostedUrl.trim();
  }
  return `https://jobs.lever.co/${slug}/${job.id}`;
}

function normalizeListEntry(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const text =
    typeof entry.text === 'string'
      ? entry.text
      : typeof entry.content === 'string'
        ? entry.content
        : '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/^<li[\s>]/i.test(trimmed)) return trimmed;
  return `<li>${trimmed}</li>`;
}

function humanizeListKey(key) {
  if (!key) return 'Details';
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const REQUIREMENT_SECTION_RE = /<h[1-6][^>]*>\s*Requirements\s*<\/h[1-6]>\s*<ul[\s\S]*?<\/ul>/gi;
const LIST_ITEM_RE = /<li[\s\S]*?<\/li>/gi;

function extractRequirementSectionDetails(html) {
  if (typeof html !== 'string') {
    return { cleaned: html, bullets: [] };
  }

  const bullets = [];
  const cleaned = html.replace(REQUIREMENT_SECTION_RE, section => {
    const items = section.match(LIST_ITEM_RE) || [];
    for (const item of items) {
      const text = extractTextFromHtml(item).trim();
      if (text) bullets.push(text);
    }
    return '';
  });

  return { cleaned, bullets };
}

function collectLeverText(job) {
  const lines = [];
  let hasRequirementsHeader = false;

  const pushRichText = value => {
    if (typeof value !== 'string') return;
    const text = extractTextFromHtml(value).trim();
    if (!text) return;
    lines.push(text);
    if (/^requirements\b/i.test(text) || /\brequirements:/i.test(text)) {
      hasRequirementsHeader = true;
    }
  };

  const { cleaned: descriptionHtml, bullets: descriptionRequirementBullets } =
    extractRequirementSectionDetails(job?.description);
  pushRichText(descriptionHtml);

  if (job?.lists && typeof job.lists === 'object') {
    for (const [key, entries] of Object.entries(job.lists)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const bullets = entries
        .map(normalizeListEntry)
        .map(item => extractTextFromHtml(item).trim())
        .filter(Boolean);
      if (bullets.length === 0) continue;

      const normalizedKey = String(key || '').trim().toLowerCase();
      if (normalizedKey === 'requirements') {
        const combined = descriptionRequirementBullets.splice(0).concat(bullets);
        if (combined.length === 0) continue;
        if (!hasRequirementsHeader) {
          lines.push('Requirements:');
          hasRequirementsHeader = true;
        }
        for (const bullet of combined) {
          lines.push(`- ${bullet}`);
        }
        continue;
      }

      const header = humanizeListKey(key);
      lines.push(`${header}:`);
      if (/^requirements$/i.test(header)) hasRequirementsHeader = true;

      for (const bullet of bullets) {
        lines.push(`- ${bullet}`);
      }
    }
  }

  if (descriptionRequirementBullets.length > 0) {
    if (!hasRequirementsHeader) {
      lines.push('Requirements:');
      hasRequirementsHeader = true;
    }
    for (const bullet of descriptionRequirementBullets) {
      lines.push(`- ${bullet}`);
    }
  }

  pushRichText(job?.additional);
  pushRichText(job?.additionalPlain);
  pushRichText(job?.descriptionPlain);

  return lines.join('\n');
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  if ((!merged.title || !merged.title.trim()) && typeof job?.text === 'string') {
    const title = job.text.trim();
    if (title) merged.title = title;
  }
  const location =
    typeof job?.categories?.location === 'string' ? job.categories.location.trim() : '';
  if ((!merged.location || !merged.location.trim()) && location) {
    merged.location = location;
  }
  return merged;
}

export async function fetchLeverPostings(org, { fetchImpl = fetch } = {}) {
  const slug = normalizeOrgSlug(org);
  const url = buildPostingsUrl(slug);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Lever postings ${slug}: ${response.status} ${response.statusText}`
    );
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
  const { slug, jobs } = await fetchLeverPostings(org, { fetchImpl });
  const jobIds = [];

  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    const text = collectLeverText(job);
    const parsed = mergeParsedJob(parseJobText(text), job);
    const absoluteUrl = resolveHostedUrl(job, slug);
    const id = jobIdFromSource({ provider: 'lever', url: absoluteUrl });
    await saveJobSnapshot({
      id,
      raw: text,
      parsed,
      source: { type: 'lever', value: absoluteUrl },
      fetchedAt: job.updatedAt ?? job.createdAt,
    });
    jobIds.push(id);
  }

  return { org: slug, saved: jobIds.length, jobIds };
}
