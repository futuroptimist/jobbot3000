const tokenCache = new Map();
const TOKEN_CACHE_LIMIT = 100;

function tokenize(text) {
  // Use regex matching and cache results with a small LRU to balance speed and memory usage.
  const key = text || '';
  let tokens = tokenCache.get(key);
  if (!tokens) {
    tokens = new Set(key.toLowerCase().match(/[a-z0-9]+/g) || []);
    tokenCache.set(key, tokens);
    if (tokenCache.size > TOKEN_CACHE_LIMIT) {
      const oldestKey = tokenCache.keys().next().value;
      tokenCache.delete(oldestKey);
    }
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
