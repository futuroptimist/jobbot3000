/**
 * Return the first N sentences from the given text.
 * Sentences end with '.', '!' or '?', optionally followed by closing quotes
 * or parentheses. If no terminator is found, the entire text is returned.
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
      let j = i + 1;
      while (j < text.length && (text[j] === '.' || text[j] === '!' || text[j] === '?')) j++;
      while (j < text.length && "\"'\u201d\u2019)".includes(text[j])) j++;
      if (j === text.length || /\s/.test(text[j])) {
        sentences.push(text.slice(start, j));
        j++;
        while (j < text.length && /\s/.test(text[j])) j++;
        start = j;
        i = j;
      } else {
        i++;
      }
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
