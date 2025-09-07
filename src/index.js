/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' followed by whitespace or a newline.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';
  const matches = text.match(/[^.!?]+[.!?](?:\s+)?/g);
  if (matches) {
    return matches.slice(0, count).join('').trim();
  }
  return text.trim();
}
