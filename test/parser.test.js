import { describe, it, expect } from 'vitest';
import { parseJobText } from '../src/parser.js';

describe('parseJobText', () => {
  it('strips dash, en dash, and em dash bullets', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements:
- Basic JavaScript
– Experience with Node.js
— Familiarity with testing
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      'Basic JavaScript',
      'Experience with Node.js',
      'Familiarity with testing'
    ]);
  });

  it('strips plus sign bullets', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements:
+ Keen eye for detail
+ Excellent communication
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      'Keen eye for detail',
      'Excellent communication'
    ]);
  });
});
