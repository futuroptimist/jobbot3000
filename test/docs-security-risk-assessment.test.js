import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const guidePath = new URL('../docs/security-risk-assessment-guide.md', import.meta.url);
const archiveReadmePath = new URL('../docs/security/risk-assessments/README.md', import.meta.url);

describe('security risk assessment documentation', () => {
  it('explains configuration fields, STRIDE coverage, and CLI usage', () => {
    const guide = readFileSync(guidePath, 'utf8');
    expect(guide).toContain('scripts/generate-risk-assessment.js');
    expect(guide).toMatch(/STRIDE category/);
    expect(guide).toMatch(/impact.*likelihood/);
    expect(guide).toMatch(/npm run security:risk-assessment/);
    expect(guide).toMatch(/test\/security-risk-assessment\.test\.js/);
    expect(guide).toMatch(/test\/security-risk-assessment-cli\.test\.js/);
  });

  it('archives risk assessments under the documented directory', () => {
    const archiveReadme = readFileSync(archiveReadmePath, 'utf8');
    expect(archiveReadme).toMatch(/generate-risk-assessment\.js/);
    expect(archiveReadme).toMatch(/security-risk-assessment-guide\.md/);
  });
});
