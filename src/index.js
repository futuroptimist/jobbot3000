/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?' optionally followed by closing quotes or parentheses.
 * If no terminator is found, the entire text is returned.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!text) return '';
  const sentences = [];
  let start = 0;
  let i = 0;
  while (i < text.length && sentences.length < count) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      i++;
      while (
        i < text.length &&
        "\"'\u201d\u2019)".includes(text[i])
      ) {
        i++;
      }
      sentences.push(text.slice(start, i));
      while (i < text.length && /\s/.test(text[i])) i++;
      start = i;
    } else {
      i++;
    }
  }
  if (sentences.length < count && start < text.length) {
    sentences.push(text.slice(start));
  }
  return sentences
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .join(' ')
    .trim();
}
