import { performance } from 'node:perf_hooks';
import { parseJobText } from '../src/parser.js';
import { describe, it, expect } from 'vitest';

describe('parseJobText bullet stripping performance', () => {
  it('strips bullet prefixes quickly', () => {
    const lines = ['Requirements:'];
    for (let i = 0; i < 20000; i += 1) lines.push(`- item ${i}`);
    const text = lines.join('\n');
    const iterations = 200;
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      parseJobText(text);
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(3500);
  });
});
