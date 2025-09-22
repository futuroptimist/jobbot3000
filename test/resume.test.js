import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('pdf-parse', () => ({
  default: vi.fn(async () => ({ text: ' PDF content ' }))
}));

import { loadResume } from '../src/resume.js';

async function withTempFile(ext, content, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-test-'));
  const file = path.join(dir, `temp${ext}`);
  await fs.writeFile(file, content);
  try {
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('loadResume', () => {
  it('trims plain text files', async () => {
    const result = await withTempFile('.txt', '  hello world  ', loadResume);
    expect(result).toBe('hello world');
  });

  it('strips markdown formatting', async () => {
    const md = '# Title\n\n**bold** text\n';
    const result = await withTempFile('.md', md, loadResume);
    expect(result).toBe('Title\n\nbold text');
  });

  it('strips markdown formatting for .markdown files', async () => {
    const md = '# Title\n\n**bold** text\n';
    const result = await withTempFile('.markdown', md, loadResume);
    expect(result).toBe('Title\n\nbold text');
  });

  it('strips markdown formatting for .mdx files', async () => {
    const md = '# Title\n\n**bold** text\n';
    const result = await withTempFile('.mdx', md, loadResume);
    expect(result).toBe('Title\n\nbold text');
  });

  it('handles .markdown extension case-insensitively', async () => {
    const md = '# Heading\n\n*italic* text';
    const result = await withTempFile('.MARKDOWN', md, loadResume);
    expect(result).toBe('Heading\n\nitalic text');
  });

  it('uses pdf-parse for PDF files', async () => {
    const result = await withTempFile('.pdf', 'dummy', loadResume);
    expect(result).toBe('PDF content');
  });

  it('handles uppercase PDF extension', async () => {
    const result = await withTempFile('.PDF', 'dummy', loadResume);
    expect(result).toBe('PDF content');
  });

  it('returns text and metadata when requested', async () => {
    const content = '# Title\n\n**bold** text\n';
    const result = await withTempFile('.md', content, file =>
      loadResume(file, { withMetadata: true })
    );

    expect(result).toEqual({
      text: 'Title\n\nbold text',
      metadata: expect.objectContaining({
        extension: '.md',
        format: 'markdown',
        bytes: Buffer.byteLength(content),
        characters: 16,
        lineCount: 3,
        wordCount: 3,
      }),
    });
  });

  it('flags ATS warning signals when tables or images are present', async () => {
    const content = [
      '# Title',
      '',
      '| Skill | Years |',
      '| ----- | ----- |',
      '| JS    | 10    |',
      '',
      '![Diagram](diagram.png)',
    ].join('\n');

    const result = await withTempFile('.md', content, file =>
      loadResume(file, { withMetadata: true })
    );

    expect(result.metadata.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tables',
          message: expect.stringContaining('table'),
        }),
        expect.objectContaining({
          type: 'images',
          message: expect.stringContaining('image'),
        }),
      ])
    );
  });

  it('annotates metadata with ambiguities, placeholders, and confidence heuristics', async () => {
    const content = [
      '## Experience',
      'Senior Developer at Acme Corp',
      '- Increased revenue by XX% year over year while leading a distributed team ' +
        'of seven engineers.',
      '- Shipped analytics dashboards adopted by 12 partner teams across the organization.',
      '',
      '## Education',
      'Your Title Here',
      'Bachelor of Science — Jan 20XX - Present',
      '',
      '# Summary',
      'Jan - Present',
      'Leading strategic initiatives across teams.',
      '',
      '| Skill | Level |',
      '| ----- | ----- |',
      '| Collaboration | High |',
      '',
      '![Workflow](workflow.png)',
    ].join('\n');

    const result = await withTempFile('.md', content, file =>
      loadResume(file, { withMetadata: true })
    );

    expect(result.metadata.confidence).toMatchObject({
      score: expect.any(Number),
      signals: expect.arrayContaining([
        expect.stringContaining('resume heading'),
        expect.stringContaining('bullet'),
      ]),
    });
    expect(result.metadata.confidence.score).toBeGreaterThanOrEqual(0.4);
    expect(result.metadata.confidence.score).toBeLessThanOrEqual(1);

    expect(result.metadata.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'metric',
          value: 'XX%',
          location: expect.objectContaining({
            line: expect.any(Number),
            column: expect.any(Number),
          }),
        }),
        expect.objectContaining({
          type: 'date',
          value: '20XX',
          location: expect.objectContaining({
            line: expect.any(Number),
            column: expect.any(Number),
          }),
        }),
        expect.objectContaining({
          type: 'title',
          value: 'Your Title Here',
          location: expect.objectContaining({
            line: expect.any(Number),
            column: expect.any(Number),
          }),
        }),
        expect.objectContaining({ type: 'dates' }),
        expect.objectContaining({ type: 'metrics' }),
        expect.objectContaining({ type: 'titles' }),
      ])
    );
  });

  it('retains duplicate placeholder values and preserves document order', async () => {
    const content = [
      'Experience',
      'Started Jan 20XX on project Phoenix',
      'Wrapped Feb 20XX after migration',
      'Your Title Here placeholder',
      'Another Your Title Here entry',
    ].join('\n');

    const result = await withTempFile('.txt', content, file =>
      loadResume(file, { withMetadata: true })
    );

    const reported = result.metadata.ambiguities.map(item => ({
      type: item.type,
      value: item.value,
      line: item.location.line,
    }));

    expect(reported).toEqual([
      { type: 'date', value: '20XX', line: 2 },
      { type: 'date', value: '20XX', line: 3 },
      { type: 'title', value: 'Your Title Here', line: 4 },
      { type: 'title', value: 'Your Title Here', line: 5 },
    ]);
  });
});
