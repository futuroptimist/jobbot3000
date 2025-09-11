const TOKEN_CACHE = new Map();
const ARRAY_TOKEN_CACHE = new Map();
const TOKEN_RE = /[a-z0-9]+/g;

// Tokenize text into a Set of lowercase alphanumeric tokens, with caching to avoid
// repeated regex and Set allocations.
function tokenize(text) {
  const key = text || '';
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;

  // Use regex matching to avoid replace/split allocations and speed up tokenization.
  TOKEN_RE.lastIndex = 0;
  const tokens = new Set(key.toLowerCase().match(TOKEN_RE) || []);

  // Simple cache eviction to bound memory.
  if (TOKEN_CACHE.size > 1000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

// Tokenize into an array for lines where we only need iteration.
function tokenizeArray(text) {
  const key = text || '';
  const cached = ARRAY_TOKEN_CACHE.get(key);
  if (cached) return cached;
  TOKEN_RE.lastIndex = 0;
  const tokens = key.toLowerCase().match(TOKEN_RE) || [];
  if (ARRAY_TOKEN_CACHE.size > 1000) ARRAY_TOKEN_CACHE.clear();
  ARRAY_TOKEN_CACHE.set(key, tokens);
  return tokens;
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

// Check if a line overlaps with tokens in the resume set.
// Inline tokenization avoids Set allocations for each bullet line.
function hasOverlap(line, resumeSet) {
  const tokens = tokenizeArray(line);
  for (let i = 0; i < tokens.length; i++) {
    if (resumeSet.has(tokens[i])) return true;
  }
  return false;
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
