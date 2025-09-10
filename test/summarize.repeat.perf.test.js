import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';
import { summarize } from '../src/index.js';

describe('summarize repeated calls performance', () => {
  it('handles 10k short texts under 500ms', () => {
    const text = 'Hello. ' + 'a'.repeat(1000) + '. ';
    const iterations = 10000;
    summarize(text, 1); // warm up JIT
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      summarize(text, 1);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
