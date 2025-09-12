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
 * Locate the first header line.
 *
 * Scans the lines once, returning the first match from `primary`. If no primary
 * headers match, the first `fallback` match is used. When nothing matches, the
 * index is -1 and the pattern is null.
 *
 * @param {string[]} lines
 * @param {RegExp[]} primary
 * @param {RegExp[]} fallback
 * @returns {{ index: number, pattern: RegExp | null }}
 */
function findHeader(lines, primary, fallback) {
  let fallbackResult = null;

  for (const [index, line] of lines.entries()) {
    const primaryPattern = primary.find(p => p.test(line));
    if (primaryPattern) return { index, pattern: primaryPattern };

    if (!fallbackResult) {
      const fallbackPattern = fallback.find(p => p.test(line));
      if (fallbackPattern) fallbackResult = { index, pattern: fallbackPattern };
    }
  }

  return fallbackResult || { index: -1, pattern: null };
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
  const { index: idx, pattern: headerPattern } = findHeader(
    lines,
    REQUIREMENTS_HEADERS,
    FALLBACK_REQUIREMENTS_HEADERS
  );
  if (idx === -1) return [];

  const requirements = [];
  const headerLine = lines[idx];
  let rest = headerLine.replace(headerPattern, '').trim();
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
