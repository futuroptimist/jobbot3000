import fetch from 'node-fetch';
import { extractTextFromHtml, fetchWithRetry } from './fetch.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';
import { parseJobText } from './parser.js';

const SMARTRECRUITERS_BASE = 'https://api.smartrecruiters.com/v1/companies';
const SMARTRECRUITERS_HEADERS = { 'User-Agent': 'jobbot3000' };
const DEFAULT_LIMIT = 100;

function normalizeCompanySlug(company) {
  if (!company || typeof company !== 'string' || !company.trim()) {
    throw new Error('SmartRecruiters company slug is required');
  }
  return company.trim();
}

function buildListUrl(slug, offset) {
  const url = new URL(`${SMARTRECRUITERS_BASE}/${encodeURIComponent(slug)}/postings`);
  url.searchParams.set('limit', String(DEFAULT_LIMIT));
  url.searchParams.set('offset', String(offset));
  return url.toString();
}

function resolveDetailUrl(slug, posting) {
  const ref = typeof posting?.ref === 'string' && posting.ref.trim() ? posting.ref.trim() : '';
  if (ref) return ref;
  const id = typeof posting?.id === 'string' ? posting.id.trim() : String(posting?.id ?? '');
  if (!id) {
    throw new Error('SmartRecruiters posting id is required');
  }
  return `${SMARTRECRUITERS_BASE}/${encodeURIComponent(slug)}/postings/${encodeURIComponent(id)}`;
}

function toPlainText(html) {
  if (!html) return '';
  return extractTextFromHtml(html);
}

function extractSectionsText(detail) {
  const sections = detail?.jobAd?.sections;
  if (!sections || typeof sections !== 'object') return '';
  const parts = [];
  for (const section of Object.values(sections)) {
    if (!section || typeof section !== 'object') continue;
    const title = typeof section.title === 'string' ? section.title.trim() : '';
    const text = typeof section.text === 'string' ? section.text : '';
    const safeTitle = title ? toPlainText(title) : '';
    const safeText = text ? toPlainText(text) : '';
    if (safeTitle) parts.push(safeTitle);
    if (safeText) parts.push(safeText);
  }
  return parts.filter(Boolean).join('\n\n');
}

function mergeParsedJob(parsed, posting, detail) {
  const merged = { ...parsed };
  const name =
    (typeof detail?.name === 'string' && detail.name.trim()) ||
    (typeof posting?.name === 'string' && posting.name.trim()) ||
    '';
  const location =
    (typeof detail?.location?.fullLocation === 'string' && detail.location.fullLocation.trim()) ||
    (typeof posting?.location?.fullLocation === 'string' && posting.location.fullLocation.trim()) ||
    '';
  if (!merged.title && name) merged.title = name;
  if (!merged.location && location) merged.location = location;
  return merged;
}

export async function fetchSmartRecruitersPostings(company, { fetchImpl = fetch, retry } = {}) {
  const slug = normalizeCompanySlug(company);
  const postings = [];
  let offset = 0;

  while (true) {
    const url = buildListUrl(slug, offset);
    const response = await fetchWithRetry(url, {
      fetchImpl,
      headers: SMARTRECRUITERS_HEADERS,
      retry,
    });
    if (!response.ok) {
      const statusLabel = `${response.status} ${response.statusText}`;
      throw new Error(`Failed to fetch SmartRecruiters company ${slug}: ${statusLabel}`);
    }
    const payload = await response.json();
    const items = Array.isArray(payload?.content) ? payload.content : [];
    postings.push(...items);
    const totalFound =
      typeof payload?.totalFound === 'number' ? payload.totalFound : postings.length;
    offset += items.length;
    if (offset >= totalFound || items.length < DEFAULT_LIMIT) {
      break;
    }
    if (items.length === 0) break;
  }

  return { slug, postings };
}

export async function ingestSmartRecruitersBoard({ company, fetchImpl = fetch, retry } = {}) {
  const { slug, postings } = await fetchSmartRecruitersPostings(company, { fetchImpl, retry });
  const jobIds = [];

  for (const posting of postings) {
    const detailUrl = resolveDetailUrl(slug, posting);
    const detailResponse = await fetchWithRetry(detailUrl, {
      fetchImpl,
      headers: SMARTRECRUITERS_HEADERS,
      retry,
    });
    if (!detailResponse.ok) {
      const statusLabel = `${detailResponse.status} ${detailResponse.statusText}`;
      const postingId = posting?.id ?? '';
      throw new Error(
        `Failed to fetch SmartRecruiters posting ${postingId}: ${statusLabel}`,
      );
    }
    const detail = await detailResponse.json();
    const sectionsText = extractSectionsText(detail);
    const raw = sectionsText || toPlainText(detail?.jobAd?.text) || '';
    const parsed = mergeParsedJob(parseJobText(raw), posting, detail);
    const postingUrl =
      (typeof detail?.postingUrl === 'string' && detail.postingUrl.trim()) ||
      (typeof posting?.postingUrl === 'string' && posting.postingUrl.trim()) ||
      (typeof posting?.applyUrl === 'string' && posting.applyUrl.trim()) ||
      detailUrl;
    const id = jobIdFromSource({ provider: 'smartrecruiters', url: postingUrl });
    await saveJobSnapshot({
      id,
      raw,
      parsed,
      source: { type: 'smartrecruiters', value: postingUrl },
      requestHeaders: SMARTRECRUITERS_HEADERS,
      fetchedAt: detail?.releasedDate ?? posting?.releasedDate,
    });
    jobIds.push(id);
  }

  return { company: slug, saved: jobIds.length, jobIds };
}
