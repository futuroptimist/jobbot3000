import { describe, it, expect } from 'vitest';
import { toJson, toMarkdownSummary, toMarkdownMatch } from '../src/exporters.js';

describe('exporters', () => {
  it('converts objects to pretty JSON', () => {
    const result = toJson({ a: 1 });
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it('returns null string for undefined input', () => {
    const result = toJson(undefined);
    expect(result).toBe('null');
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
      '## Summary',
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
      '# Dev\n**Company**: Acme\n**URL**: https://example.com/job\n\n## Summary\n\nBuild things\n' +
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
    expect(output).toBe('# Dev\n**Company**: Acme\n\n## Summary\n\nBuild\n');
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
      company: 'Acme',
      url: 'https://example.com/job',
      matched: ['JS'],
      missing: ['Rust'],
      score: 80,
    });
    expect(output).toBe(
      '# Dev\n**Company**: Acme\n**URL**: https://example.com/job\n**Fit Score**: 80%\n' +
        '\n## Matched\n- JS\n\n## Missing\n- Rust'
    );
  });

  it('includes score 0 and skips empty sections', () => {
    const output = toMarkdownMatch({ title: 'Dev', score: 0 });
    expect(output).toBe('# Dev\n**Fit Score**: 0%');
  });

  it('does not prepend blank lines when only match lists exist', () => {
    const output = toMarkdownMatch({ matched: ['JS'], missing: ['Rust'] });
    expect(output).toBe('## Matched\n- JS\n\n## Missing\n- Rust');
  });

  it('escapes markdown control characters to prevent injection in summaries', () => {
    const output = toMarkdownSummary({
      title: '[Lead](javascript:alert(1))',
      company: 'ACME [Corp](javascript:alert(2))',
      location: 'Remote > Anywhere',
      summary: 'Build [danger](javascript:alert(3))\n# Bonus',
      requirements: ['[Exploit](javascript:alert(4))', 'Hands-on with CI/CD'],
    });
    expect(output).toBe(
      '# \\[Lead\\]\\(javascript:alert\\(1\\)\\)\n' +
        '**Company**: ACME \\[Corp\\]\\(javascript:alert\\(2\\)\\)\n' +
        '**Location**: Remote \\> Anywhere\n\n' +
        '## Summary\n\n' +
        'Build \\[danger\\]\\(javascript:alert\\(3\\)\\)\n\\# Bonus\n\n' +
        '## Requirements\n' +
        '- \\[Exploit\\]\\(javascript:alert\\(4\\)\\)\n' +
        '- Hands\\-on with CI/CD'
    );
  });

  it('escapes markdown control characters to prevent injection in match reports', () => {
    const output = toMarkdownMatch({
      title: 'Engineer [Sr](javascript:alert(1))',
      url: '[https://evil](javascript:alert(2))',
      matched: ['[JS](javascript:alert(3))'],
      missing: ['#Urgent'],
      score: 42,
    });
    expect(output).toBe(
      '# Engineer \\[Sr\\]\\(javascript:alert\\(1\\)\\)\n' +
        '**URL**: \\[https://evil\\]\\(javascript:alert\\(2\\)\\)\n' +
        '**Fit Score**: 42%\n\n' +
        '## Matched\n- \\[JS\\]\\(javascript:alert\\(3\\)\\)\n\n' +
        '## Missing\n- \\#Urgent'
    );
  });

  it('supports spanish locale in markdown summaries', () => {
    const output = toMarkdownSummary({
      title: 'Dev',
      company: 'Acme',
      location: 'Remoto',
      summary: 'Construir cosas',
      requirements: ['JS'],
      locale: 'es',
    });
    const expected = [
      '# Dev',
      '**Empresa**: Acme',
      '**Ubicación**: Remoto',
      '',
      '## Resumen',
      '',
      'Construir cosas',
      '',
      '## Requisitos',
      '- JS',
    ].join('\n');
    expect(output).toBe(expected);
  });

  it('supports spanish locale in markdown match reports', () => {
    const output = toMarkdownMatch({
      title: 'Dev',
      company: 'Acme',
      location: 'Remoto',
      score: 85,
      matched: ['JS'],
      missing: ['Rust'],
      locale: 'es',
    });
    const expected = [
      '# Dev',
      '**Empresa**: Acme',
      '**Ubicación**: Remoto',
      '**Puntaje de Ajuste**: 85%',
      '',
      '## Coincidencias',
      '- JS',
      '',
      '## Faltantes',
      '- Rust',
    ].join('\n');
    expect(output).toBe(expected);
  });
});
