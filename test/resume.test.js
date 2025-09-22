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

  it('annotates parsing confidence and highlights ambiguous placeholders', async () => {
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
    expect(result.metadata.confidence.score).toBeGreaterThanOrEqual(0.5);
    expect(result.metadata.confidence.score).toBeLessThanOrEqual(1);

    expect(result.metadata.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'metric', value: 'XX%' }),
        expect.objectContaining({ type: 'date', value: '20XX' }),
        expect.objectContaining({ type: 'title', value: 'Your Title Here' }),
      ])
    );
  });

  it('detects ambiguities consistently across repeated loads', async () => {
    const content = [
      'Your Title Here',
      'Led projects that delivered XX% efficiency gains by 20XX.',
    ].join('\n');

    await withTempFile('.txt', content, async file => {
      const first = await loadResume(file, { withMetadata: true });
      const second = await loadResume(file, { withMetadata: true });

      expect(first.metadata.ambiguities).toEqual(second.metadata.ambiguities);
    });
  });
});
