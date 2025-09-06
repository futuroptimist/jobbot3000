function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function computeFitScore(resumeText, requirements) {
  const requirementBullets = Array.isArray(requirements) ? requirements : [];
  if (requirementBullets.length === 0) return { score: 0, matched: [], missing: [] };

  const resumeTokens = new Set(tokenize(resumeText));
  const matchedBullets = [];
  const missingBullets = [];
  for (const bullet of requirementBullets) {
    const tokens = tokenize(bullet);
    const hasOverlap = tokens.some(t => resumeTokens.has(t));
    if (hasOverlap) matchedBullets.push(bullet);
    else missingBullets.push(bullet);
  }
  const score = Math.round((matchedBullets.length / requirementBullets.length) * 100);
  return { score, matched: matchedBullets, missing: missingBullets };
}


