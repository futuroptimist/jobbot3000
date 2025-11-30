function clean(value) {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.trim();
}

function joinNonEmpty(values, separator = ', ') {
  return values.filter(Boolean).join(separator);
}

function formatLocation(location) {
  if (!location || typeof location !== 'object') return '';
  const { city, region, country, address } = location;
  return joinNonEmpty([clean(city), clean(region), clean(country) || clean(address)]);
}

function formatDateRange({ startDate, endDate }) {
  const start = clean(startDate);
  const end = clean(endDate) || (start ? 'Present' : '');
  if (!start && !end) return '';
  if (!start) return end;
  if (!end) return start;
  return `${start} – ${end}`;
}

function formatHighlights(highlights) {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .map(clean)
    .filter(Boolean)
    .map(highlight => `  • ${highlight}`);
}

function formatSkill(skill) {
  if (skill == null) return '';
  if (typeof skill === 'string') {
    return clean(skill);
  }
  if (typeof skill !== 'object') {
    return clean(String(skill));
  }
  const name = clean(skill.name);
  const level = clean(skill.level);
  const keywords = Array.isArray(skill.keywords)
    ? skill.keywords.map(clean).filter(Boolean)
    : [];

  const parts = [];
  if (name) parts.push(name);
  if (level) parts.push(level);

  let base = parts.length ? parts.join(' — ') : '';
  if (keywords.length) {
    const keywordList = keywords.join(', ');
    base = base ? `${base} (${keywordList})` : keywordList;
  }
  return base;
}

function formatSkills(skills) {
  if (!Array.isArray(skills)) return [];
  const formatted = [];
  for (const skill of skills) {
    const text = formatSkill(skill);
    if (text) {
      formatted.push(`- ${text}`);
    }
  }
  return formatted;
}

function formatTimelineEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const lines = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const primary =
      clean(entry.company) ||
      clean(entry.organization) ||
      clean(entry.institution) ||
      clean(entry.name);
    const secondary =
      clean(entry.position) ||
      clean(entry.title) ||
      clean(entry.area) ||
      clean(entry.role) ||
      clean(entry.studyType);
    const headerParts = [];
    if (primary) headerParts.push(primary);
    if (secondary) headerParts.push(secondary);
    const header = headerParts.length ? headerParts.join(' — ') : primary || secondary;
    const dates = formatDateRange(entry);
    const summaryLine = header ? `- ${header}` : '-';
    lines.push(dates ? `${summaryLine} (${dates})` : summaryLine);

    const description = clean(entry.description || entry.summary);
    if (description) {
      lines.push(`  • ${description}`);
    }
    lines.push(...formatHighlights(entry.highlights));
  }
  return lines;
}

function appendSection(lines, title, sectionLines) {
  if (sectionLines.length === 0) return;
  lines.push('');
  lines.push(title);
  lines.push(...sectionLines);
}

const ONE_PAGE_MAX_LINES = 60;

function clampPreviewLines(lines) {
  if (!Array.isArray(lines)) return [];
  if (lines.length <= ONE_PAGE_MAX_LINES) {
    if (lines.length === 0 || lines[lines.length - 1] !== '') {
      lines.push('');
    }
    return lines;
  }

  const limited = lines.slice(0, ONE_PAGE_MAX_LINES - 1);
  let lastContentIndex = -1;
  for (let i = limited.length - 1; i >= 0; i -= 1) {
    if (limited[i] !== '') {
      lastContentIndex = i;
      break;
    }
  }

  if (lastContentIndex >= 0 && lastContentIndex < limited.length - 1) {
    limited.length = lastContentIndex + 1;
  }

  limited.push('… (truncated for one-page preview)');
  return limited;
}

export function renderResumeTextPreview(resume) {
  if (!resume || typeof resume !== 'object') return '';
  const lines = [];
  const basics = typeof resume.basics === 'object' && resume.basics ? resume.basics : {};

  const name = clean(basics.name);
  if (name) lines.push(name);
  const label = clean(basics.label);
  if (label) lines.push(label);

  const contact = [];
  const email = clean(basics.email);
  if (email) contact.push(`Email: ${email}`);
  const location = formatLocation(basics.location);
  if (location) contact.push(`Location: ${location}`);
  const phone = clean(basics.phone);
  if (phone) contact.push(`Phone: ${phone}`);
  const url = clean(basics.url || basics.website);
  if (url) contact.push(`Website: ${url}`);

  if (contact.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(...contact);
  }

  const summary = clean(basics.summary);
  if (summary) {
    lines.push('');
    lines.push('Summary:');
    lines.push(summary);
  }

  appendSection(lines, 'Work Experience:', formatTimelineEntries(resume.work));
  appendSection(lines, 'Projects:', formatTimelineEntries(resume.projects));
  appendSection(lines, 'Education:', formatTimelineEntries(resume.education));
  appendSection(lines, 'Volunteer:', formatTimelineEntries(resume.volunteer));
  appendSection(lines, 'Skills:', formatSkills(resume.skills));

  return clampPreviewLines(lines).join('\n');
}
