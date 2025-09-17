import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { summarize } from '../src/index.js';
import { summarizeBaseline } from '../src/summarize.baseline.js';

function run(fn, text, iterations = 5) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn(text, 1);
  }
  return performance.now() - start;
}

describe('summarize whitespace performance', () => {
  it('handles dense whitespace faster than baseline', () => {
    const text = `${'Word '.repeat(200000)}end.`;
    // warm up
    summarize(text, 1);
    summarizeBaseline(text, 1);

    const optimized = run(summarize, text);
    const baseline = run(summarizeBaseline, text);

    expect(optimized).toBeLessThan(baseline);
  });
});
