import fs from 'fs/promises';
import path from 'path';
import removeMarkdown from 'remove-markdown';

export async function loadResume(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const buffer = await fs.readFile(filePath);
    // Lazy import to reduce startup overhead and make optional
    const { default: pdf } = await import('pdf-parse');
    const data = await pdf(buffer);
    return (data.text || '').trim();
  }
  const raw = await fs.readFile(filePath, 'utf-8');
  if (ext === '.md' || ext === '.markdown') {
    return removeMarkdown(raw).trim();
  }
  return raw.trim();
}


