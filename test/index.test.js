import { describe, it, expect } from 'vitest';
import { summarize } from '../src/index.js';

describe('summarize', () => {
  it('returns the first sentence', () => {
    const text = 'First sentence. Second sentence.';
    expect(summarize(text)).toBe('First sentence.');
  });

  it('handles exclamation and question marks', () => {
    const text = 'Wow! Is this working? Indeed.';
    expect(summarize(text)).toBe('Wow!');
  });
});
