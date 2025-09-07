import { describe, it, expect } from 'vitest';
import { parseJobText } from '../src/parser.js';

describe('parseJobText', () => {
  it('extracts requirements with dash bullets', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements:
– Experience with Node.js
— Familiarity with testing
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      'Experience with Node.js',
      'Familiarity with testing'
    ]);
  });
});
