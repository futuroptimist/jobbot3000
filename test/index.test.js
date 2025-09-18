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

  it('returns empty string when count is 0', () => {
    const text = 'First. Second.';
    expect(summarize(text, 0)).toBe('');
  });

  it('returns empty string when count is negative', () => {
    expect(summarize('First.', -1)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(summarize('', 2)).toBe('');
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

  it('preserves consecutive terminal punctuation', () => {
    const text = 'What?! Another.';
    expect(summarize(text)).toBe('What?!');
  });

  it('splits sentences even when the next one starts lowercase', () => {
    const text = 'First sentence. second sentence continues.';
    expect(summarize(text)).toBe('First sentence.');
  });

  it('does not split on multi-level lowercase domains', () => {
    const text = 'Visit careers.acme.co/jobs now. More info tomorrow.';
    expect(summarize(text, 2)).toBe('Visit careers.acme.co/jobs now. More info tomorrow.');
  });

  it('preserves emails with lowercase subdomains', () => {
    const text = 'Contact dev@sub.example.co. Let\'s chat soon.';
    expect(summarize(text)).toBe('Contact dev@sub.example.co.');
  });

  it('does not split on decimal numbers', () => {
    const text = 'The price is $1.99 today but it may change.';
    expect(summarize(text)).toBe(text);
  });

  it('returns the whole text when no terminator is present', () => {
    const text = 'No punctuation here';
    expect(summarize(text)).toBe(text);
  });

  it('handles punctuation followed by closing quotes', () => {
    const text = '"Wow!" Another sentence.';
    expect(summarize(text)).toBe('"Wow!"');
  });

  it('recognizes unicode ellipsis as terminator', () => {
    const text = 'Wait… Next sentence.';
    expect(summarize(text)).toBe('Wait…');
  });

  it('does not split after common abbreviations', () => {
    const text = 'Mr. Smith went home. Another.';
    expect(summarize(text)).toBe('Mr. Smith went home.');
  });

  it('treats non-breaking space as whitespace', () => {
    const text = 'One sentence.\u00A0Another.';
    expect(summarize(text)).toBe('One sentence.');
  });

  it('avoids splitting inside parenthetical abbreviations', () => {
    const text = 'Candidates (M.Sc.) should apply.';
    expect(summarize(text)).toBe('Candidates (M.Sc.) should apply.');
  });

  it('does not split when terminator inside unclosed quotes', () => {
    const text = 'He said "Wait.';
    expect(summarize(text)).toBe(text);
  });

  it('does not split when terminator inside unclosed parentheses', () => {
    const text = 'Alert (check logs.';
    expect(summarize(text)).toBe(text);
  });
});
