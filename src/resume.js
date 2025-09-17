import fs from 'fs/promises';
import path from 'path';
import removeMarkdown from 'remove-markdown';

/**
 * File-type specific loaders. Each handler reads and returns plain text content.
 * Handlers may perform additional parsing based on the extension.
 *
 * @type {Record<string, (filePath: string) => Promise<string>>}
 */
async function loadMarkdown(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return removeMarkdown(raw).trim();
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];

const LOADERS = {
  async '.pdf'(filePath) {
    const buffer = await fs.readFile(filePath);
    // Lazy import to reduce startup overhead and make optional
    const { default: pdf } = await import('pdf-parse');
    const data = await pdf(buffer);
    return (data.text || '').trim();
  },
};

for (const ext of MARKDOWN_EXTENSIONS) LOADERS[ext] = loadMarkdown;

/**
 * Load a resume file and return its plain text content.
 * Supports `.pdf`, `.md`, `.markdown`, and `.mdx` formats; other files are read as plain text.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function loadResume(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const loader = LOADERS[ext];
  if (loader) return loader(filePath);
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw.trim();
}


