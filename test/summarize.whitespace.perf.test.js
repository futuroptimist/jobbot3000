import { performance } from 'node:perf_hooks';
import { describe, it, expect } from 'vitest';
import { summarize } from '../src/index.js';

describe('summarize whitespace scanning performance', () => {
  it('processes long whitespace-only tails fast enough', () => {
    const text = ('word '.repeat(200000)) + 'tail';
    const iterations = 5;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      summarize(text, 1);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(400);
  });
});
