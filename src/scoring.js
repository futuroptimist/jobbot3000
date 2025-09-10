const TOKEN_CACHE = new Map();

function tokenize(text) {
  // Cache tokenization to avoid repeated regex and Set allocations.
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
