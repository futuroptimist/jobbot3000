/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' optionally followed by closing quotes or parentheses.
 * Falls back to returning the trimmed input when no such punctuation exists.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';

  // Match sentences ending with punctuation, optionally followed by quotes/parentheses
  const sentences =
    text.match(/[^.!?]+[.!?](?:["')\]\u201d\u2019])*/g) || [];

  return sentences.length
    ? sentences.slice(0, count).join(' ').replace(/\s+/g, ' ').trim()
    : text.trim();
}
