import { t, DEFAULT_LOCALE } from './i18n.js';

export function toJson(data) {
  return JSON.stringify(data ?? null, null, 2);
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

function escapeMarkdown(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(MARKDOWN_ESCAPE_RE, '\\$&');
}

function escapeMarkdownMultiline(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .split('\n')
    .map(escapeMarkdown)
    .join('\n');
}

function normalizeRequirementList(list) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed) normalized.push(trimmed);
  }
  return normalized;
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

  return [summary, hitsLine, gapsLine].join('\n');
}

export function toMarkdownMatchExplanation(options) {
  const locale = options?.locale ?? DEFAULT_LOCALE;
  const explanation = formatMatchExplanation({ ...options, locale });
  const safeExplanation = escapeMarkdownMultiline(explanation);
  const heading = `## ${t('explanation', locale)}`;
  return safeExplanation ? `${heading}\n\n${safeExplanation}` : heading;
}
