import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

import { t, DEFAULT_LOCALE } from './i18n.js';
import { identifyBlockers } from './blockers.js';
import { redactValue } from './shared/security/redaction.js';

export function toJson(data) {
  const redacted = redactValue(data ?? null);
  return JSON.stringify(redacted, null, 2);
}

function sanitizeText(value) {
  if (value === null || value === undefined) return '';
  const normalized = typeof value === 'string' ? value : String(value);
  const redacted = redactValue(normalized);
  if (typeof redacted === 'string') {
    return redacted;
  }
  return redacted === null || redacted === undefined
    ? ''
    : String(redacted);
}

const MARKDOWN_ESCAPE_CHARS = [
  '\\',
  '`',
  '*',
  '_',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '#',
  '+',
  '-',
  '!',
  '|',
];

const CHAR_CLASS_ESCAPE_RE = /[\\\-\]]/g;

function escapeForCharClass(ch) {
  if (ch === '[') return '\\[';
  return ch.replace(CHAR_CLASS_ESCAPE_RE, '\\$&');
}

const MARKDOWN_ESCAPE_RE = new RegExp(
  `[${MARKDOWN_ESCAPE_CHARS.map(escapeForCharClass).join('')}]`,
  'g'
);

function escapeMarkdownString(value) {
  return value.replace(MARKDOWN_ESCAPE_RE, '\\$&');
}

function escapeMarkdown(value) {
  if (value === null || value === undefined) return '';
  const sanitized = sanitizeText(value);
  if (!sanitized) return '';
  return escapeMarkdownString(sanitized);
}

function escapeMarkdownMultiline(value) {
  if (value === null || value === undefined) return '';
  const sanitized = sanitizeText(value);
  if (!sanitized) return '';
  return sanitized
    .split('\n')
    .map(escapeMarkdownString)
    .join('\n');
}

function normalizeRequirementList(list) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const trimmed = sanitizeText(entry).trim();
    if (trimmed) normalized.push(trimmed);
  }
  return normalized;
}

function ensureParagraphs(paragraphs) {
  if (paragraphs.length > 0) return paragraphs;
  return [new Paragraph('')];
}

function headingParagraph(text, level = HeadingLevel.HEADING_1) {
  if (!text) return null;
  const value = sanitizeText(text).trim();
  if (!value) return null;
  return new Paragraph({ text: value, heading: level });
}

function labelParagraph(label, value) {
  if (!label || value == null) return null;
  const text = sanitizeText(value).trim();
  if (!text) return null;
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text }),
    ],
  });
}

function appendMultilineText(paragraphs, value) {
  if (value == null) return;
  const lines = sanitizeText(value)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    paragraphs.push(new Paragraph({ text: line }));
  }
}

function appendBulletList(paragraphs, items) {
  for (const item of items) {
    const sanitized = sanitizeText(item).trim();
    if (!sanitized) continue;
    paragraphs.push(
      new Paragraph({
        text: sanitized,
        bullet: { level: 0 },
      })
    );
  }
}

