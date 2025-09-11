export function toJson(data) {
  return JSON.stringify(data, null, 2);
}

/**
 * Escape Markdown control characters to prevent injection.
 * @param {string} text
 * @returns {string}
 */
function escapeMd(text = '') {
  return text
    // Escapes characters with special meaning in Markdown
    .replace(/[`*_{}\[\]<>\\()]/g, '\\$&') // eslint-disable-line no-useless-escape
    .replace(/^([#\-+*])/u, '\\$1');
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
  for (const item of items) lines.push(`- ${escapeMd(item)}`);
}

export function toMarkdownSummary({ title, company, requirements, summary }) {
  const lines = [];
  if (title) lines.push(`# ${escapeMd(title)}`);
  if (company) lines.push(`**Company**: ${escapeMd(company)}`);
  if (summary) lines.push(`\n${escapeMd(summary)}\n`);
  appendListSection(lines, 'Requirements', requirements);
  return lines.join('\n');
}

export function toMarkdownMatch({ title, company, score, matched, missing }) {
  const lines = [];
  if (title) lines.push(`# ${escapeMd(title)}`);
  if (company) lines.push(`**Company**: ${escapeMd(company)}`);
  if (typeof score === 'number') lines.push(`**Fit Score**: ${score}%`);
  appendListSection(lines, 'Matched', matched, { leadingNewline: true });
  appendListSection(lines, 'Missing', missing, { leadingNewline: true });
  return lines.join('\n');
}


