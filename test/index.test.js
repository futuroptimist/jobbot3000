import { describe, it, expect } from 'vitest';
import { summarize } from '../src/index.js';

describe('summarize', () => {
  it('returns the first sentence', () => {
    const text = 'First sentence. Second sentence.';
    expect(summarize(text)).toBe('First sentence.');
  });

  it('supports question and exclamation marks', () => {
    expect(summarize('First sentence? Second sentence.')).toBe('First sentence?');
    expect(summarize('Wow! Another sentence.')).toBe('Wow!');
  });

  it('returns the first N sentences when count provided', () => {
    const text = 'First. Second. Third.';
    expect(summarize(text, 2)).toBe('First. Second.');
  });

  it('handles Windows newlines', () => {
    const text = 'First sentence\r\nSecond sentence\r\nThird sentence';
    expect(summarize(text, 2)).toBe('First sentence Second sentence');
  });

  it('ignores bare newlines without punctuation', () => {
    const text = 'First line\nSecond line.';
    expect(summarize(text)).toBe('First line Second line.');
  });
});
