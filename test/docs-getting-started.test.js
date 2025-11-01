import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const guidePath = new URL('../docs/getting-started.md', import.meta.url);

describe('getting started guide', () => {
  it('documents project setup steps for new contributors', () => {
    const contents = readFileSync(guidePath, 'utf8');
    expect(contents).toContain('## Project setup');
    expect(contents).toMatch(/npm ci/);
    expect(contents).toContain('cp .env.example .env');
    expect(contents).toMatch(/npm run dev/);
  });

  it('lists CLI dependencies so npx jobbot commands work out of the box', () => {
    const contents = readFileSync(guidePath, 'utf8');
    expect(contents).toContain('## CLI dependencies');
    expect(contents).toContain('Node.js 20+');
    expect(contents).toMatch(/npx jobbot/);
    expect(contents).toMatch(/npm run prepare:test/);
  });

  it('explains the core test commands contributors must run', () => {
    const contents = readFileSync(guidePath, 'utf8');
    expect(contents).toContain('## Test commands');
    expect(contents).toMatch(/npm run lint/);
    expect(contents).toMatch(/npm run test:ci/);
    expect(contents).toMatch(/npm run test -- --watch/);
  });
});
