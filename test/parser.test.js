import { describe, it, expect } from 'vitest';
import { parseJobText } from '../src/parser.js';

describe('parseJobText', () => {
  it('returns empty fields for missing input', () => {
    expect(parseJobText(undefined)).toEqual({
      title: '',
      company: '',
      location: '',
      requirements: [],
      body: ''
    });
  });

  it('extracts location when present', () => {
    const text = `
Title: Developer
Company: Example Corp
Location: Remote, USA
Requirements:
- Node.js
`;
    expect(parseJobText(text)).toMatchObject({ location: 'Remote, USA' });
  });

  it('extracts location when header uses whitespace separator', () => {
    const text = `
Title: Developer
Company: Example Corp
Location Remote, USA
Requirements:
- Node.js
`;
    expect(parseJobText(text)).toMatchObject({ location: 'Remote, USA' });
  });

  it('ignores section headings that resemble company fields', () => {
    const text = `Company Overview\nCompany: Example Corp`;
    expect(parseJobText(text)).toMatchObject({ company: 'Example Corp' });
  });

  it('skips location headings without values', () => {
    const text = `
Location Details
Location: Remote
`;
    expect(parseJobText(text)).toMatchObject({ location: 'Remote' });
  });

  it('prefers earlier lines over pattern order', () => {
    const text = `
Position: Junior Dev
Job Title: Senior Dev
`;
    const parsed = parseJobText(text);
    expect(parsed.title).toBe('Junior Dev');
  });

  it('extracts title from alternate headers', () => {
    [
      ['Job Title', 'Engineer'],
      ['Position', 'Developer'],
      ['Role', 'Programmer']
    ].forEach(([header, role]) => {
      const text = `${header}: ${role}\nCompany: Example`;
      expect(parseJobText(text)).toMatchObject({ title: role });
    });
  });

  it('extracts fields when headers use dash separators', () => {
    const text = `
Role - Staff Engineer
Company — Example Inc
Location – Remote
Requirements:
- Build things
`;
    const parsed = parseJobText(text);
    expect(parsed.title).toBe('Staff Engineer');
    expect(parsed.company).toBe('Example Inc');
    expect(parsed.location).toBe('Remote');
    expect(parsed.requirements).toEqual(['Build things']);
  });

  it('extracts company from Employer header', () => {
    const text = `Title: Engineer\nEmployer: ACME Corp`;
    expect(parseJobText(text)).toMatchObject({ company: 'ACME Corp' });
  });

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

  it('parses requirements after a "What you’ll need" header', () => {
    const text = `
Title: Developer
Company: Example Corp
What you’ll need:
- JavaScript
- Testing
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual(['JavaScript', 'Testing']);
  });

  it('captures inline requirement text after a Responsibilities header', () => {
    const text = `
Title: Developer
Company: Example Corp
Responsibilities: Build features
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

  it('stops capturing requirements at the next section header', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements:
- Build features
Benefits:
- Health insurance
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual(['Build features']);
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
 · Works well in teams
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      'Proficient in JS',
      'Basic JavaScript',
      'Experience with Node.js',
      'Familiarity with testing',
      'Keen eye for detail',
      'Excellent communication',
      'Works well in teams'
    ]);
  });

  it('strips numeric and parenthetical bullets', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements:
1. First skill
2) Second skill
(3) Third skill
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      'First skill',
      'Second skill',
      'Third skill'
    ]);
  });

  it('strips alphabetical bullets', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements:
a. First skill
b) Second skill
(c) Third skill
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      'First skill',
      'Second skill',
      'Third skill'
    ]);
  });

  it('uses the first Responsibilities section when multiple appear', () => {
    const text = `
Title: Developer
Company: Example Corp
Responsibilities:
- First thing
Responsibilities:
- Second thing
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual(['First thing']);
  });

  it('preserves leading numbers when not used as bullets', () => {
    const text = `
Title: Developer
Company: Example Corp
Requirements:
- 3D modeling experience
2024 vision for growth
123abc starts with digits
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([
      '3D modeling experience',
      '2024 vision for growth',
      '123abc starts with digits'
    ]);
  });

  it('returns no requirements when header is absent', () => {
    const text = `
Title: Developer
Company: Example Corp
Just some description without requirement section.
`;
    const parsed = parseJobText(text);
    expect(parsed.requirements).toEqual([]);
  });
});
