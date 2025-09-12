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
 * Find the index of the first header in `primary` or fall back to headers in `fallback`.
 * Returns an object with the line index and the matched pattern.
 * If no headers match, the index is -1 and the pattern is null.
 *
 * This implementation scans the lines once: if a primary header is found, it
 * returns immediately; otherwise, it tracks the first fallback match and uses
 * it if no primary headers matched.
 */
function findHeader(lines, primary, fallback) {
  let fallbackIdx = -1;
  let fallbackPattern = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Check primary headers
    for (let p = 0; p < primary.length; p += 1) {
      const pattern = primary[p];
      if (pattern.test(line)) {
        return { index: i, pattern };
      }
    }

    // Track first fallback header
    if (fallbackIdx === -1) {
      for (let f = 0; f < fallback.length; f += 1) {
        const pattern = fallback[f];
        if (pattern.test(line)) {
          fallbackIdx = i;
          fallbackPattern = pattern;
          break;
        }
      }
    }
  }

  return {
    index: fallbackIdx,
    pattern: fallbackIdx !== -1 ? fallbackPattern : null,
  };
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
