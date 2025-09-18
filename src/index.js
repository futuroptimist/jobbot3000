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
const spaceRe = /\s/;
const isSpace = (c) => spaceRe.test(c);
const closers = new Set(['"', "'", ')', ']', '}']);
const openers = new Set(['(', '[', '{']);
const isDigit = (c) => c >= '0' && c <= '9';
const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const abbreviations = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs']);
const isLowerTokenChar = (c) => (c >= 'a' && c <= 'z') || isDigit(c) || c === '-';
const isLowerDomainChar = (c) => c === '.' || isLowerTokenChar(c);
const lowercaseDomainPattern = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export function summarize(text, count = 1) {
  if (!text || count <= 0) return '';

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
    const ch = text[i];

    // Track nesting
    if (openers.has(ch)) parenDepth++;
    else if (closers.has(ch)) {
      if (ch === ')' || ch === ']' || ch === '}') {
        if (parenDepth > 0) parenDepth--;
      }
    } else if (ch === '"' || ch === "'") {
      if (quote === ch) quote = null;
      else if (!quote) quote = ch;
    }

    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
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
      while (j < len && closers.has(text[j])) {
        if (text[j] === ')' || text[j] === ']' || text[j] === '}') {
          if (parenDepth > 0) parenDepth--;
        } else if (quote && text[j] === quote) {
          quote = null;
        }
        j++;
      }

      // move forward to next non-space
      let k = j;
      while (k < len && isSpace(text[k])) k++;

      const next = text[k];
      const isLower = next && next.toLowerCase() === next && next.toUpperCase() !== next;

      let hasDotBefore = false;
      let hasDotAfter = false;
      if (ch === '.') {
        for (let m = i - 1; m >= start && !isSpace(text[m]); m--) {
          if (
            text[m] === '.' &&
            ((m + 1 < len && isAlpha(text[m + 1])) || (m - 1 >= 0 && isAlpha(text[m - 1])))
          ) {
            hasDotBefore = true;
            break;
          }
        }
        for (let m = j; m < len && !isSpace(text[m]); m++) {
          if (
            text[m] === '.' &&
            ((m + 1 < len && isAlpha(text[m + 1])) || (m - 1 >= 0 && isAlpha(text[m - 1])))
          ) {
            hasDotAfter = true;
            break;
          }
        }
      }

      if (ch === '.') {
        const prev = i > 0 ? text[i - 1] : null;
        const immediateNext = i + 1 < len ? text[i + 1] : null;

        if (
          prev &&
          immediateNext &&
          !isSpace(prev) &&
          !isSpace(immediateNext) &&
          isLowerTokenChar(prev) &&
          isLowerTokenChar(immediateNext)
        ) {
          let tokenStart = i - 1;
          while (tokenStart >= start && isLowerDomainChar(text[tokenStart])) {
            tokenStart--;
          }
          tokenStart++;

          let tokenEnd = i + 1;
          while (tokenEnd < len && isLowerDomainChar(text[tokenEnd])) {
            tokenEnd++;
          }

          const token = text.slice(tokenStart, tokenEnd);
          if (lowercaseDomainPattern.test(token)) {
            continue;
          }
        }
      }

      let shouldSplit = false;
      if (parenDepth === 0 && !quote) {
        if (k === len) {
          shouldSplit = true;
        } else if (ch === '.') {
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
        i--; // adjust for loop increment
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

  return summary.replace(/\s+/g, ' ').trim();
}

export { recordApplication, getLifecycleCounts, STATUSES } from './lifecycle.js';
