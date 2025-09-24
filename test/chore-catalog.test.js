import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const CATALOG_PATH = path.resolve('docs', 'chore-catalog.md');

describe('chore catalog documentation', () => {
  it('lists recurring chores with owners, cadence, and required commands', () => {
    const contents = fs.readFileSync(CATALOG_PATH, 'utf8');
    expect(contents).toContain('| Task | Owner | Frequency | Commands |');
    expect(contents).toMatch(/npm run lint/);
    expect(contents).toMatch(/npm run test:ci/);
    expect(contents).toMatch(/git diff --cached \\?\| \.\/scripts\/scan-secrets\.py/);
    expect(contents).toMatch(/Prompt Docs/i);
  });
});
