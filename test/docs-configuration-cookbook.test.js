import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const cookbookPath = new URL('../docs/configuration-cookbook.md', import.meta.url);

describe('configuration cookbook documentation', () => {
  it('documents the core configuration surfaces and validation commands', () => {
    const contents = readFileSync(cookbookPath, 'utf8');
    expect(contents).toContain('# Configuration Cookbook');
    expect(contents).toContain('## Overview');
    expect(contents).toContain('## Required secrets');
    expect(contents).toContain('## Feature flags');
    expect(contents).toContain('## Environment templates');
    expect(contents).toMatch(/node -e "import { loadConfig }/);
  });

  it('links to its regression test so future edits keep the guide aligned', () => {
    const contents = readFileSync(cookbookPath, 'utf8');
    expect(contents).toMatch(/test\/docs-configuration-cookbook\.test\.js/);
  });
});
