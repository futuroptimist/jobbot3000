/**
 * Return the first N sentences from the given text.
 * If `count` is zero or negative, returns an empty string.
 * Sentences end with '.', '!', '?', or '…', including consecutive punctuation (e.g. `?!`),
 * optionally followed by closing quotes or parentheses.
 * Falls back to returning the trimmed input when no such punctuation exists.
 * If fewer complete sentences than requested exist, any remaining text is appended
 * so no content is lost. Parenthetical abbreviations like `(M.Sc.)` remain attached
 * to their surrounding sentence. Avoids splitting on decimal numbers or domain-like tokens.
 * Returns an empty string when `count` is 0 or less.
 *
 * @param {string} text
 * @param {number} count Number of sentences to return; values <= 0 yield ''.
 * @returns {string}
 */
// Fast ASCII whitespace lookup table for summarize(). Matches JS /\s/ for ASCII range.
const ASCII_WHITESPACE = new Uint8Array(33);
ASCII_WHITESPACE[9] = 1; // \t
ASCII_WHITESPACE[10] = 1; // \n
ASCII_WHITESPACE[11] = 1; // \v
ASCII_WHITESPACE[12] = 1; // \f
ASCII_WHITESPACE[13] = 1; // \r
ASCII_WHITESPACE[32] = 1; // space

function isSpaceCode(code) {
  if (!Number.isFinite(code)) return false;
  if (code <= 32) return ASCII_WHITESPACE[code] === 1;
  if (code >= 0x2000 && code <= 0x200a) return true;
  switch (code) {
    case 0x00a0:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
    case 0xfeff:
      return true;
    default:
      return false;
  }
}
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;
const OPEN_PARENS = 40;
const OPEN_BRACKET = 91;
const OPEN_BRACE = 123;
const CLOSE_PARENS = 41;
const CLOSE_BRACKET = 93;
const CLOSE_BRACE = 125;
const DOT = 46;
const HYPHEN = 45;
const EXCLAMATION = 33;
const QUESTION = 63;
const ELLIPSIS = 0x2026;
const AT_SIGN = 64;

function isDigitCode(code) {
  return code >= 48 && code <= 57;
}

function isAlphaCode(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDomainTokenCode(code) {
  return isAlphaCode(code) || isDigitCode(code) || code === HYPHEN;
}

function isDomainSpanCode(code) {
  return code === DOT || code === AT_SIGN || isDomainTokenCode(code);
}

function looksLikeDomainSpan(token) {
  if (!token || token.indexOf('.') === -1) return false;

  const parts = token.split('.');
  if (parts.length < 2) return false;

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];
    if (part.length === 0) return false;

    let hasDomainChar = false;
    for (let j = 0; j < part.length; j++) {
      const code = part.charCodeAt(j);
      if (code === AT_SIGN) {
        if (idx !== 0 || j === part.length - 1) {
          return false;
        }
        continue;
      }

      if (!isDomainTokenCode(code)) {
        return false;
      }
      hasDomainChar = true;
    }

    if (!hasDomainChar) {
      return false;
    }
  }

  return true;
}

function collapseWhitespace(str) {
  if (!str) return '';
  const trimmed = str.trim();
  if (!trimmed) return '';

  if (
    trimmed.indexOf('  ') === -1 &&
    trimmed.indexOf('\n') === -1 &&
    trimmed.indexOf('\r') === -1 &&
    trimmed.indexOf('\t') === -1 &&
    trimmed.indexOf('\f') === -1 &&
    trimmed.indexOf('\v') === -1 &&
    trimmed.indexOf('\u00a0') === -1 &&
    trimmed.indexOf('\u2028') === -1 &&
    trimmed.indexOf('\u2029') === -1
  ) {
    return trimmed;
  }

  return trimmed.split(/\s+/).join(' ');
}

const abbreviations = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs']);

