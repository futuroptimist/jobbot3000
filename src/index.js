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
  const placeholder = '\u2026';
  const safe = text.replace(/\.{3}/g, placeholder);
  const sentences = safe.split(/(?<=[.!?])\s+|\n/).slice(0, count);
  return sentences
    .map((s) => s.replace(new RegExp(placeholder, 'g'), '...'))
    .join(' ')
    .trim();
}
