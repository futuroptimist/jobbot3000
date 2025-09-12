const TOKEN_CACHE = new Map();

/**
 * Tokenize `text` into a Set of lowercase alphanumeric tokens using a manual scanner.
 * Avoids regex and intermediate arrays. Results are cached per input string and the cache
 * is cleared when it grows beyond 1000 entries to bound memory.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  const key = text || '';
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;

  const tokens = new Set();
  let token = '';
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      // 0-9
      token += key[i];
    } else {
      const lower = code | 32; // A-Z -> a-z; other chars unaffected
      if (lower >= 97 && lower <= 122) {
        token += String.fromCharCode(lower);
      } else if (token) {
        tokens.add(token);
        token = '';
      }
    }
  }
  if (token) tokens.add(token);

  if (TOKEN_CACHE.size > 1000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

// Cache tokens for the most recent resume to avoid repeated tokenization when the same resume
// is scored against multiple job postings.
let cachedResume = '';
let cachedTokens = new Set();

function resumeTokens(text) {
  if (text === cachedResume) return cachedTokens;
  cachedTokens = tokenize(text);
  cachedResume = text;
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
    const isAlnum =
      (code >= 48 && code <= 57) || // 0-9
      (code >= 97 && code <= 122);  // a-z
    if (isAlnum) {
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
 * @param {string} resumeText
 * @param {string[] | undefined} requirements
 * @returns {{ score: number, matched: string[], missing: string[] }}
 */
export function computeFitScore(resumeText, requirements) {
  const bullets = Array.isArray(requirements) ? requirements : [];
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
