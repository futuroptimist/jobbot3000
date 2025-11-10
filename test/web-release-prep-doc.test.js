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

describe('web roadmap release prep', () => {
  it('documents the completed security review with a risk assessment reference', async () => {
    const roadmap = await read('docs/web-interface-roadmap.md');
    const releasePrepSection = roadmap.match(
      /- Conduct security review and threat modeling session\.[\s\S]*?(?=\n\n|$)/,
    );
    expect(releasePrepSection).toBeTruthy();
    const sectionText = releasePrepSection ? releasePrepSection[0] : '';

    expect(sectionText).toMatch(/_Implemented \(2025-11-\d{2}\):/);
    expect(sectionText).toMatch(/docs\/security\/risk-assessments\/web-status-hub\.md/);
    expect(sectionText).toMatch(/test\/web-release-prep-doc\.test\.js/);

    const assessment = await read('docs/security/risk-assessments/web-status-hub.md');
    expect(assessment).toContain('# Risk assessment:');
    expect(assessment).toContain('## Threat model overview');
    expect(assessment).toContain('## Scenario analysis');
  });
});
