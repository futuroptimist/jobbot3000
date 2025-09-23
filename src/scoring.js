import { identifyBlockers } from './blockers.js';

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
  let lowerKey;

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
      const end = i;
      if (needsLower) {
        if (!lowerKey) lowerKey = key.toLowerCase();
        tokens.add(lowerKey.slice(start, end));
      } else {
        tokens.add(key.slice(start, end));
      }
      start = -1;
      needsLower = false;
    }
  }

  if (start !== -1) {
    if (needsLower) {
      if (!lowerKey) lowerKey = key.toLowerCase();
      tokens.add(lowerKey.slice(start));
    } else {
      tokens.add(key.slice(start));
    }
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

const KEYWORD_OVERLAP_REQUIREMENT_LIMIT = 6;
const KEYWORD_OVERLAP_TOTAL_LIMIT = 12;
const KEYWORD_OVERLAP_TOKEN_THRESHOLD = 5000;
// Cache keyword overlap collections for repeated resume-to-job comparisons; bounded to 32 entries.
const KEYWORD_OVERLAP_CACHE = new Map();

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

function findSynonymMatches(normalizedLine, getNormalizedResume) {
  if (!normalizedLine) return [];
  const matches = [];
  let normalizedResume;
  for (const group of SYNONYM_GROUPS) {
    let jobPhrase;
    for (const phrase of group) {
      if (containsPhrase(normalizedLine, phrase)) {
        jobPhrase = phrase;
        break;
      }
    }
    if (!jobPhrase) continue;
    if (normalizedResume === undefined) normalizedResume = getNormalizedResume();
    if (!normalizedResume) continue;
    for (const phrase of group) {
      if (containsPhrase(normalizedResume, phrase)) {
        matches.push(jobPhrase);
        break;
      }
    }
  }
  return matches;
}

function hasSynonymMatch(normalizedLine, getNormalizedResume) {
  return findSynonymMatches(normalizedLine, getNormalizedResume).length > 0;
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

function collectKeywordOverlap(line, resumeSet, getNormalizedResume) {
  if (typeof line !== 'string') return [];
  const text = line.toLowerCase();
  const overlaps = new Set();
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isAlphanumeric =
      (code >= 48 && code <= 57) ||
      (code >= 97 && code <= 122);
    if (isAlphanumeric) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      const token = text.slice(start, i);
      if (token.length > 1 && resumeSet.has(token)) overlaps.add(token);
      start = -1;
    }
  }
  if (start !== -1) {
    const token = text.slice(start);
    if (token.length > 1 && resumeSet.has(token)) overlaps.add(token);
  }

  const synonymMatches = findSynonymMatches(normalizeForSynonyms(line), getNormalizedResume);
  if (synonymMatches.length > 0) {
    const lexicalTokensToRemove = new Set();
    for (const phrase of synonymMatches) {
      overlaps.add(phrase);
      for (const part of phrase.split(' ')) {
        if (part.length > 1 && part !== phrase) lexicalTokensToRemove.add(part);
      }
    }
    for (const token of lexicalTokensToRemove) overlaps.delete(token);
  }

  return Array.from(overlaps);
}

/**
 * Compute how well a resume matches a list of job requirements.
 *
 * @param {any} resumeText Non-string values are stringified.
 * @param {string[] | undefined} requirements Non-string entries are ignored.
 * @returns {{
 *   score: number,
 *   matched: string[],
 *   missing: string[],
 *   must_haves_missed: string[],
 *   keyword_overlap: string[],
 * }}
 */
export function computeFitScore(resumeText, requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    return { score: 0, matched: [], missing: [], must_haves_missed: [], keyword_overlap: [] };
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

  if (total === 0)
    return { score: 0, matched: [], missing: [], must_haves_missed: [], keyword_overlap: [] };

  const score = Math.round((matched.length / total) * 100);
  const mustHavesMissed = identifyBlockers(missing);
  const allowKeywordOverlap = resumeSet.size <= KEYWORD_OVERLAP_TOKEN_THRESHOLD;
  const requirementsForOverlap = allowKeywordOverlap
    ? matched.slice(0, KEYWORD_OVERLAP_REQUIREMENT_LIMIT)
    : [];
  let keywordOverlapArray = [];
  if (allowKeywordOverlap && requirementsForOverlap.length > 0) {
    const normalizedResumeForCache = getNormalizedResume();
    const cacheKey = `${normalizedResumeForCache}|||${requirementsForOverlap.join('||')}`;
    const cached = KEYWORD_OVERLAP_CACHE.get(cacheKey);
    if (cached) {
      keywordOverlapArray = cached;
    } else {
      const keywordOverlap = new Set();
      for (let i = 0; i < requirementsForOverlap.length; i++) {
        if (keywordOverlap.size >= KEYWORD_OVERLAP_TOTAL_LIMIT) break;
        const overlaps = collectKeywordOverlap(
          requirementsForOverlap[i],
          resumeSet,
          getNormalizedResume,
        );
        for (const token of overlaps) {
          keywordOverlap.add(token);
          if (keywordOverlap.size >= KEYWORD_OVERLAP_TOTAL_LIMIT) break;
        }
      }
      keywordOverlapArray = Array.from(keywordOverlap);
      if (KEYWORD_OVERLAP_CACHE.size > 32) KEYWORD_OVERLAP_CACHE.clear();
      KEYWORD_OVERLAP_CACHE.set(cacheKey, keywordOverlapArray);
    }
  }

  return {
    score,
    matched,
    missing,
    must_haves_missed: mustHavesMissed,
    keyword_overlap: keywordOverlapArray,
  };
}

export function __resetScoringCachesForTest() {
  TOKEN_CACHE.clear();
  cachedResume = '';
  cachedTokens = new Set();
  KEYWORD_OVERLAP_CACHE.clear();
}
