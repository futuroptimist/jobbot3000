/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?', including consecutive punctuation (e.g. `?!`),
 * optionally followed by closing quotes or parentheses.
 * Falls back to returning the trimmed input when no such punctuation exists.
 * If fewer complete sentences than requested exist, any remaining text is appended
 * so no content is lost. Parenthetical abbreviations like `(M.Sc.)` remain attached
 * to their surrounding sentence.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';

  /**
   * Scan character-by-character to avoid costly regular expressions.
   * Prevents regex-based DoS and stops once the requested number
   * of sentences is collected.
   * Handles consecutive punctuation (`?!`), skips trailing closing
   * quotes/parentheses, and treats all Unicode whitespace as delimiters.
   */
  const sentences = [];
  let start = 0;
  const len = text.length;

  const spaceRe = /\s/;
  const isSpace = (c) => spaceRe.test(c);
  const closers = new Set(['"', "'", ')', ']', '}']);
  const openers = new Set(['(', '[', '{']);
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

    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1;

      // absorb consecutive punctuation like ?!
      while (j < len && (text[j] === '.' || text[j] === '!' || text[j] === '?')) j++;

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

      if (parenDepth === 0 && !quote && (k === len || !isLower)) {
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
