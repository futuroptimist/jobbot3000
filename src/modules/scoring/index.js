import { identifyBlockers } from './blockers.js';
import { addJobTags, discardJob, syncShortlistJob } from './shortlist.js';

const TOKEN_CACHE = new Map();

const BM25_K1 = 1.5;
const BM25_B = 0.75;

const DEFAULT_CALIBRATION = Object.freeze({
  intercept: -1.45,
  coverageWeight: 4.6,
  missingWeight: -1.2,
  blockerWeight: -2.3,
  keywordWeight: 0.85,
  requirementWeight: 0.18,
});

function toFiniteNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCalibrationOptions(input) {
  if (input === false || input == null) {
    return { enabled: false };
  }

  if (input === true) {
    return { enabled: true, weights: { ...DEFAULT_CALIBRATION } };
  }

  if (typeof input !== 'object') {
    return { enabled: false };
  }

  const enabled = input.enabled !== false;
  if (!enabled) {
    return { enabled: false };
  }

  const weights = {
    intercept: toFiniteNumber(input.intercept, DEFAULT_CALIBRATION.intercept),
    coverageWeight: toFiniteNumber(
      input.coverageWeight,
      DEFAULT_CALIBRATION.coverageWeight,
    ),
    missingWeight: toFiniteNumber(input.missingWeight, DEFAULT_CALIBRATION.missingWeight),
    blockerWeight: toFiniteNumber(input.blockerWeight, DEFAULT_CALIBRATION.blockerWeight),
    keywordWeight: toFiniteNumber(input.keywordWeight, DEFAULT_CALIBRATION.keywordWeight),
    requirementWeight: toFiniteNumber(
      input.requirementWeight,
      DEFAULT_CALIBRATION.requirementWeight,
    ),
  };

  return { enabled: true, weights };
}

function logistic(value) {
  if (!Number.isFinite(value)) return 0;
  if (value > 40) return 1;
  if (value < -40) return 0;
  return 1 / (1 + Math.exp(-value));
}

