import { SentenceExtractor, collapseWhitespace } from './sentence-extractor.js';

/**
 * Return the first N sentences from the given text.
 * If `count` is zero or negative, returns an empty string.
 * Sentences end with '.', '!', '?', or '…', including consecutive punctuation (e.g. `?!`),
 * optionally followed by closing quotes or parentheses.
 * Falls back to returning the trimmed input when no such punctuation exists.
 * If fewer complete sentences than requested exist, any remaining text is appended
 * so no content is lost. Parenthetical abbreviations like `(M.Sc.)` remain attached
 * to their surrounding sentence. Avoids splitting on decimal numbers.
 * Returns an empty string when `count` is 0 or less.
 *
 * @param {string} text
 * @param {number} count Number of sentences to return; values <= 0 yield ''.
 * @returns {string}
 */
export function summarize(text, count = 1) {
  if (!Number.isFinite(count)) {
    const parsed = Number(count);
    count = Number.isFinite(parsed) ? parsed : 1;
  }

  if (!text || count <= 0) return '';

  const sourceText = typeof text === 'string' ? text : String(text);

  if (
    sourceText.indexOf('.') === -1 &&
    sourceText.indexOf('!') === -1 &&
    sourceText.indexOf('?') === -1 &&
    sourceText.indexOf('…') === -1
  ) {
    return collapseWhitespace(sourceText);
  }

  const extractor = new SentenceExtractor(sourceText);
  const sentences = [];

  while (sentences.length < count) {
    const sentence = extractor.next();
    if (sentence == null) break;
    sentences.push(sentence);
  }

  if (sentences.length === 0) {
    return collapseWhitespace(sourceText);
  }

  const summary = sentences.join(' ');
  return collapseWhitespace(summary);
}

export {
  recordApplication,
  getLifecycleCounts,
  resolveLifecycleConflicts,
  STATUSES,
} from './lifecycle.js';
export {
  listExperimentsForStatus,
  getExperimentById,
  analyzeExperiment,
  setLifecycleExperimentDataDir,
  archiveExperimentAnalysis,
  getExperimentAnalysisHistory,
} from './lifecycle-experiments.js';
export { generateCoverLetter } from './cover-letter.js';
