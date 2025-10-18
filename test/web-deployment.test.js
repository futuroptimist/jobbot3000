import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

describe('web deployment artifacts', () => {
  it('ships a Dockerfile for the web server', async () => {
    const dockerfilePath = path.join(repoRoot, 'Dockerfile');
    const dockerfile = await readFile(dockerfilePath, 'utf8');
    expect(dockerfile).toContain('FROM node:20-slim AS base');
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('CMD ["node", "scripts/web-server.js"');
  });

  it('provides a docker-compose definition wiring the web server defaults', async () => {
    const composePath = path.join(repoRoot, 'docker-compose.web.yml');
    const compose = await readFile(composePath, 'utf8');
    expect(compose).toContain('services:');
    expect(compose).toContain('JOBBOT_WEB_ENV=production');
    expect(compose).toContain('JOBBOT_DATA_DIR=/data');
    expect(compose).toContain('JOBBOT_WEB_ENABLE_NATIVE_CLI=1');
  });
});
