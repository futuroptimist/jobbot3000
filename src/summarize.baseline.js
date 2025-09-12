export function summarizeBaseline(text, count = 1) {
  if (!text || count <= 0) return '';
  const sentences = text.split(/(?<=[.!?…])\s+/).slice(0, count);
  return sentences.join(' ').replace(/\s+/g, ' ').trim();
}
