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

// Common bullet prefix regex, supports -, +, *, •, ·, en dash, em dash, digits, punctuation, etc.
const BULLET_PREFIX_RE = /^[-+*•\u00B7\u2013\u2014\d.)(\s]+/;

/** Strip common bullet characters and surrounding whitespace from a line. */
function stripBullet(line) {
  return line.replace(BULLET_PREFIX_RE, '').trim();
}

/** Check if a line matches any pattern in the provided array. */
function matchAny(line, patterns) {
  return patterns.some(pattern => pattern.test(line));
}

/**
 * Find the index of the first header in `primary` or fall back to headers in `fallback`.
 * Returns -1 if no headers match.
 */
function findHeaderIndex(lines, primary, fallback) {
  for (const group of [primary, fallback]) {
    const idx = lines.findIndex(line => matchAny(line, group));
    if (idx !== -1) return idx;
  }
  return -1;
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

/** Extract requirement bullets after a known header line. */
function extractRequirements(lines) {
  const idx = findHeaderIndex(lines, REQUIREMENTS_HEADERS, FALLBACK_REQUIREMENTS_HEADERS);
  if (idx === -1) return [];

  const requirements = [];
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

  return requirements;
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
  const requirements = extractRequirements(lines);

  return { title, company, requirements, body: text };
}
