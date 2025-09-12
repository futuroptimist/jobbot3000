import { performance } from 'node:perf_hooks';
import { parseJobText } from '../src/parser.js';
import { describe, it, expect } from 'vitest';

describe('parseJobText field extraction performance', () => {
  it('extracts header fields in a single pass', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `Line ${i}`);
    lines.push('Responsibilities: do things');
    const text = lines.join('\n');
    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      parseJobText(text);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(4000);
  });
});
