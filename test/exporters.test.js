import { describe, it, expect } from 'vitest';
import { toJson, toMarkdownSummary, toMarkdownMatch } from '../src/exporters.js';

describe('exporters', () => {
  it('converts objects to pretty JSON', () => {
    const result = toJson({ a: 1 });
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it('formats markdown summaries', () => {
    const output = toMarkdownSummary({
      title: 'Dev',
      company: 'Acme',
      location: 'Remote',
      summary: 'Build things',
      requirements: ['JS', 'Node']
    });
    const expected = [
      '# Dev',
      '**Company**: Acme',
      '**Location**: Remote',
      '',
      'Build things',
      '',
      '## Requirements',
      '- JS',
      '- Node'
    ].join('\n');
    expect(output).toBe(expected);
  });

  it('formats markdown match reports with score', () => {
    const output = toMarkdownMatch({
      title: 'Dev',
      company: 'Acme',
      location: 'Remote',
      score: 85,
      matched: ['JS'],
      missing: ['Rust']
    });
    const expected = [
      '# Dev',
      '**Company**: Acme',
      '**Location**: Remote',
      '**Fit Score**: 85%',
      '',
      '## Matched',
      '- JS',
      '',
      '## Missing',
      '- Rust'
    ].join('\n');
    expect(output).toBe(expected);
  });
});
