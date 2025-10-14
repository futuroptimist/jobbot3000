const BLOCKER_PATTERNS = [
  /\bmust\b/i,
  /\brequir(?:e|es|ed|ement)s?\b/i,
  /\bmandatory\b/i,
  /\bclearance\b/i,
  /\bvisa\b/i,
  /\bsponsorship\b/i,
  /\bcertif(?:ied|ication)s?\b/i,
  /\blicen[cs]e\b/i,
  /\bauthorization\b/i,
  /\bcitizen(?:ship)?\b/i,
  /\bwork permit\b/i,
  /\bonsite\b/i,
  /\bon-site\b/i,
  /\bin[-\s]?office\b/i,
  /\bhybrid\b/i,
  /\brelocat(?:e|ion)\b/i,
  /\bcommute\b/i,
  /\btravel\b/i,
  /\bsalary\b/i,
  /\bcompensation\b/i,
  /\bpay range\b/i,
  /\bbase (?:salary|pay)\b/i,
  /\btotal compensation\b/i,
  /\b(?:\d+\+?\s*(?:years?|yrs?)\s+of\s+experience)\b/i,
  /\b(?:entry|mid|senior|staff|principal|lead)(?: |-)?level\b/i,
  /\bleadership\b/i,
];

export function identifyBlockers(requirements) {
  if (!Array.isArray(requirements)) return [];
  const blockers = [];
  for (const requirement of requirements) {
    if (typeof requirement !== 'string') continue;
    const trimmed = requirement.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (BLOCKER_PATTERNS.some(pattern => pattern.test(normalized))) {
      blockers.push(trimmed);
    }
  }
  return blockers;
}

export { BLOCKER_PATTERNS };
