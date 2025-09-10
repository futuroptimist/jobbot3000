import { performance } from 'node:perf_hooks';
import { parseJobText } from '../src/parser.js';
import { describe, it, expect } from 'vitest';

describe('parseJobText performance', () => {
  it('findHeaderIndex scans lines efficiently', () => {
    const lines = Array(1000).fill('irrelevant line');
    lines.push('Responsibilities');
    const jobText = lines.join('\n');
    const iterations = 800;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      parseJobText(jobText);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(430);
  });
});
