let cachedResume = '';
let cachedTokens = new Set();

// Tokenize text into a Set of lowercase alphanumeric tokens using a manual scanner
// to avoid regex allocations.
function tokenize(text) {
  const tokens = new Set();
  const str = (text || '').toLowerCase();
  let token = '';
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      token += str[i];
    } else if (token) {
      tokens.add(token);
      token = '';
    }
  }
  if (token) tokens.add(token);
  return tokens;
}

// Cache tokens for the most recent resume to avoid repeated tokenization when the same resume
// is scored against multiple job postings.
function resumeTokens(text) {
  if (text === cachedResume) return cachedTokens;
  cachedTokens = tokenize(text);
  cachedResume = text;
  return cachedTokens;
}

// Check if a line overlaps with tokens in the resume set, using the same manual scanner logic.
function hasOverlap(line, resumeSet) {
  const str = (line || '').toLowerCase();
  let token = '';
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      token += str[i];
    } else if (token) {
      if (resumeSet.has(token)) return true;
      token = '';
    }
  }
  return token ? resumeSet.has(token) : false;
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

  const resumeSet = resumeTokens(resumeText);
  const matched = [];
  const missing = [];

  for (const bullet of bullets) {
    (hasOverlap(bullet, resumeSet) ? matched : missing).push(bullet);
  }

  const score = Math.round((matched.length / bullets.length) * 100);
  return { score, matched, missing };
}
