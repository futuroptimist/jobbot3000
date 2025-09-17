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
function isSpaceCharCode(code) {
  if (code <= 13) return code >= 9; // tab, line feed, vertical tab, form feed, carriage return
  if (code === 32) return true; // space
  if (code === 133 || code === 160) return true; // next line, non-breaking space
  if (code === 5760 || code === 6158) return true; // ogham mark, mongolian separator
  if (code >= 8192 && code <= 8202) return true; // en quad through hair space
  if (
    code === 8232 || // line separator
    code === 8233 || // paragraph separator
    code === 8239    // narrow nbsp
  ) {
    return true;
  }
  if (
    code === 8287 || // medium math space
    code === 12288 || // ideographic space
    code === 65279 // BOM
  ) {
    return true;
  }
  return false;
}

const isBracketCloser = (c) => c === ')' || c === ']' || c === '}';
const isQuote = (c) => c === '"' || c === "'";
const isDigit = (c) => c >= '0' && c <= '9';
const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isWordChar = (c) => isAlpha(c) || isDigit(c);
const abbreviations = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs']);
const SIMPLE_BLOCK_RE = /["'()[\]{}]/;
const WHITESPACE_FINDER = /\s*/y;

function summarizeSimpleSingle(text) {
  const len = text.length;
  const punctuation = /[.!?…]+/g;
  let match;

  while ((match = punctuation.exec(text))) {
    const index = match.index;
    const ch = text[index];

    if (
      ch === '.' &&
      index > 0 &&
      isDigit(text[index - 1]) &&
      index + 1 < len &&
      isDigit(text[index + 1])
    ) {
      continue;
    }

    if (ch === '.') {
      let w = index - 1;
      while (w >= 0 && isAlpha(text[w])) w--;
      const word = text.slice(w + 1, index).toLowerCase();
      if (abbreviations.has(word)) {
        continue;
      }
    }

    let j = index + match[0].length;
    WHITESPACE_FINDER.lastIndex = j;
    WHITESPACE_FINDER.exec(text);
    j = WHITESPACE_FINDER.lastIndex;

    const next = text[j];
    const isLower = next && next.toLowerCase() === next && next.toUpperCase() !== next;
    if (j < len && isLower) {
      continue;
    }

    WHITESPACE_FINDER.lastIndex = 0;
    return text.slice(0, index + match[0].length).replace(/\s+/g, ' ').trim();
  }

  WHITESPACE_FINDER.lastIndex = 0;
  return text.replace(/\s+/g, ' ').trim();
}

function summarizeSimple(text, count) {
  if (count === 1) {
    return summarizeSimpleSingle(text);
  }
  const sentences = [];
  let start = 0;
  const len = text.length;
  const punctuation = /[.!?…]+/g;
  let match;

  while (sentences.length < count && (match = punctuation.exec(text))) {
    const index = match.index;
    const ch = text[index];

    if (
      ch === '.' &&
      index > 0 &&
      isDigit(text[index - 1]) &&
      index + 1 < len &&
      isDigit(text[index + 1])
    ) {
      continue;
    }

    if (ch === '.') {
      let w = index - 1;
      while (w >= 0 && isAlpha(text[w])) w--;
      const word = text.slice(w + 1, index).toLowerCase();
      if (abbreviations.has(word)) {
        continue;
      }
    }

    let j = index + match[0].length;
    WHITESPACE_FINDER.lastIndex = j;
    WHITESPACE_FINDER.exec(text);
    j = WHITESPACE_FINDER.lastIndex;

    const next = text[j];
    const isLower = next && next.toLowerCase() === next && next.toUpperCase() !== next;
    if (j < len && isLower) {
      continue;
    }

    sentences.push(text.slice(start, index + match[0].length));
    start = j;
    punctuation.lastIndex = j;
  }

  let summary;
  if (!sentences.length) {
    summary = text;
  } else {
    if (sentences.length < count && start < len) {
      sentences.push(text.slice(start));
    }
    summary = sentences.join(' ');
  }

  WHITESPACE_FINDER.lastIndex = 0;
  return summary.replace(/\s+/g, ' ').trim();
}

export function summarize(text, count = 1) {
  if (!text || count <= 0) return '';

  if (!SIMPLE_BLOCK_RE.test(text)) {
    return summarizeSimple(text, count);
  }

  /**
   * Scan character-by-character to avoid costly regular expressions.
   * Prevents regex-based DoS and stops once the requested number
   * of sentences is collected. Hoisting whitespace/digit helpers
   * and punctuation sets avoids per-call allocations.
   * Handles consecutive punctuation (`?!`), skips trailing closing
   * quotes/parentheses, treats all Unicode whitespace as delimiters,
   * and avoids splitting on decimal numbers.
   */
  const sentences = [];
  let start = 0;
  const len = text.length;
  let parenDepth = 0;
  let quote = null;

  for (let i = 0; i < len && sentences.length < count; i++) {
    const code = text.charCodeAt(i);

    switch (code) {
      case 40: // (
      case 91: // [
      case 123: // {
        parenDepth++;
        continue;
      case 41: // )
      case 93: // ]
      case 125: // }
        if (parenDepth > 0) parenDepth--;
        continue;
      case 34: { // "
        if (quote === '"') quote = null;
        else if (!quote) quote = '"';
        continue;
      }
      case 39: { // '
        const prev = i > 0 ? text[i - 1] : '';
        const next = i + 1 < len ? text[i + 1] : '';
        const prevIsWord = prev && isWordChar(prev);
        const nextIsWord = next && isWordChar(next);

        if (quote === "'") {
          if (!prevIsWord || !nextIsWord) quote = null;
          continue;
        }

        if (prevIsWord && nextIsWord) {
          continue; // contraction/measurement
        }

        if (!quote && !prevIsWord) {
          let ahead = i + 1;
          while (ahead < len && isWordChar(text[ahead])) ahead++;
          if (ahead < len && text[ahead] === "'") {
            quote = "'";
          }
        }

        continue;
      }
      case 46: // .
      case 33: // !
      case 63: // ?
      case 8230: { // …
        const ch = code === 8230 ? '…' : text[i];

        // Skip decimals like 3.14
        if (ch === '.' && i > 0 && isDigit(text[i - 1]) && i + 1 < len && isDigit(text[i + 1])) {
          continue;
        }

        if (ch === '.') {
          let w = i - 1;
          while (w >= 0 && isAlpha(text[w])) w--;
          const word = text.slice(w + 1, i).toLowerCase();
          if (abbreviations.has(word)) {
            continue;
          }
        }

        let j = i + 1;

        // absorb consecutive punctuation like ?!
        while (
          j < len &&
          (text[j] === '.' || text[j] === '!' || text[j] === '?' || text[j] === '…')
        ) {
          j++;
        }

        // absorb trailing closers (quotes, parentheses)
        while (j < len) {
          const trailing = text[j];
          if (isBracketCloser(trailing)) {
            if (parenDepth > 0) parenDepth--;
            j++;
            continue;
          }
          if (isQuote(trailing)) {
            if (quote && trailing === quote) {
              quote = null;
            }
            j++;
            continue;
          }
          break;
        }

        // move forward to next non-space
        let k = j;
        while (k < len && isSpaceCharCode(text.charCodeAt(k))) k++;

        const next = text[k];
        const isLower = next && next.toLowerCase() === next && next.toUpperCase() !== next;

        if (parenDepth === 0 && !quote && (k === len || !isLower)) {
          sentences.push(text.slice(start, j));
          i = k;
          start = k;
          i--; // adjust for loop increment
        }
        break;
      }
      default:
        continue;
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

  return summary.replace(/\s+/g, ' ').trim();
}

export { recordApplication, getLifecycleCounts, STATUSES } from './lifecycle.js';
