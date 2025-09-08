import { performance } from 'node:perf_hooks';
import { computeFitScore } from '../src/scoring.js';
import { describe, it, expect } from 'vitest';

describe('computeFitScore performance', () => {
  it('tokenization is efficient', () => {
    const resume =
      'Experienced with JavaScript and Node.js frameworks along with other technologies';
    const bullets = Array(200).fill('Looking for JavaScript and Node.js experience');
    const iterations = 2000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeFitScore(resume, bullets);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(1100);
  });
});
