import { t, DEFAULT_LOCALE } from './i18n.js';

export function toJson(data) {
  return JSON.stringify(data, null, 2);
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
  for (const item of items) lines.push(`- ${item}`);
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
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**${t('company', locale)}**: ${company}`);
  if (location) lines.push(`**${t('location', locale)}**: ${location}`);
  if (url) lines.push(`**${t('url', locale)}**: ${url}`);

  if (summary) {
    lines.push('', `## ${t('summary', locale)}`, '', summary);
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
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**${t('company', locale)}**: ${company}`);
  if (location) lines.push(`**${t('location', locale)}**: ${location}`);
  if (url) lines.push(`**${t('url', locale)}**: ${url}`);
  if (typeof score === 'number')
    lines.push(`**${t('fitScore', locale)}**: ${score}%`);
  appendListSection(lines, t('matched', locale), matched, { leadingNewline: true });
  appendListSection(lines, t('missing', locale), missing, { leadingNewline: true });
  return lines.join('\n');
}
