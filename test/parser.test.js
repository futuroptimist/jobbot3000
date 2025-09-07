import { describe, it, expect } from 'vitest';
import { parseJobText } from '../src/parser.js';

describe('parseJobText', () => {
  it('strips en and em dash bullets', () => {
    const raw = 'Title: Dev\nCompany: ACME\nRequirements\n– Node.js\n— React';
    const { requirements } = parseJobText(raw);
    expect(requirements).toEqual(['Node.js', 'React']);
  });
});
