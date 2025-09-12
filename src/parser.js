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

// Strip leading bullet markers without regex to reduce per-line allocations.
// Supports '-', '+', '*', '•', '·', en/em dashes, numeric lists like `1.` or
// `1)` and parenthetical numbers like `(1)`.
function stripBullet(line) {
  let i = 0;
  const len = line.length;
  if (!len) return '';

  const ch = line[i];
  // Simple bullets
  if (
    ch === '-' ||
    ch === '+' ||
    ch === '*' ||
    ch === '•' ||
    ch === '·' ||
    ch === '–' ||
    ch === '—'
  ) {
    i += 1;
  } else if (ch === '(') {
    // Parenthetical numbers like (1)
    let j = i + 1;
    while (j < len && line[j] >= '0' && line[j] <= '9') j += 1;
    if (j > i + 1 && j < len && line[j] === ')') {
      i = j + 1;
    }
  } else if (ch >= '0' && ch <= '9') {
    // Numeric lists like 1. or 1)
    let j = i;
    while (j < len && line[j] >= '0' && line[j] <= '9') j += 1;
    if (j < len && (line[j] === '.' || line[j] === ')')) {
      i = j + 1;
    }
  }

  while (i < len && line[i] === ' ') i += 1;
  return line.slice(i).trim();
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

    for (const pattern of primary) {
      if (pattern.test(line)) {
        return { index: i, pattern };
      }
    }

    if (fallbackIdx === -1) {
      for (const pattern of fallback) {
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
  // Manually split on newlines to avoid regex overhead.
  const lines = [];
  let start = 0;
  const len = text.length;
  for (let i = 0; i <= len; i += 1) {
    if (i === len || text[i] === '\n') {
      if (i > start) lines.push(text.slice(start, i));
      start = i + 1;
    }
  }

  const title = findFirstMatch(lines, TITLE_PATTERNS);
  const company = findFirstMatch(lines, COMPANY_PATTERNS);
  const location = findFirstMatch(lines, LOCATION_PATTERNS);
  const requirements = extractRequirements(lines);

  return { title, company, location, requirements, body: text };
}
