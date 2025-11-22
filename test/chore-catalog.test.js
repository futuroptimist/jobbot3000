import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const CATALOG_PATH = path.resolve('docs', 'chore-catalog.md');
const PACKAGE_JSON_PATH = path.resolve('package.json');

describe('chore catalog documentation', () => {
  it('lists recurring chores with owners, cadence, and required commands', () => {
    const contents = fs.readFileSync(CATALOG_PATH, 'utf8');
    expect(contents).toContain('| Task | Owner | Frequency | Commands |');
    expect(contents).toMatch(/npm run lint/);
    expect(contents).toMatch(/npm run test:ci/);
    expect(contents).toMatch(/git diff --cached \\?\| \.\/scripts\/scan-secrets\.py/);
    expect(contents).toMatch(/Prompt Docs/i);
    expect(contents).toMatch(/npm run chore:prompts/);
  });

  it('documents a single pre-push chore that bundles lint, tests, and secret scan', () => {
    const contents = fs.readFileSync(CATALOG_PATH, 'utf8');
    expect(contents).toMatch(/Pre-push sweep/i);
    expect(contents).toMatch(/npm run chore:prepush/);

    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const secretScanPattern = /git diff --cached \| \.\/scripts\/scan-secrets\.py/;
    expect(packageJson.scripts['chore:prepush']).toMatch(/npm run lint/);
    expect(packageJson.scripts['chore:prepush']).toMatch(/npm run test:ci/);
    expect(packageJson.scripts['chore:prepush']).toMatch(secretScanPattern);
  });
});
