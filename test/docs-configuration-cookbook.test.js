import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cookbookPath = path.join(repoRoot, 'docs/configuration-cookbook.md');

let cookbookDoc;

beforeAll(async () => {
  cookbookDoc = await readFile(cookbookPath, 'utf8');
});

describe('configuration cookbook documentation', () => {
  it('documents the secure session cookie override', () => {
    expect(cookbookDoc).toMatch(/JOBBOT_WEB_SESSION_SECURE/);
    expect(cookbookDoc).toMatch(/`Secure`\s+cookie attribute/i);
  });

  it('references the manifest secret verification command', () => {
    expect(cookbookDoc).toMatch(/loadConfig\(\)\.missingSecrets/);
  });
});
