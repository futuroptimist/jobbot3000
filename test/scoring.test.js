import { describe, it, expect } from 'vitest';
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
});
