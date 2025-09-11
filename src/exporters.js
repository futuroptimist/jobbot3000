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
 * @param {string} [params.url] Link to the job posting.
 * @param {string[]} [params.requirements]
 * @param {string} [params.summary]
 * @returns {string}
 */
export function toMarkdownSummary({ title, company, url, requirements, summary }) {
  const lines = [];
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**Company**: ${company}`);
  if (url) lines.push(`**URL**: ${url}`);
  if (summary) lines.push(`\n${summary}\n`);
  appendListSection(lines, 'Requirements', requirements);
  return lines.join('\n');
}

export function toMarkdownMatch({ title, company, score, matched, missing }) {
  const lines = [];
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**Company**: ${company}`);
  if (typeof score === 'number') lines.push(`**Fit Score**: ${score}%`);
  appendListSection(lines, 'Matched', matched, { leadingNewline: true });
  appendListSection(lines, 'Missing', missing, { leadingNewline: true });
  return lines.join('\n');
}


