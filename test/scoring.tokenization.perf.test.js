import { performance } from 'node:perf_hooks';
import { computeFitScore } from '../src/scoring.js';
import { describe, it, expect } from 'vitest';

describe('computeFitScore tokenization performance', () => {
  it('tokenizes large resumes efficiently', () => {
    const resume = 'a '.repeat(100000);
    const bullets = ['needs a'];
    const iterations = 20;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeFitScore(resume + i, bullets);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(200);
  });
});
