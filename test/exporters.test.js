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
      summary: 'Build things',
      requirements: ['JS', 'Node']
    });
    expect(output).toBe(
      '# Dev\n**Company**: Acme\n\nBuild things\n\n## Requirements\n- JS\n- Node'
    );
  });

  it('formats markdown match reports with score', () => {
    const output = toMarkdownMatch({
      title: 'Dev',
      company: 'Acme',
      score: 85,
      matched: ['JS'],
      missing: ['Rust']
    });
    expect(output).toBe(
      '# Dev\n**Company**: Acme\n**Fit Score**: 85%\n\n## Matched\n- JS\n\n## Missing\n- Rust'
    );
  });
});
