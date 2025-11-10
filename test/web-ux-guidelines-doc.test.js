import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docPath = path.join(repoRoot, 'docs', 'web-ux-guidelines.md');

async function readGuidelines() {
  return fs.readFile(docPath, 'utf8');
}

describe('web UX guidelines documentation', () => {
  it('covers layout, typography, interaction, and accessibility guardrails', async () => {
    const doc = await readGuidelines();

    expect(doc).toContain('# Web UX Guidelines');

    const requiredHeadings = [
      '## Layout and spacing',
      '## Typography and hierarchy',
      '## Interaction patterns',
      '## Accessibility guardrails',
      '## Asset references'
    ];

    for (const heading of requiredHeadings) {
      expect(doc).toContain(heading);
    }

    expect(doc).toMatch(/src\/web\/server\.js/);
    expect(doc).toMatch(/test\/web-server\.test\.js/);
    expect(doc).toMatch(/test\/web-status-hub-frontend\.test\.js/);
  });

  it('links to supporting roadmap and storybook references', async () => {
    const doc = await readGuidelines();

    expect(doc).toMatch(/docs\/web-interface-roadmap\.md/);
    expect(doc).toMatch(/docs\/web-component-storybook\.md/);
  });
});
