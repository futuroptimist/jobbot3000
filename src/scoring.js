const TOKEN_CACHE_MAX = 100;
const tokenCache = new Map();

function tokenize(text) {
  // Cache regex tokenization to avoid repeated allocations on identical inputs.
  const key = (text || '').toLowerCase();
  let tokens = tokenCache.get(key);
  if (tokens) {
    // Refresh entry for simple LRU behaviour.
    tokenCache.delete(key);
    tokenCache.set(key, tokens);
    return tokens;
  }
  tokens = new Set(key.match(/[a-z0-9]+/g) || []);
  tokenCache.set(key, tokens);
  if (tokenCache.size > TOKEN_CACHE_MAX) {
    // Remove oldest cached entry to bound memory usage.
    const oldestKey = tokenCache.keys().next().value;
    tokenCache.delete(oldestKey);
  }
  return tokens;
}

export const __clearTokenCache = () => tokenCache.clear();
export const __getTokenCacheSize = () => tokenCache.size;
export const __TOKEN_CACHE_MAX = TOKEN_CACHE_MAX;

export function computeFitScore(resumeText, requirements) {
  const bullets = Array.isArray(requirements) ? requirements : [];
  if (!bullets.length) return { score: 0, matched: [], missing: [] };

  const resumeTokens = tokenize(resumeText);
  const matched = [];
  const missing = [];

  for (const bullet of bullets) {
    const tokens = tokenize(bullet);
    let hasOverlap = false;
    for (const t of tokens) {
      if (resumeTokens.has(t)) {
        hasOverlap = true;
        break;
      }
    }
    (hasOverlap ? matched : missing).push(bullet);
  }

  const score = Math.round((matched.length / bullets.length) * 100);
  return { score, matched, missing };
}
