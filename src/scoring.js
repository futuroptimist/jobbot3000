function tokenize(text) {
  // Match alphanumeric sequences directly to avoid split/filter overhead
  return new Set(((text || '').toLowerCase().match(/[a-z0-9]+/g)) || []);
}

export function computeFitScore(resumeText, requirements) {
  const bullets = Array.isArray(requirements) ? requirements : [];
  if (!bullets.length) return { score: 0, matched: [], missing: [] };

  const resumeTokens = tokenize(resumeText);
  const matched = [];
  const missing = [];

  for (const bullet of bullets) {
    const tokens = tokenize(bullet);
    const hasOverlap = [...tokens].some(t => resumeTokens.has(t));
    (hasOverlap ? matched : missing).push(bullet);
  }

  const score = Math.round((matched.length / bullets.length) * 100);
  return { score, matched, missing };
}
