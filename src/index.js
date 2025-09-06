export function summarize(text, count = 1) {
  if (!text) return '';
  const sentences = text.split(/(?<=\.)\s|\n/).slice(0, count);
  return sentences.join(' ').trim();
}
