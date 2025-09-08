/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' optionally followed by closing quotes or parentheses.
 * Falls back to returning the trimmed input when no such punctuation exists.
 * If fewer complete sentences than requested exist, any remaining text is appended so no content is lost.
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
   * Skips trailing closing quotes/parentheses and treats all Unicode
   * whitespace as valid delimiters.
   */
  const sentences = [];
  let start = 0;
  const len = text.length;

  const spaceRe = /\s/;
  const isSpace = (c) => spaceRe.test(c);
  const closers = new Set(['"', "'", ')', ']', '}']);

  for (let i = 0; i < len && sentences.length < count; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1;
      while (j < len && closers.has(text[j])) j++;
      if (j === len || isSpace(text[j])) {
        sentences.push(text.slice(start, j));
        i = j;
        while (i < len && isSpace(text[i])) i++;
        start = i;
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
