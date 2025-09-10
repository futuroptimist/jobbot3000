import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadResume } from '../src/resume.js';

const pdfParseMock = vi.fn(async () => ({ text: 'PDF body' }));
vi.mock('pdf-parse', () => ({ default: pdfParseMock }));

describe('loadResume', () => {
  it('trims whitespace in plain text resumes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-'));
    const file = path.join(dir, 'plain.txt');
    await fs.writeFile(file, '  text  \n\n');
    const text = await loadResume(file);
    expect(text).toBe('text');
  });

  it('strips markdown from .md resumes', async () => {
    const file = path.resolve('test', 'fixtures', 'resume.md');
    const text = await loadResume(file);
    expect(text).toBe('John Doe\n\nSkills\nJavaScript');
    expect(text).not.toMatch(/[*#-]/);
  });

  it('parses PDF resumes via pdf-parse', async () => {
    const file = path.resolve('test', 'fixtures', 'resume.pdf');
    const text = await loadResume(file);
    expect(text).toBe('PDF body');
    expect(pdfParseMock).toHaveBeenCalledTimes(1);
  });
});
