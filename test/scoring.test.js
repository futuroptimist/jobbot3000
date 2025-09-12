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

  it('matches tokens case-insensitively', () => {
    const resume = 'Expert in PYTHON and Go.';
    const requirements = ['python'];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({ score: 100, matched: ['python'], missing: [] });
  });

  it('ignores non-string requirement entries', () => {
    const resume = 'Strong in Go';
    const requirements = ['Go', null, 123, undefined];
    const result = computeFitScore(resume, requirements);
    expect(result.score).toBe(25);
    expect(result.matched).toEqual(['Go']);
    expect(result.missing).toEqual([null, 123, undefined]);
  });

  it('returns zero score when no requirements given', () => {
    const result = computeFitScore('anything', []);
    expect(result).toEqual({ score: 0, matched: [], missing: [] });
  });

  // Allow slower CI environments by using a relaxed threshold.
  it('processes large requirement lists within 2500ms', () => {
    const resume = 'skill '.repeat(1000);
    const requirements = Array(100).fill('skill');
    computeFitScore(resume, requirements); // warm up JIT
    const start = performance.now();
    for (let i = 0; i < 5000; i += 1) {
      computeFitScore(resume, requirements);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2500);
  });
});
