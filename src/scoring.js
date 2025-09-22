const TOKEN_CACHE = new Map();

// Tokenize text into a Set of lowercase alphanumeric tokens using a manual scanner.
// Non-string inputs are stringified to avoid type errors. Avoids regex to stay consistent
// with the documented implementation and to keep performance predictable for very large
// inputs.
function tokenize(text) {
  const key = typeof text === 'string' ? text : String(text || '');
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;

  const tokens = new Set();
  let start = -1;
  let needsLower = false;

  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    const isDigit = code >= 48 && code <= 57;

    if (isLower || isUpper || isDigit) {
      if (start === -1) {
        start = i;
        needsLower = false;
      }
      if (isUpper) needsLower = true;
    } else if (start !== -1) {
      let token = key.slice(start, i);
      if (needsLower) token = token.toLowerCase();
      tokens.add(token);
      start = -1;
      needsLower = false;
    }
  }

  if (start !== -1) {
    let token = key.slice(start);
    if (needsLower) token = token.toLowerCase();
    tokens.add(token);
  }

  // Simple cache eviction to bound memory.
  if (TOKEN_CACHE.size > 1000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

// Cache tokens for the most recent resume to avoid repeated tokenization when the same resume
// is scored against multiple job postings.
let cachedResume = '';
let cachedTokens = new Set();

const SYNONYM_GROUPS = [
  ['aws', 'amazon web services'],
  ['ml', 'machine learning'],
  ['ai', 'artificial intelligence'],
  ['postgres', 'postgresql'],
  ['saas', 'software as a service'],
  ['k8s', 'kubernetes'],
  ['ci cd', 'continuous integration'],
  ['ci cd', 'continuous delivery'],
  ['js', 'javascript'],
  ['ts', 'typescript'],
];

function resumeTokens(text) {
  const normalized = typeof text === 'string' ? text : String(text || '');
  if (normalized === cachedResume) return cachedTokens;
  cachedTokens = tokenize(normalized);
  cachedResume = normalized;
  return cachedTokens;
}

function normalizeForSynonyms(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function containsPhrase(haystack, phrase) {
  if (!haystack || !phrase) return false;
  const paddedHaystack = ` ${haystack} `;
  const paddedPhrase = ` ${phrase} `;
  return paddedHaystack.includes(paddedPhrase);
}

function hasSynonymMatch(normalizedLine, getNormalizedResume) {
  if (!normalizedLine) return false;
  for (const group of SYNONYM_GROUPS) {
    let lineHasGroup = false;
    for (const phrase of group) {
      if (containsPhrase(normalizedLine, phrase)) {
        lineHasGroup = true;
        break;
      }
    }
    if (!lineHasGroup) continue;
    const normalizedResume = getNormalizedResume();
    if (!normalizedResume) continue;
    for (const phrase of group) {
      if (containsPhrase(normalizedResume, phrase)) {
        return true;
      }
    }
  }
  return false;
}

// Check if a line overlaps with tokens in the resume set using a manual scanner.
// This avoids regex and array allocations for each requirement line.
// Skip non-string lines to tolerate malformed requirement entries from external sources.
function hasOverlap(line, resumeSet, getNormalizedResume) {
  if (typeof line !== 'string') return false;
  const text = line.toLowerCase();
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isAlphanumeric =
      (code >= 48 && code <= 57) || // 0-9
      (code >= 97 && code <= 122); // a-z
    if (isAlphanumeric) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (resumeSet.has(text.slice(start, i))) return true;
      start = -1;
    }
  }
  if (start !== -1 && resumeSet.has(text.slice(start))) return true;

  const normalizedLine = normalizeForSynonyms(line);
  if (hasSynonymMatch(normalizedLine, getNormalizedResume)) return true;

  return false;
}

/**
 * Compute how well a resume matches a list of job requirements.
 *
 * @param {any} resumeText Non-string values are stringified.
 * @param {string[] | undefined} requirements Non-string entries are ignored.
 * @returns {{ score: number, matched: string[], missing: string[] }}
 */
export function computeFitScore(resumeText, requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    return { score: 0, matched: [], missing: [] };
  }

  const resumeSet = resumeTokens(resumeText);
  let normalizedResume;
  const getNormalizedResume = () => {
    if (normalizedResume !== undefined) return normalizedResume;
    normalizedResume = normalizeForSynonyms(resumeText);
    return normalizedResume;
  };
  const matched = [];
  const missing = [];
  let total = 0;

  for (const entry of requirements) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    total += 1;
    (hasOverlap(trimmed, resumeSet, getNormalizedResume) ? matched : missing).push(trimmed);
  }

  if (total === 0) return { score: 0, matched: [], missing: [] };

  const score = Math.round((matched.length / total) * 100);
  return { score, matched, missing };
}
