import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

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

  it('strips markdown formatting for .markdown extension', async () => {
    const md = '# Title\n\n**bold** text\n';
    const result = await withTempFile('.markdown', md, loadResume);
    expect(result).toBe('Title\n\nbold text');
  });

  it('uses pdf-parse for PDF files', async () => {
    const result = await withTempFile('.pdf', 'dummy', loadResume);
    expect(result).toBe('PDF content');
  });
});
