/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' followed by whitespace or a newline.
 * Falls back to returning the trimmed input when no such punctuation exists.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';

  /**
   * Scan character-by-character to avoid costly regular expressions.
   * This prevents regex-based DoS and stops once the requested number
   * of sentences is collected.
   */
  const sentences = [];
  let start = 0;
  const len = text.length;

  // Treat any Unicode whitespace as a delimiter to match previous \s behaviour
  const isSpace = (c) => c.trim() === '';
  const isClosing = (c) => c === "\"" || c === "'" || c === ')' || c === ']' || c === '}';
  const isOpening = (c) => c === '(' || c === '[' || c === '{';
  let parenDepth = 0;
  let quote = null;

  for (let i = 0; i < len && sentences.length < count; i++) {
    const ch = text[i];
    if (isOpening(ch)) parenDepth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (parenDepth > 0) parenDepth--;
    } else if (ch === "\"" || ch === "'") {
      if (quote === ch) quote = null;
      else if (!quote) quote = ch;
    }

    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1;
      while (j < len && isClosing(text[j])) {
        const c = text[j];
        if (c === ')' || c === ']' || c === '}') {
          if (parenDepth > 0) parenDepth--;
        } else if (quote && c === quote) {
          quote = null;
        }
        j++;
      }
      let k = j;
      while (k < len && isSpace(text[k])) k++;
      const next = text[k];
      const isLower =
        next && next.toLowerCase() === next && next.toUpperCase() !== next;
      if (parenDepth === 0 && !quote && (k === len || !isLower)) {
        sentences.push(text.slice(start, j));
        i = k;
        start = k;
        i--; // compensate for loop increment
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
