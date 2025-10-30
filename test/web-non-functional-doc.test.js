import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function readNonFunctionalDoc() {
  const filePath = path.join(repoRoot, 'docs/web-non-functional-requirements.md');
  return fs.readFile(filePath, 'utf8');
}

describe('web non-functional requirements documentation', () => {
  it('captures performance, security, accessibility, and reliability guardrails', async () => {
    const markdown = await readNonFunctionalDoc();

    expect(markdown).toMatch(/# Web Non-Functional Requirements/);
    expect(markdown).toMatch(/## Performance/);
    expect(markdown).toMatch(/## Security/);
    expect(markdown).toMatch(/## Accessibility/);
    expect(markdown).toMatch(/## Reliability/);
    expect(markdown).toMatch(/P95 page load <2s/);
    expect(markdown).toMatch(/WCAG AA/);
    expect(markdown).toMatch(/CSRF/);
  });
});