function applyLogisticCalibration(features, weights) {
  const {
    coverageRatio,
    missingRatio,
    blockerCount,
    keywordRatio,
    totalRequirements,
    baselineScore,
  } = features;

  const penaltyBlockers = Math.min(Math.max(blockerCount, 0), 5);
  const normalizedKeywordRatio = Math.max(0, Math.min(1, keywordRatio));
  const normalizedMissing = Math.max(0, Math.min(1, missingRatio));
  const normalizedCoverage = Math.max(0, Math.min(1, coverageRatio));
  const requirementTerm = Math.log1p(Math.max(0, totalRequirements));

  const rawLogit =
    weights.intercept +
    weights.coverageWeight * normalizedCoverage +
    weights.missingWeight * normalizedMissing +
    weights.blockerWeight * penaltyBlockers +
    weights.keywordWeight * normalizedKeywordRatio +
    weights.requirementWeight * requirementTerm;

  const probability = logistic(rawLogit);
  const calibratedScore = Math.round(Math.max(0, Math.min(100, probability * 100)));

  return {
    score: calibratedScore,
    baselineScore,
    applied: true,
    method: 'logistic',
    weights: { ...weights },
    features: {
      coverageRatio: normalizedCoverage,
      missingRatio: normalizedMissing,
      blockerCount: penaltyBlockers,
      keywordRatio: normalizedKeywordRatio,
      totalRequirements: Math.max(0, totalRequirements),
      rawLogit,
    },
  };
}

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
      const end = i;
      const segment = key.slice(start, end);
      tokens.add(needsLower ? segment.toLowerCase() : segment);
      start = -1;
      needsLower = false;
    }
  }

  if (start !== -1) {
    const segment = key.slice(start);
    tokens.add(needsLower ? segment.toLowerCase() : segment);
  }

  // Simple cache eviction to bound memory.
  if (TOKEN_CACHE.size > 1000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

function tokenizeWithCounts(value) {
  const key = typeof value === 'string' ? value : String(value || '');
  const counts = new Map();
  let length = 0;
  let start = -1;
  let needsLower = false;

  for (let i = 0; i < key.length; i += 1) {
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
      const segment = key.slice(start, i);
      const token = needsLower ? segment.toLowerCase() : segment;
      length += 1;
      counts.set(token, (counts.get(token) || 0) + 1);
      start = -1;
      needsLower = false;
    }
  }

  if (start !== -1) {
    const segment = key.slice(start);
    const token = needsLower ? segment.toLowerCase() : segment;
    length += 1;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return { counts, length };
}

// Cache tokens for the most recent resume to avoid repeated tokenization when the same resume
// is scored against multiple job postings.
let cachedResume = '';
let cachedTokens = new Set();
let cachedNormalizedResumeInput = '';
let cachedNormalizedResumeOutput = '';
let cachedResumeCountsInput = '';
let cachedResumeCountsOutput = new Map();

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
const REQUIREMENT_TOKEN_CACHE = new Map();

function resumeTokens(text) {
  const normalized = typeof text === 'string' ? text : String(text || '');
  if (normalized === cachedResume) return cachedTokens;
  cachedTokens = tokenize(normalized);
  cachedResume = normalized;
  return cachedTokens;
}

function resumeTokenCounts(text) {
  const normalized = typeof text === 'string' ? text : String(text || '');
  if (normalized === cachedResumeCountsInput) return cachedResumeCountsOutput;
  const { counts } = tokenizeWithCounts(normalized);
  cachedResumeCountsInput = normalized;
  cachedResumeCountsOutput = counts;
  return counts;
}

function normalizedResumeText(text) {
  const normalized = typeof text === 'string' ? text : String(text || '');
  if (normalized === cachedNormalizedResumeInput) return cachedNormalizedResumeOutput;
  const result = normalizeForSynonyms(normalized);
  cachedNormalizedResumeInput = normalized;
  cachedNormalizedResumeOutput = result;
  return result;
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

function getRequirementTokenStats(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { counts: new Map(), length: 0, tokens: [] };
  }

  const cached = REQUIREMENT_TOKEN_CACHE.get(text);
  if (cached) return cached;

  const { counts, length } = tokenizeWithCounts(text);
  const tokens = Array.from(counts.keys());
  const result = { counts, length, tokens };
  if (REQUIREMENT_TOKEN_CACHE.size > 4096) REQUIREMENT_TOKEN_CACHE.clear();
  REQUIREMENT_TOKEN_CACHE.set(text, result);
  return result;
}

function computeBm25FromProcessed(processed, resumeSet) {
  if (!processed || processed.length === 0) {
    return {
      total: 0,
      perRequirement: [],
      parameters: { k1: BM25_K1, b: BM25_B },
    };
  }

  let totalDocLength = 0;
  const docFreq = new Map();

  for (const item of processed) {
    const tokens = item.tokens;
    totalDocLength += item.length;
    const seen = new Set();
    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const avgDocLength = totalDocLength > 0 ? totalDocLength / processed.length : 0;
  const normalizedAvgLength = avgDocLength > 0 ? avgDocLength : 1;

  let totalScore = 0;
  const perRequirement = [];

  for (const item of processed) {
    let rawScore = 0;
    if (item.length > 0) {
      for (const token of item.tokens) {
        if (!resumeSet.has(token)) continue;
        const df = docFreq.get(token) || 0;
        const idf = Math.log(1 + (processed.length - df + 0.5) / (df + 0.5));
        const tf = item.counts.get(token) || 0;
        if (tf === 0) continue;
        const denominator =
          tf + BM25_K1 * (1 - BM25_B + (BM25_B * item.length) / normalizedAvgLength);
        if (denominator === 0) continue;
        rawScore += idf * ((tf * (BM25_K1 + 1)) / denominator);
      }
    }
    const normalizedScore = Number(rawScore.toFixed(6));
    perRequirement.push({ requirement: item.text, score: normalizedScore });
    totalScore += rawScore;
  }

  return {
    total: Number(totalScore.toFixed(6)),
    perRequirement,
    parameters: { k1: BM25_K1, b: BM25_B },
  };
}

function computeCosineFromProcessed(processed, resumeCounts) {
  const requirementCounts = new Map();
  for (const item of processed || []) {
    for (const [token, count] of item.counts) {
      requirementCounts.set(token, (requirementCounts.get(token) || 0) + count);
    }
  }

  let dotProduct = 0;
  for (const [token, resumeCount] of resumeCounts) {
    const requirementCount = requirementCounts.get(token);
    if (requirementCount) {
      dotProduct += resumeCount * requirementCount;
    }
  }

  let resumeMagnitude = 0;
  for (const count of resumeCounts.values()) {
    resumeMagnitude += count * count;
  }
  resumeMagnitude = Math.sqrt(resumeMagnitude);

  let requirementMagnitude = 0;
  for (const count of requirementCounts.values()) {
    requirementMagnitude += count * count;
  }
  requirementMagnitude = Math.sqrt(requirementMagnitude);

  let similarity = 0;
  if (resumeMagnitude > 0 && requirementMagnitude > 0) {
    similarity = dotProduct / (resumeMagnitude * requirementMagnitude);
  }

  return {
    similarity: Number(similarity.toFixed(6)),
    resumeMagnitude: Number(resumeMagnitude.toFixed(6)),
    requirementMagnitude: Number(requirementMagnitude.toFixed(6)),
  };
}

function buildScoreBreakdown(resumeText, normalizedRequirements, resumeSet) {
  const processed = (normalizedRequirements || []).map(text => {
    const stats = getRequirementTokenStats(text);
    return { text, counts: stats.counts, length: stats.length, tokens: stats.tokens };
  });

  const bm25 = computeBm25FromProcessed(processed, resumeSet);
  const resumeCounts = resumeTokenCounts(resumeText);
  const cosine = computeCosineFromProcessed(processed, resumeCounts);

  return { bm25, cosine };
}

/**
 * Compute how well a resume matches a list of job requirements.
 *
 * @param {any} resumeText Non-string values are stringified.
 * @param {string[] | undefined} requirements Non-string entries are ignored.
 * @param {{ calibration?: boolean | {
 *   enabled?: boolean,
 *   intercept?: number,
 *   coverageWeight?: number,
 *   missingWeight?: number,
 *   blockerWeight?: number,
 *   keywordWeight?: number,
 *   requirementWeight?: number,
 * } }} [options]
 * @returns {{
 *   score: number,
 *   matched: string[],
 *   missing: string[],
 *   must_haves_missed: string[],
 *   keyword_overlap: string[],
 *   evidence: Array<{ text: string, source: string }>,
 *   calibration?: {
 *     score: number,
 *     baselineScore: number,
 *     applied: true,
 *     method: 'logistic',
 *     weights: {
 *       intercept: number,
 *       coverageWeight: number,
 *       missingWeight: number,
 *       blockerWeight: number,
 *       keywordWeight: number,
 *       requirementWeight: number,
 *     },
 *     features: {
 *       coverageRatio: number,
 *       missingRatio: number,
 *       blockerCount: number,
 *       keywordRatio: number,
 *       totalRequirements: number,
 *       rawLogit: number,
 *     },
 *   },
 * }}
 */
export function computeFitScore(resumeText, requirements, options = {}) {
  const resumeSet = resumeTokens(resumeText);
  let normalizedResume;
  const getNormalizedResume = () => {
    if (normalizedResume !== undefined) return normalizedResume;
    normalizedResume = normalizedResumeText(resumeText);
    return normalizedResume;
  };
  const matched = [];
  const missing = [];
  const evidence = [];
  const normalizedRequirements = [];
  let scoreBreakdownCache;
  const getScoreBreakdown = () => {
    if (scoreBreakdownCache === undefined) {
      scoreBreakdownCache = buildScoreBreakdown(resumeText, normalizedRequirements, resumeSet);
    }
    return scoreBreakdownCache;
  };

  if (!Array.isArray(requirements) || requirements.length === 0) {
    return {
      score: 0,
      matched: [],
      missing: [],
      must_haves_missed: [],
      keyword_overlap: [],
      evidence: [],
      get scoreBreakdown() {
        return getScoreBreakdown();
      },
    };
  }

  let total = 0;

  for (const entry of requirements) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    total += 1;
    normalizedRequirements.push(trimmed);
    if (hasOverlap(trimmed, resumeSet, getNormalizedResume)) {
      matched.push(trimmed);
      evidence.push({ text: trimmed, source: 'requirements' });
    } else {
      missing.push(trimmed);
    }
  }

  if (total === 0) {
    return {
      score: 0,
      matched: [],
      missing: [],
      must_haves_missed: [],
      keyword_overlap: [],
      evidence: [],
      get scoreBreakdown() {
        return getScoreBreakdown();
      },
    };
  }

  const coverageRatio = matched.length / total;
  const baselineScore = Math.round(coverageRatio * 100);
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

  const calibration = normalizeCalibrationOptions(options.calibration);
  let finalScore = baselineScore;
  let calibrationDetails;

  if (calibration.enabled) {
    calibrationDetails = applyLogisticCalibration(
      {
        coverageRatio,
        missingRatio: missing.length / total,
        blockerCount: mustHavesMissed.length,
        keywordRatio: keywordOverlapArray.length / KEYWORD_OVERLAP_TOTAL_LIMIT,
        totalRequirements: total,
        baselineScore,
      },
      calibration.weights,
    );
    finalScore = calibrationDetails.score;
  }

  const result = {
    score: finalScore,
    matched,
    missing,
    must_haves_missed: mustHavesMissed,
    keyword_overlap: keywordOverlapArray,
    evidence,
    get scoreBreakdown() {
      return getScoreBreakdown();
    },
  };

  if (calibrationDetails) {
    result.calibration = calibrationDetails;
  }

  return result;
}

export function __resetScoringCachesForTest() {
  TOKEN_CACHE.clear();
  cachedResume = '';
  cachedTokens = new Set();
  KEYWORD_OVERLAP_CACHE.clear();
  cachedNormalizedResumeInput = '';
  cachedNormalizedResumeOutput = '';
  cachedResumeCountsInput = '';
  cachedResumeCountsOutput = new Map();
  REQUIREMENT_TOKEN_CACHE.clear();
}

export function registerScoringModule({ bus } = {}) {
  if (!bus || typeof bus.registerHandler !== 'function') {
    throw new Error('registerScoringModule requires a module event bus');
  }

  const disposers = [
    bus.registerHandler('scoring:compute-fit-score', async payload => {
      const { resumeText, requirements } = payload || {};
      return computeFitScore(resumeText, requirements);
    }),
    bus.registerHandler('scoring:identify-blockers', async payload => {
      const requirements = payload?.requirements ?? [];
      return identifyBlockers(requirements);
    }),
    bus.registerHandler('scoring:shortlist:sync', async payload => {
      const { jobId, metadata } = payload || {};
      return syncShortlistJob(jobId, metadata);
    }),
    bus.registerHandler('scoring:shortlist:discard', async payload => {
      const { jobId, reason, options } = payload || {};
      return discardJob(jobId, reason, options);
    }),
    bus.registerHandler('scoring:shortlist:tag', async payload => {
      const { jobId, tags } = payload || {};
      return addJobTags(jobId, tags);
    }),
  ];

  return () => disposers.splice(0).forEach(dispose => dispose?.());
}
