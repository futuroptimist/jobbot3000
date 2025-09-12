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

  it('returns the first sentence by default', () => {
    const text = 'First sentence. Second sentence.';
    expect(summarizeBaseline(text)).toBe('First sentence.');
  });

  it('returns the first N sentences and normalizes whitespace', () => {
    const text = 'First.  Second.\nThird.';
    expect(summarizeBaseline(text, 2)).toBe('First. Second.');
  });

  it('returns trimmed text when no terminator is present', () => {
    const text = '  No punctuation here  ';
    expect(summarizeBaseline(text)).toBe('No punctuation here');
  });
});
