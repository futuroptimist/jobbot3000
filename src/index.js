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
   * Handles `.`, `!`, `?`, including when followed by quotes or parentheses.
   * This prevents regex-based DoS and stops once the requested number
   * of sentences is collected.
   */
  const sentences = [];
  let start = 0;
  const len = text.length;

  const isSpace = (c) =>
    c === ' ' || c === '\n' || c === '\t' || c === '\r';

  for (let i = 0; i < len && sentences.length < count; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      const next = text[i + 1];
      // Allow end of text, whitespace, or common closing punctuation
      if (
        i + 1 === len ||
        isSpace(next) ||
        next === '"' ||
        next === "'" ||
        next === ')' ||
        next === ']'
      ) {
        sentences.push(text.slice(start, i + 1));
        i += 1;
        while (i < len && isSpace(text[i])) i += 1;
        start = i;
        i -= 1; // compensate for loop increment
      }
    }
  }

  const summary = sentences.length
    ? sentences.join(' ')
    : text;
  return summary.replace(/\s+/g, ' ').trim();
}
