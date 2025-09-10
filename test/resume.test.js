import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadResume } from '../src/resume.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('loadResume', () => {
  it('loads plain text resumes', async () => {
    const p = path.join(__dirname, 'fixtures', 'resume.txt');
    const text = await loadResume(p);
    expect(text).toBe('I am an engineer with JavaScript experience.');
  });

  it('strips markdown formatting', async () => {
    const p = path.join(__dirname, 'fixtures', 'resume.md');
    const text = await loadResume(p);
    expect(text).toBe('Summary\n\nI am strong with JavaScript.');
  });
});
