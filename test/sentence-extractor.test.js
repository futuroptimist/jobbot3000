import { describe, it, expect } from 'vitest';
import { SentenceExtractor } from '../src/sentence-extractor.js';

describe('SentenceExtractor', () => {
  it('yields sentences sequentially and returns trailing text', () => {
    const text = 'First sentence. "Second" continues? Third without terminator';
    const extractor = new SentenceExtractor(text);

    expect(extractor.next()).toBe('First sentence.');
    expect(extractor.next()).toBe('"Second" continues?');
    expect(extractor.next()).toBe('Third without terminator');
    expect(extractor.next()).toBe(null);
  });

  it('resets iteration and can accept replacement text', () => {
    const extractor = new SentenceExtractor('Only one.');

    expect(extractor.next()).toBe('Only one.');
    expect(extractor.next()).toBe(null);

    extractor.reset();
    expect(extractor.next()).toBe('Only one.');

    extractor.reset('New! Value stays? Another.');
    expect(extractor.next()).toBe('New!');
    expect(extractor.next()).toBe('Value stays?');
    expect(extractor.next()).toBe('Another.');
    expect(extractor.next()).toBe(null);
  });

  it('ignores decimal points inside numbers', () => {
    const extractor = new SentenceExtractor('Cost is 1.99 today. Tomorrow drops to 1.49.');

    expect(extractor.next()).toBe('Cost is 1.99 today.');
    expect(extractor.next()).toBe('Tomorrow drops to 1.49.');
    expect(extractor.next()).toBe(null);
  });
});
