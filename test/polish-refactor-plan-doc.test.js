import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function readDoc() {
  const docPath = path.join(repoRoot, 'docs', 'polish', 'refactor-plan.md');
  return fs.readFile(docPath, 'utf8');
}

describe('polish refactor plan documentation', () => {
  it('tracks the screenshot refresh implementation note', async () => {
    const contents = await readDoc();
    const screenshotNotePattern = new RegExp(
      'Capture refreshed screenshots after the UI adopts the new redaction and audit affordances.' +
        '\\s+_Implemented \\(2025-10-26\\):',
      's',
    );
    expect(contents).toMatch(screenshotNotePattern);
    expect(contents).toContain('scripts/generate-web-screenshots.js');
    expect(contents).toContain('test/polish-refactor-plan-doc.test.js');
  });
});
