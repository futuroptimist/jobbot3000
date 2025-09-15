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
  const prefix = leadingNewline ? '\n' : '';
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
 *
 * When called with only a summary, the output begins directly with the "## Summary" header
 * without a leading blank line.
 */
export function toMarkdownSummary({ title, company, location, url, requirements, summary }) {
  const lines = [];
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**Company**: ${company}`);
  if (location) lines.push(`**Location**: ${location}`);
  if (url) lines.push(`**URL**: ${url}`);

  if (summary) {
    if (lines.length > 0) lines.push('', '## Summary', '', summary);
    else lines.push('## Summary', '', summary);
    if (!requirements || !requirements.length) lines.push('');
  }

  const needsNewline = lines.length > 0 && !lines[lines.length - 1].endsWith('\n');
  appendListSection(lines, 'Requirements', requirements, { leadingNewline: needsNewline });

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
}) {
  const lines = [];
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**Company**: ${company}`);
  if (location) lines.push(`**Location**: ${location}`);
  if (url) lines.push(`**URL**: ${url}`);
  if (typeof score === 'number') lines.push(`**Fit Score**: ${score}%`);
  appendListSection(lines, 'Matched', matched, { leadingNewline: true });
  appendListSection(lines, 'Missing', missing, { leadingNewline: true });
  return lines.join('\n');
}
