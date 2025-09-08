import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { computeFitScore } from '../src/scoring.js';

describe('computeFitScore performance', () => {
  it('processes many requirements within 700ms', () => {
    const resume =
      'I know JavaScript, Node.js, TypeScript, Python, Ruby, Java, and C++.';
    const requirements = [];
    for (let i = 0; i < 100; i += 1) {
      requirements.push('JavaScript', 'Node.js', 'TypeScript', 'Python', 'Ruby', 'Java', 'C++');
    }
    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      computeFitScore(resume, requirements);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(700);
  });
});
