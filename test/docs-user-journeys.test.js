import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function readFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.readFile(absolutePath, 'utf8');
}

describe('docs user journeys future work audit', () => {
  it('does not describe shipped analytics activity as missing', async () => {
    const doc = await readFile('docs/user-journeys.md');
    expect(doc).not.toMatch(/lacked the subcommand/);
  });
});
