import fetch from 'node-fetch';
import { extractTextFromHtml } from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const ASHBY_BASE = 'https://jobs.ashbyhq.com/api/non-embed/company';

function normalizeOrgSlug(org) {
  if (!org || typeof org !== 'string' || !org.trim()) {
    throw new Error('Ashby org slug is required');
  }
  return org.trim();
}

function buildOrgUrl(slug) {
  return `${ASHBY_BASE}/${encodeURIComponent(slug)}?includeCompensation=true`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapParagraph(text) {
  if (!text) return '';
  return `<p>${escapeHtml(text)}</p>`;
}

function stripParagraph(html) {
  const trimmed = html.trim();
  if (trimmed.startsWith('<p>') && trimmed.endsWith('</p>')) {
    return trimmed.slice(3, -4).trim();
  }
  return trimmed;
}

function toListItemHtml(html) {
  const trimmed = html.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<li')) return trimmed;
  const body = stripParagraph(trimmed);
  return `<li>${body}</li>`;
}

function flattenRichContent(fragment) {
  if (!fragment) return [];
  if (typeof fragment === 'string') {
    const trimmed = fragment.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(fragment)) {
    const collected = [];
    for (const entry of fragment) {
      collected.push(...flattenRichContent(entry));
    }
    return collected;
  }
  if (typeof fragment === 'object') {
    const collected = [];
    const htmlFields = ['html', 'value', 'richText', 'bodyHtml', 'contentHtml'];
    for (const field of htmlFields) {
      if (typeof fragment[field] === 'string') {
        const html = fragment[field].trim();
        if (html) collected.push(html);
      }
    }
    const textFields = ['text', 'plainText', 'bodyText', 'descriptionText'];
    for (const field of textFields) {
      if (typeof fragment[field] === 'string') {
        const text = fragment[field].trim();
        if (text) collected.push(wrapParagraph(text));
      }
    }
    const arrayFields = ['content', 'items', 'children', 'sections', 'blocks', 'elements'];
    for (const field of arrayFields) {
      if (Array.isArray(fragment[field])) {
        collected.push(...flattenRichContent(fragment[field]));
      }
    }
    return collected;
  }
  return [];
}

function flattenSections(sections) {
  if (!Array.isArray(sections)) return [];
  const fragments = [];
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const heading =
      typeof section.title === 'string'
        ? section.title.trim()
        : typeof section.heading === 'string'
          ? section.heading.trim()
          : typeof section.name === 'string'
            ? section.name.trim()
            : '';
    const baseContent = flattenRichContent(
      section.content ?? section.blocks ?? section.elements ?? section.richText ?? section.body,
    );
    if (Array.isArray(section.items)) {
      const items = flattenRichContent(section.items)
        .map(toListItemHtml)
        .filter(Boolean)
        .join('');
      if (items) baseContent.push(`<ul>${items}</ul>`);
    }
    if (heading) fragments.push(`<h2>${escapeHtml(heading)}</h2>`);
    if (baseContent.length) fragments.push(baseContent.join('\n'));
    const nested = flattenSections(
      section.sections ?? section.children ?? section.subsections ?? section.groups,
    );
    if (nested.length) fragments.push(nested.join('\n'));
  }
  return fragments;
}

function buildJobHtml(job) {
  const fragments = [];
  const title = typeof job?.title === 'string' ? job.title.trim() : '';
  if (title) fragments.push(`<h1>${escapeHtml(title)}</h1>`);

  const primaryHtml = flattenRichContent(job?.descriptionHtml ?? job?.description);
  if (primaryHtml.length) fragments.push(primaryHtml.join('\n'));

  if (typeof job?.descriptionText === 'string') {
    const text = job.descriptionText.trim();
    if (text) fragments.push(wrapParagraph(text));
  }

  const sectionFragments = flattenSections(
    job?.sections ?? job?.contentSections ?? job?.richTextSections,
  );
  if (sectionFragments.length) fragments.push(sectionFragments.join('\n'));

  const additionalHtml = flattenRichContent(job?.additionalHtml ?? job?.additional);
  if (additionalHtml.length) fragments.push(additionalHtml.join('\n'));

  if (typeof job?.additionalText === 'string') {
    const text = job.additionalText.trim();
    if (text) fragments.push(wrapParagraph(text));
  }

  return fragments.join('\n');
}

function toLocationString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const candidates = [value.name, value.text, value.displayName, value.location];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return '';
}

