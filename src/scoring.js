const TOKEN_CACHE = new Map();

// Tokenize text into a Set of lowercase alphanumeric tokens, with caching to avoid
// repeated regex and Set allocations.
function tokenize(text) {
  const key = text || '';
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;

  // Use regex matching to avoid replace/split allocations and speed up tokenization.
  const tokens = new Set(key.toLowerCase().match(/[a-z0-9]+/g) || []);

  // Simple cache eviction to bound memory.
  if (TOKEN_CACHE.size > 1000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
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
function hasOverlap(line, resumeSet) {
  const tokens = tokenize(line);
  for (const token of tokens) {
    if (resumeSet.has(token)) return true;
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
