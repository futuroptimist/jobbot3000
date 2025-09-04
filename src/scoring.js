function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function toSet(tokens) {
  return new Set(tokens);
}

export function computeFitScore(resumeText, requirements) {
  const requirementBullets = Array.isArray(requirements) ? requirements : [];
  if (requirementBullets.length === 0) return { score: 0, matched: [], missing: [] };

  const resumeTokens = toSet(tokenize(resumeText));
  const matchedBullets = [];
  const missingBullets = [];
  for (const bullet of requirementBullets) {
    const tokens = new Set(tokenize(bullet));
    const hasOverlap = Array.from(tokens).some(t => resumeTokens.has(t));
    if (hasOverlap) matchedBullets.push(bullet);
    else missingBullets.push(bullet);
  }
  const score = Math.round((matchedBullets.length / requirementBullets.length) * 100);
  return { score, matched: matchedBullets, missing: missingBullets };
}


