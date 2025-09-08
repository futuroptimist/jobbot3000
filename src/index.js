/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' optionally followed by closing quotes or parentheses.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';
  const sentences =
    text.match(/[^.!?]+[.!?](?:["'\u201d\u2019)])*/g) || [];
  return sentences
    .slice(0, count)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
