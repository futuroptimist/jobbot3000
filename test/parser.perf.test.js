import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { parseJobText } from '../src/parser.js';

describe('parseJobText performance', () => {
  it('parses efficiently', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `Line ${i}`).join('\n');
    const iterations = 2000; // Heavy enough to catch regressions but stable in CI
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      parseJobText(text);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(900);
  });
});
