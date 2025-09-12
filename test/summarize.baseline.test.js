import { describe, it, expect } from 'vitest';
import { summarizeBaseline } from '../src/summarize.baseline.js';

describe('summarizeBaseline', () => {
  it('returns empty string when count is 0', () => {
    const text = 'First. Second.';
    expect(summarizeBaseline(text, 0)).toBe('');
  });

  it('returns empty string when count is negative', () => {
    const text = 'First. Second.';
    expect(summarizeBaseline(text, -1)).toBe('');
  });

  it('returns first sentence and collapses whitespace', () => {
    const text = 'First sentence.   \nSecond sentence.';
    expect(summarizeBaseline(text)).toBe('First sentence.');
  });

  it('returns trimmed text when no sentence terminator exists', () => {
    const text = '  No punctuation here  ';
    expect(summarizeBaseline(text, 3)).toBe('No punctuation here');
  });
});
