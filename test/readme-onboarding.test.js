import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('README onboarding checklist', () => {
  it('documents an onboarding checklist referencing the architecture map', async () => {
    const readmePath = resolve('README.md');
    const contents = await readFile(readmePath, 'utf8');
    const lines = contents.split(/\r?\n/);
    const headingIndex = lines.findIndex(line => {
      return line.trim().toLowerCase() === '## onboarding checklist';
    });
    expect(headingIndex).toBeGreaterThan(-1);

    const remainingLines = lines.slice(headingIndex + 1);
    const nextHeadingIndex = remainingLines.findIndex(line => /^##\s+/.test(line));
    const sectionLines =
      nextHeadingIndex === -1 ? remainingLines : remainingLines.slice(0, nextHeadingIndex);
    const sectionText = sectionLines.join('\n');

    expect(sectionText).toMatch(/(^|\n)\s*(?:-|\d+\.)\s+/);
    expect(sectionText).toMatch(/\[([^\]]*Architecture[^\]]*)\]\(docs\/architecture\.md\)/i);
  });
});
