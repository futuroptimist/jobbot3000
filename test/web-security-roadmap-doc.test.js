import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function read(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  return fs.readFile(absolute, 'utf8');
}

describe('web security roadmap pentest coverage', () => {
  it('documents the published pentest summary', async () => {
    const roadmap = await read('docs/web-security-roadmap.md');
    expect(roadmap).toContain('Perform recurring third-party penetration tests');
    expect(roadmap).toMatch(/Implemented \(2025-11-\d{2}\):/);
    expect(roadmap).toContain('docs/security/pentest-summary.md');
  });

  it('keeps the pentest summary scaffold intact', async () => {
    const summary = await read('docs/security/pentest-summary.md');
    expect(summary).toContain('# Web penetration test summary');
    expect(summary).toMatch(/Test window:\s*2025-11/);
    expect(summary).toMatch(/Findings/);
    expect(summary).toMatch(/Mitigations/);
    expect(summary).toMatch(/Verification/);
  });
});
