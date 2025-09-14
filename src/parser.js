const TITLE_PATTERNS = [
  /\bTitle\s*:\s*(.+)/i,
  /\bJob Title\s*:\s*(.+)/i,
  /\bPosition\s*:\s*(.+)/i
];

const COMPANY_PATTERNS = [
  /\bCompany\s*:\s*(.+)/i,
  /\bEmployer\s*:\s*(.+)/i
];

const LOCATION_PATTERNS = [/\bLocation\s*:\s*(.+)/i];

const REQUIREMENTS_HEADERS = [
  /\bRequirements\b/i,
  /\bQualifications\b/i,
  /\bWhat you(?:'|’)ll need\b/i
];

const FALLBACK_REQUIREMENTS_HEADERS = [/\bResponsibilities\b/i];

// Common bullet prefix regex. Strips '-', '+', '*', '•', '·', en/em dashes,
// numeric markers like `1.` or `1)` and parenthetical numbers like `(1)`.
// Preserves leading digits that are part of the requirement text itself.
const BULLET_PREFIX_RE = /^(?:[-+*•\u00B7\u2013\u2014]\s*|\d+[.)]\s*|\(\d+\)\s*)/;

/** Strip common bullet characters and surrounding whitespace from a line. */
function stripBullet(line) {
  return line.replace(BULLET_PREFIX_RE, '').trim();
}

/**
 * Locate the first line matching any regex in `patterns` and return metadata
 * about the match. The `pattern` is returned so callers can reuse the regex
 * without re-scanning, and the `match` captures the resulting groups for
 * convenience. When no match is found `index` is `-1` and `pattern`/`match`
 * are `null`.
 */
function findFirstPattern(lines, patterns) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const pattern = patterns.find(p => p.test(line));
    if (pattern) return { index: i, pattern, match: line.match(pattern) };
  }
  return { index: -1, pattern: null, match: null };
}

/**
 * Find the index of the first header in `primary` or fall back to headers in `fallback`.
 * Prefers primary headers even if a fallback header appears earlier.
 */
function findHeader(lines, primary, fallback) {
  const primaryResult = findFirstPattern(lines, primary);
  if (primaryResult.index !== -1) return primaryResult;
  return findFirstPattern(lines, fallback);
}

function findFirstMatch(lines, patterns) {
  const { match } = findFirstPattern(lines, patterns);
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
