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
    expect(roadmap).toMatch(/Implemented \(2025-11-05\):/);
    expect(roadmap).toContain('docs/security/third-party-pentest-2025-12.md');
  });

  it('keeps the pentest summary scaffold intact', async () => {
    const summary = await read('docs/security/pentest-summary.md');
    expect(summary).toContain('# Web penetration test summary');
    expect(summary).toMatch(/Test window:\s*2025-11/);
    expect(summary).toMatch(/Findings/);
    expect(summary).toMatch(/Mitigations/);
    expect(summary).toMatch(/Verification/);
  });

  it('documents the third-party penetration test report', async () => {
    const roadmap = await read('docs/web-security-roadmap.md');
    expect(roadmap).toMatch(/third-party penetration test/);
    expect(roadmap).toContain('docs/security/third-party-pentest-2025-12.md');

    const thirdPartySummary = await read(
      'docs/security/third-party-pentest-2025-12.md',
    );
    expect(thirdPartySummary).toContain('# Third-party web penetration test summary');
    expect(thirdPartySummary).toMatch(/Vendor:\s*Acme Security Labs/);
    expect(thirdPartySummary).toMatch(/Test window:\s*2025-11-02 to 2025-11-05/);
    expect(thirdPartySummary).toMatch(/Findings/);
    expect(thirdPartySummary).toMatch(/Mitigations/);
    expect(thirdPartySummary).toMatch(/Verification/);
  });
});
