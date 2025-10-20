import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  toJson,
  toMarkdownSummary,
  toMarkdownMatch,
  formatMatchExplanation,
  toMarkdownMatchExplanation,
  toDocxSummary,
  toDocxMatch,
} from '../src/exporters.js';

describe('exporters', () => {
  it('converts objects to pretty JSON', () => {
    const result = toJson({ a: 1 });
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it('returns null string for undefined input', () => {
    const result = toJson(undefined);
    expect(result).toBe('null');
  });

  it('redacts sensitive fields in JSON output', () => {
    const result = toJson({ email: 'alice@example.com', token: 'secret-123' });
    expect(result).toContain('al***@example.com');
    expect(result).not.toContain('secret-123');
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

  it('redacts secrets and emails in markdown exports', () => {
    const output = toMarkdownSummary({
      title: 'Dev',
      company: 'Acme',
      summary: 'Email alice@example.com with api_key=super-secret',
      requirements: ['Contact bob@example.com', 'token=abcd-1234'],
    });

    expect(output).not.toContain('alice@example.com');
    expect(output).toContain('al\\*\\*\\*@example.com');
    expect(output).toContain('api\\_key=\\*\\*\\*redacted\\*\\*\\*');
    expect(output).not.toContain('abcd-1234');
    expect(output).toContain('bo\\*\\*\\*@example.com');
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

  it('summarizes match explanations with top hits, gaps, and blockers', () => {
    const text = formatMatchExplanation({
      matched: ['JavaScript expertise', 'Mentored seniors'],
      missing: ['Must have public cloud expertise'],
      score: 67,
    });
    expect(text).toContain('Matched 2 of 3 requirements (67%)');
    expect(text).toContain('Hits: JavaScript expertise; Mentored seniors');
    expect(text).toContain('Gaps: Must have public cloud expertise');
    expect(text).toContain('Blockers: Must have public cloud expertise');
  });

  it('falls back when no hits or gaps are present', () => {
    const text = formatMatchExplanation({ matched: [], missing: [] });
    expect(text).toContain('Matched 0 of 0 requirements (0%)');
    expect(text).toContain('No direct hits from the resume.');
    expect(text).toContain('No missing requirements detected.');
    expect(text).toContain('No blockers flagged.');
  });

  it('localizes blocker labels in French explanations', () => {
    const blockers = formatMatchExplanation({
      matched: [],
      missing: ['Security clearance required'],
      locale: 'fr',
    });
    expect(blockers).toContain('Blocages: Security clearance required');

    const fallback = formatMatchExplanation({ matched: [], missing: [], locale: 'fr' });
    expect(fallback).toContain('Aucun blocage signalé.');
  });

  it('surfaces blockers based on must-have keywords', () => {
    const text = formatMatchExplanation({
      matched: [],
      missing: [
        'Security clearance required',
        'AWS certification preferred',
        'Strong communication skills',
      ],
    });
    const blockersLine =
      'Blockers: Security clearance required; AWS certification preferred';
    const gapsLine =
      'Gaps: Security clearance required; AWS certification preferred; Strong communication skills';
    expect(text).toContain(blockersLine);
    expect(text).toContain(gapsLine);
  });

  it('treats location, salary, and seniority requirements as blockers', () => {
    const text = formatMatchExplanation({
      matched: [],
      missing: [
        'Position is onsite in Austin, TX (no remote option)',
        'Base salary range: $150k - $180k plus bonus',
        'Senior-level engineering leadership required',
      ],
    });

    const blockersLine = text
      .split('\n')
      .find(line => line.startsWith('Blockers:'));
    expect(blockersLine).toBeDefined();
    expect(blockersLine).toContain('Position is onsite in Austin, TX (no remote option)');
    expect(blockersLine).toContain('Base salary range: $150k - $180k plus bonus');
    expect(blockersLine).toContain('Senior-level engineering leadership required');

    const gapsLine = text.split('\n').find(line => line.startsWith('Gaps:'));
    expect(gapsLine).toContain('Position is onsite in Austin, TX (no remote option)');
    expect(gapsLine).toContain('Base salary range: $150k - $180k plus bonus');
    expect(gapsLine).toContain('Senior-level engineering leadership required');
  });

  it('renders markdown explanation with escaped content', () => {
    const md = toMarkdownMatchExplanation({
      matched: ['Node.js (services)'],
      missing: ['Go & Rust'],
      score: 50,
    });
    expect(md).toContain('## Explanation');
    expect(md).toContain('Matched 1 of 2 requirements \\(50%\\)');
    expect(md).toContain('Hits: Node.js \\(services\\)');
    expect(md).toContain('Gaps: Go & Rust');
    expect(md).toContain('No blockers flagged.');
  });

  it('generates DOCX summaries with localized labels', async () => {
    const buffer = await toDocxSummary({
      title: 'Dev',
      company: 'Acme',
      location: 'Remoto',
      summary: 'Construir cosas',
      requirements: ['JS'],
      locale: 'es',
    });
    expect(buffer instanceof Uint8Array || Buffer.isBuffer(buffer)).toBe(true);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Dev');
    expect(xml).toContain('Empresa');
    expect(xml).toContain('Requisitos');
  });

  it('generates DOCX match reports with scores and bullets', async () => {
    const buffer = await toDocxMatch({
      title: 'Dev',
      company: 'Acme',
      score: 82,
      matched: ['JS'],
      missing: ['Rust'],
      locale: 'fr',
    });
    expect(buffer instanceof Uint8Array || Buffer.isBuffer(buffer)).toBe(true);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Dev');
    expect(xml).toContain('Score d&apos;adéquation');
    expect(xml).toContain('Correspondances');
    expect(xml).toContain('Manquants');
  });

  it('includes blockers when DOCX match reports detect mandatory gaps', async () => {
    const buffer = await toDocxMatch({
      title: 'Security Engineer',
      missing: [
        'Must have active security clearance',
        'Experience with Terraform automation',
      ],
      locale: 'en',
    });

    expect(buffer instanceof Uint8Array || Buffer.isBuffer(buffer)).toBe(true);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');

    expect(xml).toContain('Blockers');
    const occurrences = (xml.match(/Must have active security clearance/g) || []).length;
    expect(occurrences).toBeGreaterThan(1);
  });

  it('redacts sensitive values in DOCX exports', async () => {
    const buffer = await toDocxSummary({
      title: 'Platform Engineer',
      company: 'Acme',
      summary: 'Reach out via alice@example.com and include token=abcd-1234',
      requirements: ['api_key=super-secret', 'Contact bob@example.com'],
    });

    expect(buffer instanceof Uint8Array || Buffer.isBuffer(buffer)).toBe(true);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');

    expect(xml).not.toContain('alice@example.com');
    expect(xml).toContain('al***@example.com');
    expect(xml).not.toContain('abcd-1234');
    expect(xml).toContain('token=***redacted***');
    expect(xml).toContain('bo***@example.com');
  });
});
