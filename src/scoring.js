const TOKEN_RE = /[a-z0-9]+/g;
const TOKEN_CACHE = new Map();

function tokenizeArray(text) {
  if (TOKEN_CACHE.has(text)) return TOKEN_CACHE.get(text);
  TOKEN_RE.lastIndex = 0;
  const tokens = (text || '').toLowerCase().match(TOKEN_RE) || [];
  if (TOKEN_CACHE.size > 100) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(text, tokens);
  return tokens;
}

export function computeFitScore(resumeText, requirements) {
  const bullets = Array.isArray(requirements) ? requirements : [];
  if (!bullets.length) return { score: 0, matched: [], missing: [] };

  const resumeTokens = new Set(tokenizeArray(resumeText));
  const matched = [];
  const missing = [];

  for (const bullet of bullets) {
    const tokens = tokenizeArray(bullet);
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
