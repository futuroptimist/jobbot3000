const tokenCache = new Map();

function tokenize(text) {
  // Use regex matching to avoid replace/split allocations and speed up tokenization.
  return new Set((text || '').toLowerCase().match(/[a-z0-9]+/g) || []);
}

function tokenizeCached(text) {
  if (tokenCache.has(text)) return tokenCache.get(text);
  const tokens = tokenize(text);
  tokenCache.set(text, tokens);
  return tokens;
}

export function computeFitScore(resumeText, requirements) {
  const bullets = Array.isArray(requirements) ? requirements : [];
  if (!bullets.length) return { score: 0, matched: [], missing: [] };

  const resumeTokens = tokenizeCached(resumeText);
  const matched = [];
  const missing = [];

  for (const bullet of bullets) {
    const tokens = tokenizeCached(bullet);
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
