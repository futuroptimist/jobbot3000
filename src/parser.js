function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FIELD_SEPARATOR = '\\s*(?::|[-\\u2013\\u2014])\\s*';

function createFieldPattern(label) {
  const escaped = escapeForRegex(label).replace(/\s+/g, '\\s+');
  return new RegExp(`^\\s*${escaped}${FIELD_SEPARATOR}(.+)`, 'i');
}

const TITLE_PATTERNS = ['Title', 'Job Title', 'Position', 'Role'].map(createFieldPattern);

const COMPANY_PATTERNS = ['Company', 'Employer'].map(createFieldPattern);

const LOCATION_PATTERNS = ['Location'].map(createFieldPattern);

const REQUIREMENTS_HEADERS = [
  /\bRequirements\b/i,
  /\bQualifications\b/i,
  /\bWhat you(?:'|’)ll need\b/i
];

const FALLBACK_REQUIREMENTS_HEADERS = [/\bResponsibilities\b/i];

// Common bullet prefix regex. Strips '-', '+', '*', '•', '·', en/em dashes,
// numeric markers like `1.` or `1)`, alphabetical markers like `a.` or `a)`,
// and parenthetical numbers or letters like `(1)` or `(a)`.
// Preserves leading digits that are part of the requirement text itself.
const BULLET_PREFIX_RE =
  /^(?:[-+*•\u00B7\u2013\u2014]\s*|(?:\d+|[A-Za-z])[.)]\s*|\((?:\d+|[A-Za-z])\)\s*)/;

/** Strip common bullet characters and surrounding whitespace from a line. */
function stripBullet(line) {
  return line.replace(BULLET_PREFIX_RE, '').trim();
}

/**
 * Locate the first line matching any regex in `patterns`.
 * Returns the line index and the matching pattern, or -1/null when not found.
 * Shared by header and field scanners to keep parsing logic consistent.
 */
function findFirstPatternIndex(lines, patterns) {
  for (let i = 0; i < lines.length; i += 1) {
    const pattern = patterns.find(p => p.test(lines[i]));
    if (pattern) return { index: i, pattern };
  }
  return { index: -1, pattern: null };
}

/**
 * Find the index of the first header in `primary` or fall back to headers in `fallback`.
 * Prefers primary headers even if a fallback header appears earlier.
 */
function findHeader(lines, primary, fallback) {
  const primaryResult = findFirstPatternIndex(lines, primary);
  if (primaryResult.index !== -1) return primaryResult;
  return findFirstPatternIndex(lines, fallback);
}

function findFirstMatch(lines, patterns) {
  const { index, pattern } = findFirstPatternIndex(lines, patterns);
  if (index === -1 || !pattern) return '';
  const match = lines[index].match(pattern);
  return match ? match[1].trim() : '';
}

/**
 * Extract requirement bullets after a known header line.
 * Supports requirement text on the same line for both primary and fallback headers.
 */
function extractRequirements(lines) {
  const { index: headerIndex, pattern: headerPattern } = findHeader(
    lines,
    REQUIREMENTS_HEADERS,
    FALLBACK_REQUIREMENTS_HEADERS
  );
  if (headerIndex === -1) return [];

  const requirements = [];
  const headerLine = lines[headerIndex];
  let rest = headerLine.replace(headerPattern, '').trim();
  rest = rest.replace(/^[:\s]+/, '');

  if (rest) {
    // Strip bullet characters when the first requirement follows the header.
    const first = stripBullet(rest);
    if (first) requirements.push(first);
  }

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
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
    return { title: '', company: '', location: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  const title = findFirstMatch(lines, TITLE_PATTERNS);
  const company = findFirstMatch(lines, COMPANY_PATTERNS);
  const location = findFirstMatch(lines, LOCATION_PATTERNS);
  const requirements = extractRequirements(lines);

  return { title, company, location, requirements, body: text };
}
