import fs from 'node:fs/promises';
import path from 'node:path';
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
 * @param {{ withMetadata?: boolean }} [options]
 * @returns {Promise<string | { text: string, metadata: {
 *   extension: string,
 *   format: 'pdf' | 'markdown' | 'text',
 *   bytes: number,
 *   characters: number,
 *   lineCount: number,
 *   wordCount: number,
 * } }>}
 */
function detectFormat(extension) {
  if (MARKDOWN_EXTENSIONS.includes(extension)) return 'markdown';
  if (extension === '.pdf') return 'pdf';
  return 'text';
}

function countWords(text) {
  if (!text) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

export async function loadResume(filePath, options = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const loader = LOADERS[extension];
  let text;
  if (loader) text = await loader(filePath);
  else {
    const raw = await fs.readFile(filePath, 'utf-8');
    text = raw.trim();
  }

  if (!options.withMetadata) {
    return text;
  }

  const stats = await fs.stat(filePath);
  const metadata = {
    extension: extension || '',
    format: detectFormat(extension),
    bytes: stats.size,
    characters: text.length,
    lineCount: countLines(text),
    wordCount: countWords(text),
  };

  return { text, metadata };
}


