export function toJson(data) {
  return JSON.stringify(data, null, 2);
}

export function toMarkdownSummary({ title, company, location, requirements, summary }) {
  const lines = [];
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**Company**: ${company}`);
  if (location) lines.push(`**Location**: ${location}`);
  if (summary) lines.push(`\n${summary}\n`);
  if (requirements && requirements.length) {
    lines.push('## Requirements');
    for (const r of requirements) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

export function toMarkdownMatch({ title, company, location, score, matched, missing }) {
  const lines = [];
  if (title) lines.push(`# ${title}`);
  if (company) lines.push(`**Company**: ${company}`);
  if (location) lines.push(`**Location**: ${location}`);
  if (typeof score === 'number') lines.push(`**Fit Score**: ${score}%`);
  if (matched && matched.length) {
    lines.push('\n## Matched');
    for (const m of matched) lines.push(`- ${m}`);
  }
  if (missing && missing.length) {
    lines.push('\n## Missing');
    for (const m of missing) lines.push(`- ${m}`);
  }
  return lines.join('\n');
}