export function summarize(text, count = 1) {
  if (!text || count <= 0) return '';

  if (
    text.indexOf('.') === -1 &&
    text.indexOf('!') === -1 &&
    text.indexOf('?') === -1 &&
    text.indexOf('…') === -1
  ) {
    return collapseWhitespace(text);
  }

  const sentences = [];
  let start = 0;
  const len = text.length;
  let parenDepth = 0;
  let quoteCode = 0;

  for (let i = 0; i < len && sentences.length < count; i++) {
    const code = text.charCodeAt(i);

    if (code === OPEN_PARENS || code === OPEN_BRACKET || code === OPEN_BRACE) {
      parenDepth++;
    } else if (code === CLOSE_PARENS || code === CLOSE_BRACKET || code === CLOSE_BRACE) {
      if (parenDepth > 0) parenDepth--;
    } else if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
      if (quoteCode === code) quoteCode = 0;
      else if (quoteCode === 0) quoteCode = code;
    }

    if (code === DOT || code === EXCLAMATION || code === QUESTION || code === ELLIPSIS) {
      if (
        code === DOT &&
        i > 0 &&
        isDigitCode(text.charCodeAt(i - 1)) &&
        i + 1 < len &&
        isDigitCode(text.charCodeAt(i + 1))
      ) {
        continue;
      }

      if (code === DOT) {
        let w = i - 1;
        while (w >= 0 && isAlphaCode(text.charCodeAt(w))) w--;
        const word = text.slice(w + 1, i).toLowerCase();
        if (abbreviations.has(word)) {
          continue;
        }
      }

      let j = i + 1;
      while (j < len) {
        const nextCode = text.charCodeAt(j);
        if (
          nextCode === DOT ||
          nextCode === EXCLAMATION ||
          nextCode === QUESTION ||
          nextCode === ELLIPSIS
        ) {
          j++;
          continue;
        }
        break;
      }

      while (j < len) {
        const closeCode = text.charCodeAt(j);
        if (
          closeCode === CLOSE_PARENS ||
          closeCode === CLOSE_BRACKET ||
          closeCode === CLOSE_BRACE ||
          closeCode === DOUBLE_QUOTE ||
          closeCode === SINGLE_QUOTE
        ) {
          if (
            closeCode === CLOSE_PARENS ||
            closeCode === CLOSE_BRACKET ||
            closeCode === CLOSE_BRACE
          ) {
            if (parenDepth > 0) parenDepth--;
          } else if (quoteCode && closeCode === quoteCode) {
            quoteCode = 0;
          }
          j++;
          continue;
        }
        break;
      }

      let k = j;
      while (k < len && isSpaceCode(text.charCodeAt(k))) k++;

      let isLower = false;
      if (k < len) {
        const nextCode = text.charCodeAt(k);
        if (nextCode >= 0x61 && nextCode <= 0x7a) {
          isLower = true;
        } else if (nextCode >= 0x41 && nextCode <= 0x5a) {
          isLower = false;
        } else if (nextCode <= 0x7f) {
          isLower = false;
        } else {
          const nextChar = text[k];
          isLower =
            nextChar.toLowerCase() === nextChar &&
            nextChar.toUpperCase() !== nextChar;
        }
      }

      let hasDotBefore = false;
      let hasDotAfter = false;

      if (code === DOT) {
        for (let m = i - 1; m >= start && !isSpaceCode(text.charCodeAt(m)); m--) {
          if (text.charCodeAt(m) === DOT) {
            const before = m - 1 >= start ? text.charCodeAt(m - 1) : NaN;
            const after = m + 1 < len ? text.charCodeAt(m + 1) : NaN;
            const beforeIsAlpha = Number.isFinite(before) && isAlphaCode(before);
            const afterIsAlpha = Number.isFinite(after) && isAlphaCode(after);
            if (beforeIsAlpha || afterIsAlpha) {
              hasDotBefore = true;
              break;
            }
          }
        }

        for (let m = j; m < len && !isSpaceCode(text.charCodeAt(m)); m++) {
          if (text.charCodeAt(m) === DOT) {
            const before = m - 1 >= 0 ? text.charCodeAt(m - 1) : NaN;
            const after = m + 1 < len ? text.charCodeAt(m + 1) : NaN;
            const beforeIsAlpha = Number.isFinite(before) && isAlphaCode(before);
            const afterIsAlpha = Number.isFinite(after) && isAlphaCode(after);
            if (beforeIsAlpha || afterIsAlpha) {
              hasDotAfter = true;
              break;
            }
          }
        }
      }

      if (code === DOT) {
        const prevCode = i > 0 ? text.charCodeAt(i - 1) : NaN;
        const immediateNextCode = i + 1 < len ? text.charCodeAt(i + 1) : NaN;

        if (
          Number.isFinite(prevCode) &&
          Number.isFinite(immediateNextCode) &&
          !isSpaceCode(prevCode) &&
          !isSpaceCode(immediateNextCode) &&
          isDomainTokenCode(prevCode) &&
          isDomainTokenCode(immediateNextCode)
        ) {
          let tokenStart = i - 1;
          while (tokenStart >= start && isDomainSpanCode(text.charCodeAt(tokenStart))) {
            tokenStart--;
          }
          tokenStart++;

          let tokenEnd = i + 1;
          while (tokenEnd < len && isDomainSpanCode(text.charCodeAt(tokenEnd))) {
            tokenEnd++;
          }

          const token = text.slice(tokenStart, tokenEnd);
          if (looksLikeDomainSpan(token)) {
            continue;
          }
        }
      }

      let shouldSplit = false;
      if (parenDepth === 0 && quoteCode === 0) {
        if (k === len) {
          shouldSplit = true;
        } else if (code === DOT) {
          if (hasDotAfter) {
            shouldSplit = false;
          } else if (isLower && (hasDotBefore || hasDotAfter)) {
            shouldSplit = false;
          } else {
            shouldSplit = true;
          }
        } else {
          shouldSplit = true;
        }
      }

      if (shouldSplit) {
        sentences.push(text.slice(start, j));
        i = k;
        start = k;
        i--;
      }
    }
  }

  let summary;
  if (sentences.length === 0) {
    summary = text;
  } else {
    if (sentences.length < count && start < len) {
      sentences.push(text.slice(start));
    }
    summary = sentences.join(' ');
  }

  return collapseWhitespace(summary);
}

export { recordApplication, getLifecycleCounts, STATUSES } from './lifecycle.js';