function extractLocation(job) {
  const direct = toLocationString(job?.location);
  if (direct) return direct;
  const primary = toLocationString(job?.primaryLocation);
  if (primary) return primary;
  const jobLocation = toLocationString(job?.jobLocation);
  if (jobLocation) return jobLocation;
  if (Array.isArray(job?.locations)) {
    const names = Array.from(new Set(job.locations.map(toLocationString).filter(Boolean)));
    if (names.length) return names.join(' / ');
  }
  if (typeof job?.locationText === 'string' && job.locationText.trim()) {
    return job.locationText.trim();
  }
  return '';
}

function mergeParsedJob(parsed, job) {
  const merged = { ...parsed };
  if (!merged.title) {
    const title = typeof job?.title === 'string' ? job.title.trim() : '';
    if (title) merged.title = title;
  }
  if (!merged.location) {
    const location = extractLocation(job);
    if (location) merged.location = location;
  }
  return merged;
}

function resolveAbsoluteUrl(job, slug) {
  const candidates = [job?.jobUrl, job?.url, job?.applyUrl, job?.applicationUrl, job?.hostedUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const identifier =
    typeof job?.id === 'string' && job.id.trim()
      ? job.id.trim()
      : typeof job?.postingId === 'string' && job.postingId.trim()
        ? job.postingId.trim()
        : typeof job?.id === 'number'
          ? String(job.id)
          : typeof job?.postingId === 'number'
            ? String(job.postingId)
            : typeof job?.slug === 'string' && job.slug.trim()
              ? job.slug.trim()
              : 'unknown';
  const encodedSlug = encodeURIComponent(slug);
  const encodedId = encodeURIComponent(identifier);
  return `https://jobs.ashbyhq.com/${encodedSlug}/job/${encodedId}`;
}

function pickTimestamp(job) {
  const fields = ['updatedAt', 'postedAt', 'publishedAt', 'refreshedAt', 'createdAt'];
  for (const field of fields) {
    const value = job?.[field];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function collectSectionJobs(section) {
  if (!section || typeof section !== 'object') return [];
  const entries = [];
  if (Array.isArray(section.jobs)) entries.push(...section.jobs);
  if (Array.isArray(section.postings)) entries.push(...section.postings);
  if (Array.isArray(section.items)) entries.push(...section.items);
  if (Array.isArray(section.openings)) entries.push(...section.openings);
  const jobs = entries.filter(entry => entry && typeof entry === 'object');
  const nestedSections =
    section.sections ?? section.children ?? section.subsections ?? section.groups ?? [];
  if (Array.isArray(nestedSections)) {
    for (const child of nestedSections) {
      jobs.push(...collectSectionJobs(child));
    }
  }
  return jobs;
}

function collectJobs(payload) {
  const jobs = [];
  const board = payload?.jobBoard ?? payload;
  if (Array.isArray(board?.jobs)) {
    jobs.push(...board.jobs.filter(job => job && typeof job === 'object'));
  }
  if (Array.isArray(board?.postings)) {
    jobs.push(...board.postings.filter(job => job && typeof job === 'object'));
  }
  if (Array.isArray(board?.sections)) {
    for (const section of board.sections) {
      jobs.push(...collectSectionJobs(section));
    }
  }
  return jobs;
}

export async function fetchAshbyJobs(org, { fetchImpl = fetch } = {}) {
  const slug = normalizeOrgSlug(org);
  const url = buildOrgUrl(slug);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Ashby org ${slug}: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const jobs = collectJobs(payload);
  return { slug, jobs };
}

export async function ingestAshbyBoard({ org, fetchImpl = fetch } = {}) {
  const { slug, jobs } = await fetchAshbyJobs(org, { fetchImpl });
  const jobIds = [];
  for (const job of jobs) {
    const absoluteUrl = resolveAbsoluteUrl(job, slug);
    const html = buildJobHtml(job);
    const text = extractTextFromHtml(html);
    const parsed = mergeParsedJob(parseJobText(text), job);
    const id = jobIdFromSource({ provider: 'ashby', url: absoluteUrl });
    await saveJobSnapshot({
      id,
      raw: text,
      parsed,
      source: { type: 'ashby', value: absoluteUrl },
      fetchedAt: pickTimestamp(job),
    });
    jobIds.push(id);
  }
  return { org: slug, saved: jobIds.length, jobIds };
}
