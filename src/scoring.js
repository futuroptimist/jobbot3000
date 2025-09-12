const TOKEN_CACHE = new Map();
const WORD_RE = /[a-z0-9]+/g;

// Tokenize text into a Set of lowercase alphanumeric tokens, with caching to avoid
// repeated regex and Set allocations.
function tokenize(text) {
  const key = text || '';
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;

  // Use regex matching to avoid replace/split allocations and speed up tokenization.
  WORD_RE.lastIndex = 0;
  const tokens = new Set(key.toLowerCase().match(WORD_RE) || []);

  // Simple cache eviction to bound memory.
  if (TOKEN_CACHE.size > 1000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

// Iterate tokens in a line and check for overlap with resume tokens without allocating arrays.
// Using a streaming regex avoids per-line array creation, improving performance for large,
// unique requirement lists.
// Skip non-string lines to tolerate malformed requirement entries from external sources.
function hasOverlap(line, resumeSet) {
  if (typeof line !== 'string') return false;
  WORD_RE.lastIndex = 0;
  const lower = line.toLowerCase();
  let match;
  while ((match = WORD_RE.exec(lower))) {
    if (resumeSet.has(match[0])) return true;
  }
  return false;
}

// Cache tokens for the most recent resume to avoid repeated tokenization when the same resume
// is scored against multiple job postings.
let cachedResume = '';
let cachedTokens = new Set();

function resumeTokens(text) {
  if (text === cachedResume) return cachedTokens;
  cachedTokens = tokenize(text);
  cachedResume = text;
  return cachedTokens;
}

export function computeFitScore(resumeText, requirements) {
  const bullets = Array.isArray(requirements) ? requirements : [];
  if (!bullets.length) return { score: 0, matched: [], missing: [] };

  const resumeSet = resumeTokens(resumeText);
  const matched = [];
  const missing = [];

  for (const bullet of bullets) {
    (hasOverlap(bullet, resumeSet) ? matched : missing).push(bullet);
  }

  const score = Math.round((matched.length / bullets.length) * 100);
  return { score, matched, missing };
}
