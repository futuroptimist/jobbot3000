const tokenCache = new Map();

function tokenize(text) {
  // Cache tokens to avoid repeated allocations for the same strings.
  const key = text || '';
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const tokens = new Set(key.toLowerCase().match(/[a-z0-9]+/g) || []);
  tokenCache.set(key, tokens);
  if (tokenCache.size > 100) tokenCache.clear();
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
