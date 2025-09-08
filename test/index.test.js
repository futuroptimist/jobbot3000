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

  it('handles punctuation before closing quotes or parentheses', () => {
    const text = 'He said "Hi!" She left.';
    expect(summarize(text)).toBe('He said "Hi!"');
    const text2 = 'Do it now.) Another.';
    expect(summarize(text2)).toBe('Do it now.)');
  });

  it('returns the first N sentences when count provided', () => {
    const text = 'First. Second. Third.';
    expect(summarize(text, 2)).toBe('First. Second.');
  });

  it('ignores bare newlines without punctuation', () => {
    const text = 'First line\nSecond line.';
    expect(summarize(text)).toBe('First line Second line.');
  });

  it('returns the whole text when no terminator is present', () => {
    const text = 'No punctuation here';
    expect(summarize(text)).toBe(text);
  });

  it('returns trimmed text when no punctuation exists but newlines are present', () => {
    const text = 'Bullet one\nBullet two';
    expect(summarize(text)).toBe('Bullet one Bullet two');
  });

  it('handles punctuation followed by closing quotes', () => {
    const text = '"Wow!" Another sentence.';
    expect(summarize(text)).toBe('"Wow!"');
  });

  it('handles non-breaking spaces after punctuation', () => {
    const text = `One.\u00a0Two.`;
    expect(summarize(text)).toBe('One.');
  });
});
