/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' optionally followed by a closing quote or
 * parenthesis, then whitespace or a newline.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';
  const sentences = text
    .split(/(?<=[.!?]["')\]])\s+|(?<=[.!?])\s+/)
    .slice(0, count);
  return sentences.join(' ').replace(/\s+/g, ' ').trim();
}
