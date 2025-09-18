/**
 * Return the first N sentences from the given text.
 * If `count` is zero or negative, returns an empty string.
 * Sentences end with '.', '!', '?', or '…', including consecutive punctuation (e.g. `?!`),
 * optionally followed by closing quotes or parentheses.
 * Falls back to returning the trimmed input when no such punctuation exists.
 * If fewer complete sentences than requested exist, any remaining text is appended
 * so no content is lost. Parenthetical abbreviations like `(M.Sc.)` remain attached
 * to their surrounding sentence. Avoids splitting on decimal numbers.
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
const EXCLAMATION = 33;
const QUESTION = 63;
const ELLIPSIS = 0x2026;

function isDigitCode(code) {
  return code >= 48 && code <= 57;
}

function isAlphaCode(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

const LOWERCASE_DOMAIN_PATTERN = new RegExp(
  '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+' +
    '(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)' +
    '(?:[/?#][^\\s]*)?$'
);

function isDomainCharCode(code) {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 || // -
    code === 46 || // .
    code === 47 || // /
    code === 58 || // :
    code === 63 || // ?
    code === 35 || // #
    code === 38 || // &
    code === 61 || // =
    code === 37 || // %
    code === 64 || // @
    code === 95 || // _
    code === 126 || // ~
    code === 43 // +
  );
}

function isLowercaseDomainContinuation(text, dotIndex, nextIndex) {
  let start = dotIndex;
  while (start > 0 && isDomainCharCode(text.charCodeAt(start - 1))) {
    start--;
  }

  const len = text.length;
  let end = nextIndex;
  while (end < len && isDomainCharCode(text.charCodeAt(end))) {
    end++;
  }

  if (end <= dotIndex + 1) return false;

  let candidate = text.slice(start, end);
  const atIndex = candidate.lastIndexOf('@');
  if (atIndex !== -1) {
    candidate = candidate.slice(atIndex + 1);
  }

  if (candidate.startsWith('https://')) {
    candidate = candidate.slice(8);
  } else if (candidate.startsWith('http://')) {
    candidate = candidate.slice(7);
  }

  if (candidate.startsWith('www.')) {
    candidate = candidate.slice(4);
  }

  candidate = candidate.replace(/\.+$/, '');

  if (!candidate || candidate.indexOf('.') === -1) {
    return false;
  }

  return LOWERCASE_DOMAIN_PATTERN.test(candidate);
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

      const wasInsideParens = parenDepth > 0;

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

      let blockLowercaseSplit = false;
      if (isLower) {
        if (wasInsideParens) {
          blockLowercaseSplit = true;
        } else if (code === DOT && k === j && isLowercaseDomainContinuation(text, i, k)) {
          blockLowercaseSplit = true;
        }
      }

      if (parenDepth === 0 && quoteCode === 0 && (k === len || !isLower || !blockLowercaseSplit)) {
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
