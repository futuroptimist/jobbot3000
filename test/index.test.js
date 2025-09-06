import { describe, it, expect } from 'vitest';
import { summarize } from '../src/index.js';

describe('summarize', () => {
  it('returns the first sentence', () => {
    const text = 'First sentence. Second sentence.';
    expect(summarize(text)).toBe('First sentence.');
  });

  it('handles exclamation and question marks', () => {
    const text = 'First sentence! Second sentence? Third sentence.';
    expect(summarize(text)).toBe('First sentence!');
  });
});
