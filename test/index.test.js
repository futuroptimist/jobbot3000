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

  it('does not split within ellipsis', () => {
    const text = 'Wait... still thinking. Another.';
    expect(summarize(text)).toBe('Wait... still thinking.');
  });
});
