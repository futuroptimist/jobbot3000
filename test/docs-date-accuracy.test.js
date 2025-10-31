import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const IMPLEMENTED_PATTERN = /_Implemented \((\d{4}-\d{2}-\d{2})\):/g;
const ALLOW_PATTERN = /<!--\s*allow-future-date:\s*(\d{4}-\d{2}-\d{2})\s*-->/g;

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectMarkdownFiles(entryPath);
      }

      if (entry.isFile() && entry.name.endsWith('.md')) {
        return [entryPath];
      }

      return [];
    }),
  );

  return files.flat();
}

function computeLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

describe('documentation metadata', () => {
  it('does not claim implementations from the future', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const docsDir = path.join(repoRoot, 'docs');
    const markdownFiles = await collectMarkdownFiles(docsDir);
    const violations = [];

    for (const filePath of markdownFiles) {
      const content = await fs.readFile(filePath, 'utf8');
      const allowList = new Set();
      let allowMatch;

      while ((allowMatch = ALLOW_PATTERN.exec(content)) !== null) {
        allowList.add(allowMatch[1]);
      }

      let match;
      while ((match = IMPLEMENTED_PATTERN.exec(content)) !== null) {
        const [, date] = match;

        if (allowList.has(date)) {
          continue;
        }

        if (date > today) {
          const line = computeLineNumber(content, match.index);
          const relativePath = path.relative(repoRoot, filePath);
          violations.push(`${relativePath}:${line} -> ${date}`);
        }
      }
    }

    expect(
      violations,
      `future implementation dates found: ${violations.join(', ')}`,
    ).toEqual([]);
  });
});
