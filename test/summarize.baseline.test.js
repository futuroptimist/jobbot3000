import { describe, it, expect } from 'vitest';
import { summarizeBaseline } from '../src/summarize.baseline.js';

describe('summarizeBaseline', () => {
  it('returns the first sentence and collapses whitespace', () => {
    const text = 'First   line.\nSecond line.';
    expect(summarizeBaseline(text)).toBe('First line.');
  });

  it('returns the first N sentences', () => {
    const text = 'First. Second. Third.';
    expect(summarizeBaseline(text, 2)).toBe('First. Second.');
  });

  it('handles unicode ellipsis', () => {
    const text = 'Wait… Next sentence.';
    expect(summarizeBaseline(text)).toBe('Wait…');
  });

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

  it('returns the first sentence by default', () => {
    const text = 'First sentence. Second sentence.';
    expect(summarizeBaseline(text)).toBe('First sentence.');
  });

  it('returns the first N sentences and normalizes whitespace', () => {
    const text = 'First.  Second.\nThird.';
    expect(summarizeBaseline(text, 2)).toBe('First. Second.');
  });

  it('returns first sentence and collapses whitespace', () => {
    const text = 'First sentence.   \nSecond sentence.';
    expect(summarizeBaseline(text)).toBe('First sentence.');
  });

  it('returns trimmed text when no sentence terminator exists', () => {
    const text = '  No punctuation here  ';
    expect(summarizeBaseline(text, 3)).toBe('No punctuation here');
  });
});
