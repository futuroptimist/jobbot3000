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

  it('includes url in markdown summaries', () => {
    const output = toMarkdownSummary({
      title: 'Dev',
      company: 'Acme',
      url: 'https://example.com/job',
      summary: 'Build things',
      requirements: ['JS']
    });
    expect(output).toBe(
      '# Dev\n**Company**: Acme\n**URL**: https://example.com/job\n\nBuild things\n' +
        '\n## Requirements\n- JS'
    );
  });

  it('adds blank line before requirements when summary missing', () => {
    const output = toMarkdownSummary({
      title: 'Dev',
      company: 'Acme',
      requirements: ['JS']
    });
    expect(output).toBe('# Dev\n**Company**: Acme\n\n## Requirements\n- JS');
  });

  it('omits requirements section when list is empty', () => {
    const output = toMarkdownSummary({ title: 'Dev', company: 'Acme', summary: 'Build' });
    expect(output).toBe('# Dev\n**Company**: Acme\n\nBuild\n');
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

  it('includes url in markdown match reports', () => {
    const output = toMarkdownMatch({
      title: 'Dev',
      url: 'https://example.com/job',
      matched: ['JS']
    });
    expect(output).toBe(
      '# Dev\n**URL**: https://example.com/job\n\n## Matched\n- JS'
    );
  });

  it('includes score 0 and skips empty sections', () => {
    const output = toMarkdownMatch({ title: 'Dev', score: 0 });
    expect(output).toBe('# Dev\n**Fit Score**: 0%');
  });
});
