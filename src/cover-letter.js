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
  'g',
);

function escapeMarkdown(value) {
  if (value == null) return '';
  return String(value).replace(MARKDOWN_ESCAPE_RE, '\\$&');
}

function sanitizeInline(value) {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  if (!trimmed) return '';
  return escapeMarkdown(trimmed.replace(/\s+/g, ' '));
}

function formatLocation(location) {
  if (!location || typeof location !== 'object') return '';
  const parts = [];
  const city = sanitizeInline(location.city);
  if (city) parts.push(city);
  const region = sanitizeInline(location.region);
  if (region) parts.push(region);
  const country = sanitizeInline(location.country);
  if (country) parts.push(country);
  return parts.join(', ');
}

function formatContactLine(basics) {
  if (!basics || typeof basics !== 'object') return '';
  const parts = [];
  const email = sanitizeInline(basics.email);
  if (email) parts.push(email);
  const phone = sanitizeInline(basics.phone);
  if (phone) parts.push(phone);
  const location = formatLocation(basics.location);
  if (location) parts.push(location);
  const website = sanitizeInline(basics.website || basics.url);
  if (website) parts.push(website);
  return parts.join(' | ');
}

function uniqueSanitizedEntries(entries, limit) {
  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const sanitized = sanitizeInline(entry);
    if (!sanitized) continue;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sanitized);
    if (unique.length >= limit) break;
  }
  return unique;
}

function collectMatchedSkills(match, limit = 3) {
  if (!match || typeof match !== 'object') return [];
  const entries = [];
  if (Array.isArray(match.matched)) entries.push(...match.matched);
  if (Array.isArray(match.skills_hit)) entries.push(...match.skills_hit);
  if (Array.isArray(match.requirements)) entries.push(...match.requirements.slice(0, limit));
  return uniqueSanitizedEntries(entries, limit);
}

function collectHighlights(resume, limit = 3) {
  if (!resume || typeof resume !== 'object') return [];
  const highlights = [];
  const seen = new Set();
  const add = value => {
    const sanitized = sanitizeInline(value);
    if (!sanitized) return;
    const key = sanitized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    highlights.push(sanitized);
  };

  const sections = ['work', 'projects', 'volunteer'];
  for (const section of sections) {
    const entries = Array.isArray(resume[section]) ? resume[section] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const list = Array.isArray(entry.highlights) ? entry.highlights : [];
      for (const item of list) {
        add(item);
        if (highlights.length >= limit) return highlights.slice(0, limit);
      }
      if (entry.summary) {
        add(entry.summary);
        if (highlights.length >= limit) return highlights.slice(0, limit);
      }
      if (entry.description) {
        add(entry.description);
        if (highlights.length >= limit) return highlights.slice(0, limit);
      }
    }
  }

  if (highlights.length < limit && resume.basics) {
    add(resume.basics.summary);
  }

  return highlights.slice(0, limit);
}

function formatList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const allButLast = items.slice(0, -1).join(', ');
  const last = items[items.length - 1];
  return `${allButLast}, and ${last}`;
}

function resolveJobDetails(match, job) {
  if (job && typeof job === 'object') return job;
  return match && typeof match === 'object' ? match : {};
}

export function generateCoverLetter({ resume, match, job } = {}) {
  const basics = resume && typeof resume === 'object' ? resume.basics : undefined;
  const name = basics && typeof basics === 'object' ? sanitizeInline(basics.name) : '';
  const contactLine = formatContactLine(basics);
  const summary = basics && typeof basics === 'object' ? sanitizeInline(basics.summary) : '';

  const jobDetails = resolveJobDetails(match, job);
  const title = sanitizeInline(jobDetails?.title);
  const company = sanitizeInline(jobDetails?.company);
  const jobSummary = sanitizeInline(jobDetails?.summary);

  const matchedSkills = collectMatchedSkills(match, 3);
  const highlights = collectHighlights(resume, 3);

  const lines = [];
  if (name) lines.push(name);
  if (contactLine) lines.push(contactLine);
  if (lines.length > 0) lines.push('');

  const hiringLine = company ? `Hiring Team at ${company}` : 'Hiring Team';
  lines.push(hiringLine);
  lines.push('');
  lines.push('Hello,');
  lines.push('');

  const introParts = [];
  if (title && company) {
    introParts.push(`I'm excited to apply for the ${title} role at ${company}.`);
  } else if (title) {
    introParts.push(`I'm excited to apply for the ${title} role.`);
  } else if (company) {
    introParts.push(`I'm excited about the opportunity to contribute at ${company}.`);
  }
  if (jobSummary) {
    introParts.push(jobSummary);
  }
  const introParagraph = introParts.join(' ').trim();
  if (introParagraph) {
    lines.push(introParagraph);
    lines.push('');
  }

  if (summary) {
    lines.push(summary);
    lines.push('');
  }

  if (matchedSkills.length > 0) {
    lines.push(
      `Your focus on ${formatList(matchedSkills)} matches outcomes I've delivered in prior roles.`,
    );
    lines.push('');
  }

  if (!introParagraph && !summary && matchedSkills.length === 0) {
    lines.push('I appreciate the opportunity to be considered for this role.');
    lines.push('');
  }

  if (highlights.length > 0) {
    lines.push('Here are a few highlights that demonstrate the fit:');
    for (const highlight of highlights) {
      lines.push(`- ${highlight}`);
    }
    lines.push('');
  }

  const closingCompany = company || 'your team';
  lines.push(`I'd welcome the opportunity to discuss how I can support ${closingCompany}.`);
  lines.push('Thank you for your consideration.');
  lines.push('');
  lines.push('Sincerely,');
  lines.push(name || 'The jobbot3000 candidate');

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
