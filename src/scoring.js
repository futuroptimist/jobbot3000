const tokenCache = new Map();
const MAX_CACHE_SIZE = 100;

function tokenize(text) {
  // Cache up to 100 regex tokenizations to limit allocations and memory.
  const key = text || '';
  let tokens = tokenCache.get(key);
  if (tokens) {
    // Refresh to mark as recently used.
    tokenCache.delete(key);
    tokenCache.set(key, tokens);
    return tokens;
  }
  tokens = new Set(key.toLowerCase().match(/[a-z0-9]+/g) || []);
  tokenCache.set(key, tokens);
  if (tokenCache.size > MAX_CACHE_SIZE) {
    const oldestKey = tokenCache.keys().next().value;
    tokenCache.delete(oldestKey);
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
