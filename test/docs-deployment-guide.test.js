import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const guidePath = path.join(repoRoot, 'docs/deployment-local-vs-self-hosted.md');

async function readGuide() {
  return fs.readFile(guidePath, 'utf8');
}

describe('deployment guide documentation', () => {
  it('documents enabling the native CLI bridge for local development', async () => {
    const contents = await readGuide();
    expect(contents).toMatch(/JOBBOT_WEB_ENABLE_NATIVE_CLI|--enable-native-cli/);
  });

  it('records CSRF and auth token hardening steps for self-hosted deployments', async () => {
    const contents = await readGuide();
    expect(contents).toMatch(/JOBBOT_WEB_CSRF_TOKEN/);
    expect(contents).toMatch(/JOBBOT_WEB_AUTH_TOKENS/);
  });
});
