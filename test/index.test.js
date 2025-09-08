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

  it('returns trimmed text when no punctuation exists', () => {
    const text = 'Bullet one\nBullet two';
    expect(summarize(text)).toBe('Bullet one Bullet two');
  });

  it('preserves leftover text when a sentence lacks punctuation', () => {
    const text = 'First. Second without end';
    expect(summarize(text, 2)).toBe('First. Second without end');
  });

  it('handles punctuation followed by closing quotes', () => {
    const text = '"Wow!" Another sentence.';
    expect(summarize(text)).toBe('"Wow!"');
  });

  it('treats non-breaking space as whitespace', () => {
    const text = 'One sentence.\u00A0Another.';
    expect(summarize(text)).toBe('One sentence.');
  });

  it('avoids splitting inside parenthetical abbreviations', () => {
    const text = 'Candidates (M.Sc.) should apply.';
    expect(summarize(text)).toBe('Candidates (M.Sc.) should apply.');
  });
});
