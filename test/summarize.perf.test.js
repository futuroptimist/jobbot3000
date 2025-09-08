import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';
import { summarize } from '../src/index.js';
import { summarizeBaseline } from '../src/summarize.baseline.js';

describe('summarize performance', () => {
  it('is faster than baseline implementation', () => {
    const text = Array.from({ length: 100000 }, (_, i) => `Sentence ${i}.`).join(' ');

    const t1 = performance.now();
    summarize(text, 2);
    const optimized = performance.now() - t1;

    const t2 = performance.now();
    summarizeBaseline(text, 2);
    const baseline = performance.now() - t2;

    expect(optimized).toBeLessThan(baseline);
  });
});
