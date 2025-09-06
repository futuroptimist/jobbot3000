import { describe, it, expect } from 'vitest';
import { parseJobText } from '../src/parser.js';

describe('parseJobText', () => {
  it('extracts location from job text', () => {
    const text = 'Title: Engineer\nCompany: ACME Corp\nLocation: Remote\n';
    const parsed = parseJobText(text);
    expect(parsed.location).toBe('Remote');
  });
});
