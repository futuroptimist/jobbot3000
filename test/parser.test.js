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

  it('strips plus bullets when requirement follows header line', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements: + Basic JavaScript
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual(['Basic JavaScript']);
  });

  it('parses requirements after a Responsibilities header', () => {
    const text = `
Title: Developer
Company: Example Corp
Responsibilities:
- Build features
- Fix bugs
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual(['Build features', 'Fix bugs']);
  });

  it('prefers Requirements section when Responsibilities appears first', () => {
    const text = `
Title: Developer
Company: Example Corp
Responsibilities:
- Build features
Requirements:
- Must do things
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual(['Must do things']);
  });

  it('captures requirement text on header line and strips other bullet types', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements: Proficient in JS
* Basic JavaScript
• Experience with Node.js
+ Familiarity with testing
+ Keen eye for detail
+ Excellent communication
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      'Proficient in JS',
      'Basic JavaScript',
      'Experience with Node.js',
      'Familiarity with testing',
      'Keen eye for detail',
      'Excellent communication'
    ]);
  });
});
