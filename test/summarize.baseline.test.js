import { describe, it, expect } from 'vitest';
import { summarizeBaseline } from '../src/summarize.baseline.js';

describe('summarizeBaseline', () => {
  it('returns the first sentence and collapses whitespace', () => {
    const text = 'First   line.\nSecond line.';
    expect(summarizeBaseline(text)).toBe('First line.');
  });

  it('returns the first N sentences', () => {
    const text = 'First. Second. Third.';
    expect(summarizeBaseline(text, 2)).toBe('First. Second.');
  });

  it('handles unicode ellipsis', () => {
    const text = 'Wait… Next sentence.';
    expect(summarizeBaseline(text)).toBe('Wait…');
  });

  it('returns empty string when count is 0', () => {
    const text = 'First. Second.';
    expect(summarizeBaseline(text, 0)).toBe('');
  });

  it('returns empty string when count is negative', () => {
    const text = 'First. Second.';
    expect(summarizeBaseline(text, -1)).toBe('');
  });
});
