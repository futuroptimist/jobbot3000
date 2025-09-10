import { describe, it, expect } from 'vitest';
import { toJson, toMarkdownSummary, toMarkdownMatch } from '../src/exporters.js';

describe('exporters', () => {
  it('converts data to pretty JSON', () => {
    const json = toJson({ a: 1 });
    expect(json).toBe('{\n  "a": 1\n}');
  });

  it('builds markdown summary with optional sections', () => {
    const md = toMarkdownSummary({
      title: 'Developer',
      company: 'ACME',
      summary: 'Great job',
      requirements: ['JS', 'Node']
    });
    const expected = [
      '# Developer',
      '**Company**: ACME',
      '',
      'Great job',
      '',
      '## Requirements',
      '- JS',
      '- Node'
    ].join('\n');
    expect(md).toBe(expected);
  });

  it('builds markdown match report', () => {
    const md = toMarkdownMatch({
      title: 'Engineer',
      company: 'ACME',
      score: 50,
      matched: ['JS'],
      missing: ['Python']
    });
    const expected = [
      '# Engineer',
      '**Company**: ACME',
      '**Fit Score**: 50%',
      '',
      '## Matched',
      '- JS',
      '',
      '## Missing',
      '- Python'
    ].join('\n');
    expect(md).toBe(expected);
  });

  it('omits sections when data is missing', () => {
    expect(toMarkdownSummary({})).toBe('');
    expect(toMarkdownMatch({})).toBe('');
  });
});
