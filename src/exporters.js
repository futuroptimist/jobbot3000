import { t, DEFAULT_LOCALE } from './i18n.js';

export function toJson(data) {
  return JSON.stringify(data, null, 2);
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
  const prefix = leadingNewline && lines.length ? '\n' : '';
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
