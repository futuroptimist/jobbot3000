const tokenCache = new Map();
const MAX_CACHE_ENTRIES = 200;

function tokenize(text) {
  // Cache tokenization results with a simple LRU to avoid repeated allocations.
  const key = text || '';
  let tokens = tokenCache.get(key);
  if (tokens) return tokens;
  tokens = new Set(key.toLowerCase().match(/[a-z0-9]+/g) || []);
  tokenCache.set(key, tokens);
  if (tokenCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = tokenCache.keys().next().value;
    tokenCache.delete(firstKey);
  }
  return tokens;
}

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
