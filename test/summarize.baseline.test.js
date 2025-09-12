import { describe, it, expect } from 'vitest';
import { summarizeBaseline } from '../src/summarize.baseline.js';

describe('summarizeBaseline', () => {
  it('returns first sentence by default and trims whitespace', () => {
    const text = ' First sentence.  Second sentence! Third?';
    expect(summarizeBaseline(text)).toBe('First sentence.');
  });

  it('limits output to requested number of sentences', () => {
    const text = 'One. Two. Three.';
    expect(summarizeBaseline(text, 2)).toBe('One. Two.');
  });

  it('returns empty string when text is falsy', () => {
    expect(summarizeBaseline('')).toBe('');
    // @ts-expect-error testing null input
    expect(summarizeBaseline(null)).toBe('');
    // @ts-expect-error testing undefined input
    expect(summarizeBaseline()).toBe('');
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
