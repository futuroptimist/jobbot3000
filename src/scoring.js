const TOKEN_CACHE = new Map();

// Tokenize text into a Set of lowercase alphanumeric tokens using a manual scanner.
// Non-string inputs are stringified to avoid type errors. Avoids regex to stay consistent
// with the documented implementation and to keep performance predictable for very large
// inputs.
function tokenize(text) {
  const key = typeof text === 'string' ? text : String(text || '');
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;

  const tokens = new Set();
  let start = -1;
  let needsLower = false;

  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    const isDigit = code >= 48 && code <= 57;

    if (isLower || isUpper || isDigit) {
      if (start === -1) {
        start = i;
        needsLower = false;
      }
      if (isUpper) needsLower = true;
    } else if (start !== -1) {
      let token = key.slice(start, i);
      if (needsLower) token = token.toLowerCase();
      tokens.add(token);
      start = -1;
      needsLower = false;
    }
  }

  if (start !== -1) {
    let token = key.slice(start);
    if (needsLower) token = token.toLowerCase();
    tokens.add(token);
  }

  // Simple cache eviction to bound memory.
  if (TOKEN_CACHE.size > 1000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

// Cache tokens for the most recent resume to avoid repeated tokenization when the same resume
// is scored against multiple job postings.
let cachedResume = '';
let cachedTokens = new Set();

function resumeTokens(text) {
  const normalized = typeof text === 'string' ? text : String(text || '');
  if (normalized === cachedResume) return cachedTokens;
  cachedTokens = tokenize(normalized);
  cachedResume = normalized;
  return cachedTokens;
}

// Check if a line overlaps with tokens in the resume set using a manual scanner.
// This avoids regex and array allocations for each requirement line.
// Skip non-string lines to tolerate malformed requirement entries from external sources.
function hasOverlap(line, resumeSet) {
  if (typeof line !== 'string') return false;
  const text = line.toLowerCase();
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isAlphanumeric =
      (code >= 48 && code <= 57) || // 0-9
      (code >= 97 && code <= 122);  // a-z
    if (isAlphanumeric) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (resumeSet.has(text.slice(start, i))) return true;
      start = -1;
    }
  }
  return start !== -1 && resumeSet.has(text.slice(start));
}

/**
 * Compute how well a resume matches a list of job requirements.
 *
 * @param {any} resumeText Non-string values are stringified.
 * @param {string[] | undefined} requirements Non-string entries are ignored.
 * @returns {{ score: number, matched: string[], missing: string[] }}
 */
export function computeFitScore(resumeText, requirements) {
  const bullets = Array.isArray(requirements)
    ? requirements.filter(r => typeof r === 'string' && r.trim())
    : [];
  if (!bullets.length) return { score: 0, matched: [], missing: [] };

  const resumeSet = resumeTokens(resumeText);
  const matched = [];
  const missing = [];

  for (const bullet of bullets) {
    (hasOverlap(bullet, resumeSet) ? matched : missing).push(bullet);
  }

  const score = Math.round((matched.length / bullets.length) * 100);
  return { score, matched, missing };
}
