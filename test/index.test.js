import { describe, it, expect } from 'vitest';
import { summarize } from '../src/index.js';

describe('summarize', () => {
  it('returns the first sentence', () => {
    const text = 'First sentence. Second sentence.';
    expect(summarize(text)).toBe('First sentence.');
  });

  it('supports "?" and "!" as sentence boundaries', () => {
    expect(summarize('What? Next.')).toBe('What?');
    expect(summarize('Wow! Next.')).toBe('Wow!');
  });
});
