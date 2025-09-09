const TITLE_PATTERNS = [
  /\bTitle\s*:\s*(.+)/i,
  /\bJob Title\s*:\s*(.+)/i,
  /\bPosition\s*:\s*(.+)/i
];

const COMPANY_PATTERNS = [
  /\bCompany\s*:\s*(.+)/i,
  /\bEmployer\s*:\s*(.+)/i
];

const REQUIREMENTS_HEADERS = [
  /\bRequirements\b/i,
  /\bQualifications\b/i,
  /\bWhat you(?:'|’)ll need\b/i
];

const FALLBACK_REQUIREMENTS_HEADERS = [/\bResponsibilities\b/i];

// Common bullet prefix regex
const BULLET_PREFIX_RE = /^[-+*•\u00B7\u2013\u2014\d.)(\s]+/;

/** Strip common bullet characters and surrounding whitespace from a line. */
function stripBullet(line) {
  return line.replace(BULLET_PREFIX_RE, '').trim();
}

/**
 * Find the index of the first header in `primary` or fall back to headers in `fallback`.
 * Returns -1 if no headers match.
 */
function findHeaderIndex(lines, primary, fallback) {
  const idx = lines.findIndex(l => primary.some(h => h.test(l)));
  return idx !== -1 ? idx : lines.findIndex(l => fallback.some(h => h.test(l)));
}

function findFirstMatch(lines, patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }
  }
  return '';
}

/** Parse raw job posting text into structured fields. */
export function parseJobText(rawText) {
  if (!rawText) {
    return { title: '', company: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  const title = findFirstMatch(lines, TITLE_PATTERNS);
  const company = findFirstMatch(lines, COMPANY_PATTERNS);

  // Extract requirements bullets after a known header. Prefer primary headers, but fall back to
  // "Responsibilities" if none are present.
  const requirements = [];
  const idx = findHeaderIndex(lines, REQUIREMENTS_HEADERS, FALLBACK_REQUIREMENTS_HEADERS);
  if (idx !== -1) {
    const headerLine = lines[idx];
    const headerPattern = REQUIREMENTS_HEADERS.find(h => h.test(headerLine));
    let rest = headerPattern ? headerLine.replace(headerPattern, '').trim() : '';
    rest = rest.replace(/^[:\s]+/, '');
    if (rest) {
      // Strip bullet characters when the first requirement follows the header.
      const first = stripBullet(rest);
      if (first) requirements.push(first);
    }

    for (let i = idx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^[A-Za-z].+:$/.test(line)) break; // next section header
      const bullet = stripBullet(line);
      if (bullet) requirements.push(bullet);
    }
  }

  return { title, company, requirements, body: text };
}
