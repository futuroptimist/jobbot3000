import { describe, it, expect } from 'vitest';
import { computeFitScore } from '../src/scoring.js';

describe('computeFitScore requirement filtering performance', () => {
  it('avoids repeated array filtering for mixed inputs', () => {
    const skills = Array.from({ length: 5000 }, (_, i) => `Skill ${i}`);
    const mixed = skills.concat(Array.from({ length: 5000 }, () => null));
    const iterations = 200;

    const originalFilter = Array.prototype.filter;
    let filterCalls = 0;
    Array.prototype.filter = function patchedFilter(...args) {
      filterCalls += 1;
      return originalFilter.apply(this, args);
    };

    try {
      for (let i = 0; i < iterations; i += 1) {
        computeFitScore('Skill resume', mixed);
      }
    } finally {
      Array.prototype.filter = originalFilter;
    }

    expect(filterCalls).toBe(0);
  });
});
