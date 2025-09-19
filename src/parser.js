const FIELD_LABELS = new Map([
  ['title', 'title'],
  ['job title', 'title'],
  ['position', 'title'],
  ['role', 'title'],
  ['company', 'company'],
  ['employer', 'company'],
  ['location', 'location']
]);

function isSeparatorCode(code) {
  return code === 58 || code === 45 || code === 8211 || code === 8212;
}

function findSeparatorIndex(line, startIndex) {
  for (let i = startIndex; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (isSeparatorCode(code)) return i;
  }
  return -1;
}

function normalizeFieldLabel(segment) {
  const trimmed = segment.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, ' ').toLowerCase();
}

function extractFieldValue(line, separatorIndex) {
  let valueStart = separatorIndex + 1;
  while (valueStart < line.length) {
    const code = line.charCodeAt(valueStart);
    if (code === 32 || code === 9) {
      valueStart += 1;
      continue;
    }
    if (isSeparatorCode(code)) {
      valueStart += 1;
      continue;
    }
    break;
  }
  return line.slice(valueStart).trim();
}

const REQUIREMENTS_HEADERS = [
  /\bRequirements\b/i,
  /\bQualifications\b/i,
  /^\s*Skills\b(?:\s*(?::|[-\u2013\u2014])\s*|$)/i,
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
    const line = lines[i];
    for (let j = 0; j < patterns.length; j += 1) {
      const pattern = patterns[j];
      if (pattern.test(line)) {
        if (pattern.lastIndex !== 0) pattern.lastIndex = 0;
        return { index: i, pattern };
      }
    }
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

function findFieldValues(lines) {
  let title = '';
  let company = '';
  let location = '';

  let fieldsRemaining = 3;

  for (let i = 0; i < lines.length && fieldsRemaining > 0; i += 1) {
    const line = lines[i];

    let cursor = 0;
    while (cursor < line.length) {
      const code = line.charCodeAt(cursor);
      if (code !== 32 && code !== 9) break;
      cursor += 1;
    }
    if (cursor >= line.length) continue;

    const separatorIndex = findSeparatorIndex(line, cursor);
    if (separatorIndex === -1) continue;

    const label = normalizeFieldLabel(line.slice(cursor, separatorIndex));
    if (!label) continue;

    const field = FIELD_LABELS.get(label);
    if (!field) continue;

    if (field === 'title' && title) continue;
    if (field === 'company' && company) continue;
    if (field === 'location' && location) continue;

    const value = extractFieldValue(line, separatorIndex);
    if (!value) continue;

    if (field === 'title') title = value;
    else if (field === 'company') company = value;
    else location = value;

    fieldsRemaining -= 1;
  }

  return { title, company, location };
}

/** Pull requirement text that shares the same line as the matched header. */
function extractInlineRequirement(headerLine, pattern) {
  const rest = headerLine.replace(pattern, '').trim().replace(/^[:\s]+/, '');
  if (!rest) return '';
  return stripBullet(rest);
}

/** Determine whether a trimmed line looks like the start of a new section. */
function isSectionHeader(line) {
  return /^[A-Za-z].+:$/.test(line);
}

/** Collect requirement bullet lines until the next section header appears. */
function collectRequirementLines(lines, startIndex) {
  const collected = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isSectionHeader(line)) break;
    const bullet = stripBullet(line);
    if (bullet) collected.push(bullet);
  }
  return collected;
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

  const inlineRequirement = extractInlineRequirement(lines[headerIndex], headerPattern);
  const subsequentLines = collectRequirementLines(lines, headerIndex + 1);

  if (!inlineRequirement) return subsequentLines;
  return [inlineRequirement, ...subsequentLines];
}

/** Parse raw job posting text into structured fields. */
export function parseJobText(rawText) {
  if (!rawText) {
    return { title: '', company: '', location: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  const { title, company, location } = findFieldValues(lines);
  const requirements = extractRequirements(lines);

  return { title, company, location, requirements, body: text };
}
