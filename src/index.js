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
  const isClosing = (c) => c === '"' || c === '\'' || c === ')' || c === ']' || c === '}';

  for (let i = 0; i < len && sentences.length < count; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1;
      while (j < len && isClosing(text[j])) j++;
      if (j === len || isSpace(text[j])) {
        sentences.push(text.slice(start, j));
        i = j;
        while (i < len && isSpace(text[i])) i++;
        start = i;
        i--; // compensate for loop increment
      }
    }
  }

  const summary = sentences.length ? sentences.join(' ') : text;
  return summary.replace(/\s+/g, ' ').trim();
}
