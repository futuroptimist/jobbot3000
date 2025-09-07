/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' followed by whitespace.
 * If the text has no punctuation, newlines separate sentences.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';
  const normalized = text.replace(/\r/g, '');
  const hasPunctuation = /[.!?]/.test(normalized);
  const parts = hasPunctuation
    ? normalized.split(/(?<=[.!?])\s+/)
    : normalized.split(/\n+/);
  const sentences = parts.slice(0, count);
  return sentences.join(' ').replace(/\n+/g, ' ').trim();
}
