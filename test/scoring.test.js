import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { computeFitScore } from '../src/scoring.js';

describe('computeFitScore', () => {
  it('scores matched and missing requirements', () => {
    const resume = 'I know JavaScript and Node.js.';
    const requirements = ['JavaScript', 'Python'];
    const result = computeFitScore(resume, requirements);
    expect(result.score).toBe(50);
    expect(result.matched).toEqual(['JavaScript']);
    expect(result.missing).toEqual(['Python']);
  });

  it('processes large requirement lists within 2500ms', () => {
    const resume = 'skill '.repeat(1000);
    const requirements = Array(100).fill('skill');
    const start = performance.now();
    for (let i = 0; i < 10000; i += 1) {
      computeFitScore(resume, requirements);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2500);
  });
});
