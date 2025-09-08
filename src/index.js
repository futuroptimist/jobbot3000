/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' optionally followed by a closing quote and whitespace.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';
  const sentences = text
    .split(/(?<=[.!?]["'\u201d\u2019]?)\s+/)
    .slice(0, count);
  return sentences.join(' ').replace(/\s+/g, ' ').trim();
}