async function packDocument(paragraphs) {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: ensureParagraphs(paragraphs),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/**
 * Append a Markdown header and bullet list if `items` exist.
 * @param {string[]} lines Accumulator array of lines.
 * @param {string} header Section title without the leading `##`.
 * @param {string[]} items Bullet list items to append.
 * @param {object} [opts]
 * @param {boolean} [opts.leadingNewline=false] Prefix section with a blank line when true.
 */
function appendListSection(lines, header, items, { leadingNewline = false } = {}) {
  if (!items || !items.length) return;
  const prefix = leadingNewline && lines.length > 0 ? '\n' : '';
  lines.push(`${prefix}## ${header}`);
  for (const item of items) {
    const safeItem = escapeMarkdownMultiline(item);
    if (safeItem) lines.push(`- ${safeItem}`);
  }
}

/**
 * Format parsed job data as Markdown.
 * @param {object} params
 * @param {string} [params.title]
 * @param {string} [params.company]
 * @param {string} [params.location]
 * @param {string} [params.url] Link to the job posting.
 * @param {string[]} [params.requirements]
 * @param {string} [params.summary]
 * @returns {string}
 */
export function toMarkdownSummary({
  title,
  company,
  location,
  url,
  requirements,
  summary,
  locale = DEFAULT_LOCALE,
}) {
  const lines = [];
  const safeTitle = escapeMarkdown(title);
  const safeCompany = escapeMarkdown(company);
  const safeLocation = escapeMarkdown(location);
  const safeUrl = escapeMarkdown(url);

  if (safeTitle) lines.push(`# ${safeTitle}`);
  if (safeCompany) lines.push(`**${t('company', locale)}**: ${safeCompany}`);
  if (safeLocation) lines.push(`**${t('location', locale)}**: ${safeLocation}`);
  if (safeUrl) lines.push(`**${t('url', locale)}**: ${safeUrl}`);

  const safeSummary = escapeMarkdownMultiline(summary);
  if (safeSummary) {
    lines.push('', `## ${t('summary', locale)}`, '', safeSummary);
    if (!requirements || !requirements.length) lines.push('');
  }

  const needsNewline = lines.length > 0 && !lines[lines.length - 1].endsWith('\n');
  appendListSection(lines, t('requirements', locale), requirements, {
    leadingNewline: needsNewline,
  });

  return lines.join('\n');
}

/**
 * Format resume match results as Markdown.
 * @param {object} params
 * @param {string} [params.title]
 * @param {string} [params.company]
 * @param {string} [params.location]
 * @param {string} [params.url] Link to the job posting.
 * @param {number} [params.score] Fit score percentage.
 * @param {string[]} [params.matched]
 * @param {string[]} [params.missing]
 * @returns {string}
 */
export function toMarkdownMatch({
  title,
  company,
  location,
  url,
  score,
  matched,
  missing,
  locale = DEFAULT_LOCALE,
}) {
  const lines = [];
  const safeTitle = escapeMarkdown(title);
  const safeCompany = escapeMarkdown(company);
  const safeLocation = escapeMarkdown(location);
  const safeUrl = escapeMarkdown(url);

  if (safeTitle) lines.push(`# ${safeTitle}`);
  if (safeCompany) lines.push(`**${t('company', locale)}**: ${safeCompany}`);
  if (safeLocation) lines.push(`**${t('location', locale)}**: ${safeLocation}`);
  if (safeUrl) lines.push(`**${t('url', locale)}**: ${safeUrl}`);
  if (typeof score === 'number')
    lines.push(`**${t('fitScore', locale)}**: ${score}%`);
  appendListSection(lines, t('matched', locale), matched, { leadingNewline: true });
  appendListSection(lines, t('missing', locale), missing, { leadingNewline: true });
  return lines.join('\n');
}

const EXPLANATION_LIMIT = 5;

export function formatMatchExplanation({
  matched,
  missing,
  score,
  locale = DEFAULT_LOCALE,
  limit = EXPLANATION_LIMIT,
} = {}) {
  const hits = normalizeRequirementList(matched);
  const gaps = normalizeRequirementList(missing);
  const total = hits.length + gaps.length;
  const safeScore =
    typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : 0;
  const summary = t('coverageSummary', locale, {
    matched: hits.length,
    total,
    score: safeScore,
  });

  const capped = Math.max(1, Number(limit) || EXPLANATION_LIMIT);
  const hitsLine = hits.length
    ? `${t('hits', locale)}: ${hits.slice(0, capped).join('; ')}`
    : t('noHits', locale);
  const gapsLine = gaps.length
    ? `${t('gaps', locale)}: ${gaps.slice(0, capped).join('; ')}`
    : t('noGaps', locale);

  const blockers = identifyBlockers(gaps);
  const blockersLine = blockers.length
    ? `${t('blockers', locale)}: ${blockers.slice(0, capped).join('; ')}`
    : t('noBlockers', locale);

  return [summary, hitsLine, gapsLine, blockersLine].join('\n');
}

export function toMarkdownMatchExplanation(options) {
  const locale = options?.locale ?? DEFAULT_LOCALE;
  const explanation = formatMatchExplanation({ ...options, locale });
  const safeExplanation = escapeMarkdownMultiline(explanation);
  const heading = `## ${t('explanation', locale)}`;
  return safeExplanation ? `${heading}\n\n${safeExplanation}` : heading;
}

export async function toDocxSummary({
  title,
  company,
  location,
  url,
  summary,
  requirements,
  locale = DEFAULT_LOCALE,
}) {
  const paragraphs = [];
  const heading = headingParagraph(title, HeadingLevel.HEADING_1);
  if (heading) paragraphs.push(heading);

  const companyLine = labelParagraph(t('company', locale), company);
  if (companyLine) paragraphs.push(companyLine);
  const locationLine = labelParagraph(t('location', locale), location);
  if (locationLine) paragraphs.push(locationLine);
  const urlLine = labelParagraph(t('url', locale), url);
  if (urlLine) paragraphs.push(urlLine);

  const normalizedSummary = summary == null ? '' : String(summary).trim();
  if (normalizedSummary) {
    const summaryHeading = headingParagraph(t('summary', locale), HeadingLevel.HEADING_2);
    if (summaryHeading) paragraphs.push(summaryHeading);
    appendMultilineText(paragraphs, summary);
  }

  const normalizedRequirements = normalizeRequirementList(requirements);
  if (normalizedRequirements.length > 0) {
    const requirementsHeading = headingParagraph(
      t('requirements', locale),
      HeadingLevel.HEADING_2
    );
    if (requirementsHeading) paragraphs.push(requirementsHeading);
    appendBulletList(paragraphs, normalizedRequirements);
  }

  return packDocument(paragraphs);
}

export async function toDocxMatch({
  title,
  company,
  location,
  url,
  score,
  matched,
  missing,
  locale = DEFAULT_LOCALE,
}) {
  const paragraphs = [];
  const heading = headingParagraph(title, HeadingLevel.HEADING_1);
  if (heading) paragraphs.push(heading);

  const companyLine = labelParagraph(t('company', locale), company);
  if (companyLine) paragraphs.push(companyLine);
  const locationLine = labelParagraph(t('location', locale), location);
  if (locationLine) paragraphs.push(locationLine);
  const urlLine = labelParagraph(t('url', locale), url);
  if (urlLine) paragraphs.push(urlLine);
  if (typeof score === 'number' && Number.isFinite(score)) {
    const scoreLine = labelParagraph(t('fitScore', locale), `${score}%`);
    if (scoreLine) paragraphs.push(scoreLine);
  }

  const hits = normalizeRequirementList(matched);
  if (hits.length > 0) {
    const hitsHeading = headingParagraph(t('matched', locale), HeadingLevel.HEADING_2);
    if (hitsHeading) paragraphs.push(hitsHeading);
    appendBulletList(paragraphs, hits);
  }

  const gaps = normalizeRequirementList(missing);
  if (gaps.length > 0) {
    const gapsHeading = headingParagraph(t('missing', locale), HeadingLevel.HEADING_2);
    if (gapsHeading) paragraphs.push(gapsHeading);
    appendBulletList(paragraphs, gaps);
  }

  const blockers = identifyBlockers(gaps);
  if (blockers.length > 0) {
    const blockersHeading = headingParagraph(t('blockers', locale), HeadingLevel.HEADING_2);
    if (blockersHeading) paragraphs.push(blockersHeading);
    appendBulletList(paragraphs, blockers);
  }

  return packDocument(paragraphs);
}
