import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';
import { summarize } from '../src/index.js';

// Baseline summarizer using Set lookups for parentheses and quotes.
function summarizeWithSets(text, count = 1) {
  if (!text) return '';
  const spaceRe = /\s/;
  const isSpace = (c) => spaceRe.test(c);
  const closers = new Set(['"', "'", ')', ']', '}']);
  const openers = new Set(['(', '[', '{']);
  const isDigit = (c) => c >= '0' && c <= '9';
  const sentences = [];
  let start = 0;
  const len = text.length;
  let parenDepth = 0;
  let quote = null;
  for (let i = 0; i < len && sentences.length < count; i++) {
    const ch = text[i];
    if (openers.has(ch)) parenDepth++;
    else if (closers.has(ch)) {
      if (ch === ')' || ch === ']' || ch === '}') {
        if (parenDepth > 0) parenDepth--;
      }
    } else if (ch === '"' || ch === "'") {
      if (quote === ch) quote = null;
      else if (!quote) quote = ch;
    }
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      if (ch === '.' && i > 0 && isDigit(text[i - 1]) && i + 1 < len && isDigit(text[i + 1])) {
        continue;
      }
      let j = i + 1;
      while (
        j < len &&
        (text[j] === '.' || text[j] === '!' || text[j] === '?' || text[j] === '…')
      ) j++;
      while (j < len && closers.has(text[j])) {
        if (text[j] === ')' || text[j] === ']' || text[j] === '}') {
          if (parenDepth > 0) parenDepth--;
        } else if (quote && text[j] === quote) {
          quote = null;
        }
        j++;
      }
      let k = j;
      while (k < len && isSpace(text[k])) k++;
      const next = text[k];
      const isLower = next && next.toLowerCase() === next && next.toUpperCase() !== next;
      if (parenDepth === 0 && !quote && (k === len || !isLower)) {
        sentences.push(text.slice(start, j));
        i = k;
        start = k;
        i--;
      }
    }
  }
  let summary;
  if (sentences.length === 0) {
    summary = text;
  } else {
    if (sentences.length < count && start < len) {
      sentences.push(text.slice(start));
    }
    summary = sentences.join(' ');
  }
  return summary.replace(/\s+/g, ' ').trim();
}

describe('summarize whitespace performance', () => {
  it('outperforms Set-based implementation', () => {
    const text = 'Hello. ' + 'a'.repeat(1000) + '. ';
    const iterations = 10000;
    summarize(text, 1); // warm up JIT
    const t1 = performance.now();
    for (let i = 0; i < iterations; i++) summarize(text, 1);
    const optimized = performance.now() - t1;

    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) summarizeWithSets(text, 1);
    const baseline = performance.now() - t2;

    expect(optimized).toBeLessThan(baseline);
  });
});
