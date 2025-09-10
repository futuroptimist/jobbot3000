import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadResume } from '../src/resume.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('loadResume', () => {
  it('loads and trims plain text resumes', async () => {
    const file = path.resolve(__dirname, 'fixtures', 'resume.txt');
    const text = await loadResume(file);
    expect(text).toBe('I am an engineer with JavaScript experience.');
  });

  it('strips markdown formatting for .md files', async () => {
    const file = path.resolve(__dirname, 'fixtures', 'resume.md');
    const text = await loadResume(file);
    expect(text).toBe('Jane Doe\nRole: Developer');
  });
});
