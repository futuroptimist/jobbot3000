import { performance } from 'node:perf_hooks';
import { computeFitScore } from '../src/scoring.js';
import { describe, it, expect } from 'vitest';

describe('computeFitScore large input performance', () => {
  it('scores 50k unique requirements efficiently', () => {
    const resume = 'Skilled in JavaScript and Node.js development';
    const bullets = Array.from({ length: 50000 }, (_, i) => `Requirement ${i} needs JS`);
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      computeFitScore(resume, bullets);
    }
    const duration = performance.now() - start;
      expect(duration).toBeLessThan(1000);
  });
});
