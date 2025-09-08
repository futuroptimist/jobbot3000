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
  const result = [];
  const re = /[^.!?]*[.!?](?:\s+|$)/g;
  let match;
  // Scan incrementally to avoid splitting the entire string into sentences
  while (result.length < count && (match = re.exec(text)) !== null) {
    result.push(match[0]);
  }
  return result.join(' ').replace(/\s+/g, ' ').trim();
}
