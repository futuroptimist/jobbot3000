import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function loadPackageJson() {
  const contents = await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8');
  return JSON.parse(contents);
}

describe('pre-commit automation', () => {
  it('runs linting, formatting, and type checking before commits', async () => {
    const pkg = await loadPackageJson();
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts['format:check']).toMatch(/prettier --check/);
    expect(pkg.scripts['typecheck']).toContain('tsc');
    expect(pkg.scripts.prepare).toContain('simple-git-hooks');

    const hook = pkg['simple-git-hooks']?.['pre-commit'];
    expect(hook).toBeTruthy();
    expect(hook).toContain('lint-staged');
    expect(hook).toContain('npm run typecheck');

    const lintStaged = pkg['lint-staged'];
    expect(lintStaged).toBeTruthy();
    expect(Object.keys(lintStaged)).toEqual(
      expect.arrayContaining(['*.{js,mjs,cjs,ts,tsx,jsx}', '*.{json,md,mdx,yml,yaml}']),
    );
  });
});
