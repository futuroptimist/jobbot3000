/**
 * Return the first sentence from the given text.
 * Sentences end with '.', '!' or '?' followed by whitespace or a newline.
 *
 * @param {string} text
 * @returns {string}
 */
export function summarize(text) {
  if (!text) return '';
  const firstSentence = text.split(/(?<=[.!?])\s+|\n/)[0];
  return firstSentence.trim();
}
