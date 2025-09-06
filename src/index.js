export function summarize(text) {
  if (!text) return '';
  const firstSentence = text.split(/(?<=[.!?])\s+|\n/)[0];
  return firstSentence.trim();
}
