import { performance } from 'node:perf_hooks';
import { describe, it, expect } from 'vitest';
import { computeFitScore } from '../src/scoring.js';

describe('computeFitScore resume tokenization performance', () => {
  it('tokenizes a 120k-line resume within 200ms', () => {
    const resume = Array.from({ length: 120000 }, (_, i) => `Skill ${i}`).join('\n');
    const requirements = ['Skill 123', 'Skill 119999'];
    const start = performance.now();
    computeFitScore(resume, requirements);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(200);
  });
});
