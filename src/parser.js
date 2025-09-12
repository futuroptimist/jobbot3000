// Metadata field headers used by job postings.
const FIELD_NAMES = [
  'Title',
  'Job Title',
  'Position',
  'Company',
  'Employer',
  'Location'
];
const FIELD_NAME_RE = FIELD_NAMES.join('|');
const FIELD_PREFIX_RE = new RegExp(`\\b(?:${FIELD_NAME_RE})\\b`, 'i');
// Global regex to capture each field value, even when multiple appear on one line.
const FIELD_PATTERN = new RegExp(
  `\\b(${FIELD_NAME_RE})\\s*:\\s*([^\\n]*?)(?=\\b(?:${FIELD_NAME_RE})\\s*:|$)`,
  'gi'
);

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

function findHeader(lines, primary, fallback) {
  let fallbackIdx = -1;
  let fallbackPattern = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const primaryMatch = primary.find(p => p.test(line));
    if (primaryMatch) {
      return { index: i, pattern: primaryMatch };
    }
    if (fallbackIdx === -1) {
      const fallbackMatch = fallback.find(p => p.test(line));
      if (fallbackMatch) {
        fallbackIdx = i;
        fallbackPattern = fallbackMatch;
      }
    }
  }

  return {
    index: fallbackIdx,
    pattern: fallbackIdx !== -1 ? fallbackPattern : null,
  };
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

/**
 * Parse raw job posting text into structured fields.
 * Scans lines once to extract title, company, and location, handling multiple
 * fields on a single line for efficiency.
*/
export function parseJobText(rawText) {
  if (!rawText) {
    return { title: '', company: '', location: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  let title = '';
  let company = '';
  let location = '';

  for (const line of lines) {
    if (title && company && location) break;
    if (!FIELD_PREFIX_RE.test(line)) continue;
    FIELD_PATTERN.lastIndex = 0;
    let match;
    while ((match = FIELD_PATTERN.exec(line)) !== null) {
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      if (!title && (key === 'title' || key === 'job title' || key === 'position')) {
        title = value;
      } else if (!company && (key === 'company' || key === 'employer')) {
        company = value;
      } else if (!location && key === 'location') {
        location = value;
      }
      if (title && company && location) break;
    }
  }

  const requirements = extractRequirements(lines);

  return { title, company, location, requirements, body: text };
}
