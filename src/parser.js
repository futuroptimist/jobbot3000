function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FIELD_SEPARATOR = '\\s*(?::|[-\\u2013\\u2014])\\s*';

function createFieldPattern(label) {
  const escaped = escapeForRegex(label).replace(/\s+/g, '\\s+');
  return new RegExp(`^\\s*${escaped}${FIELD_SEPARATOR}(.+)`, 'i');
}

const TITLE_PATTERNS = ['Title', 'Job Title', 'Position', 'Role'].map(label =>
  createFieldPattern(label)
);

const COMPANY_PATTERNS = ['Company', 'Employer'].map(label => createFieldPattern(label));

const LOCATION_WHITESPACE_BLOCK_LIST = [
  'about',
  'background',
  'benefits',
  'culture',
  'description',
  'details',
  'focus',
  'goal',
  'goals',
  'information',
  'intro',
  'introduction',
  'mission',
  'objective',
  'objectives',
  'opportunities',
  'opportunity',
  'overview',
  'perks',
  'preference',
  'preferences',
  'profile',
  'responsibilities',
  'requirements',
  'summary',
  'team',
  'teams',
  'type',
  'types'
];

function createLocationPatterns(label) {
  const escaped = escapeForRegex(label).replace(/\s+/g, '\\s+');
  const basePattern = new RegExp(`^\\s*${escaped}${FIELD_SEPARATOR}(.+)`, 'i');
  const blockPattern = LOCATION_WHITESPACE_BLOCK_LIST.map(prefix => escapeForRegex(prefix)).join(
    '|'
  );
  const lookahead = blockPattern ? `(?!(?:${blockPattern})\\b)` : '';
  const whitespacePattern = new RegExp(`^\\s*${escaped}\\s+${lookahead}(.+)`, 'i');
  return [basePattern, whitespacePattern];
}

const LOCATION_PATTERNS = ['Location'].flatMap(label => createLocationPatterns(label));

const SECTION_HEADING_PREFIXES = [
  'about',
  'background',
  'benefits',
  'culture',
  'description',
  'details',
  'focus',
  'goal',
  'goals',
  'information',
  'intro',
  'introduction',
  'mission',
  'objective',
  'objectives',
  'opportunities',
  'opportunity',
  'overview',
  'perks',
  'preference',
  'preferences',
  'profile',
  'responsibilities',
  'requirements',
  'summary',
  'team',
  'teams',
  'type',
  'types'
];

const LOCATION_VALUE_KEYWORDS = [
  /remote/i,
  /hybrid/i,
  /on[-\s]?site/i,
  /anywhere/i,
  /worldwide/i,
  /global/i,
  /relocation/i,
  /within\b/i
];

function isLikelyLocationValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (/[,:/()]/.test(trimmed)) return true;
  if (/\d/.test(trimmed)) return true;
  if (LOCATION_VALUE_KEYWORDS.some(pattern => pattern.test(trimmed))) return true;
  if (/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(trimmed)) return true;
  if (/\b[A-Z]{2}\b/.test(trimmed)) return true;

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    const normalized = parts[0].toLowerCase();
    if (!SECTION_HEADING_PREFIXES.includes(normalized) && /^[A-Za-z]+$/.test(parts[0])) {
      return true;
    }
  }

  return false;
}

function isLikelySectionHeading(value) {
  const normalized = value.trim().toLowerCase();
  return SECTION_HEADING_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

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

function hasFieldSeparator(line) {
  for (let i = 0; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (code === 58 || code === 45 || code === 8211 || code === 8212) return true;
  }
  return false;
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

function runFieldPatterns(line, patterns) {
  for (let i = 0; i < patterns.length; i += 1) {
    const pattern = patterns[i];
    const match = pattern.exec(line);
    if (match) {
      if (pattern.lastIndex !== 0) pattern.lastIndex = 0;
      return match[1].trim();
    }
  }
  return '';
}

function findFieldValues(lines) {
  let title = '';
  let company = '';
  let location = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hasSeparator = hasFieldSeparator(line);

    if (hasSeparator) {
      if (!title) title = runFieldPatterns(line, TITLE_PATTERNS);
      if (!company) company = runFieldPatterns(line, COMPANY_PATTERNS);
    }

    if (!location) {
      const value = runFieldPatterns(line, LOCATION_PATTERNS);
      if (
        value &&
        (hasSeparator ||
          (!isLikelySectionHeading(value) && isLikelyLocationValue(value)))
      ) {
        location = value;
      }
    }

    if (title && company && location) break;
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
