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

  it('defines a docker-compose healthcheck targeting the web server /health endpoint', async () => {
    const composePath = path.join(repoRoot, 'docker-compose.web.yml');
    const compose = await readFile(composePath, 'utf8');
    expect(compose).toContain('healthcheck:');
    expect(compose).toContain('scripts/docker-healthcheck.js');
    expect(compose).toContain('http://127.0.0.1:3000/health');
  });

  it('locks the runtime profile with read-only rootfs and a custom seccomp policy', async () => {
    const composePath = path.join(repoRoot, 'docker-compose.web.yml');
    const compose = await readFile(composePath, 'utf8');
    expect(compose).toContain('read_only: true');
    expect(compose).toMatch(/security_opt:\s*\n\s+- no-new-privileges:true/);
    expect(compose).toMatch(/seccomp=\.\/config\/seccomp\/jobbot-web\.json/);

    const seccompPath = path.join(repoRoot, 'config', 'seccomp', 'jobbot-web.json');
    const profile = JSON.parse(await readFile(seccompPath, 'utf8'));
    expect(profile.defaultAction).toBe('SCMP_ACT_ERRNO');
    const architectures = profile.architectures
      ? new Set(profile.architectures)
      : new Set(profile.archMap?.map((entry) => entry.architecture));
    expect(architectures.has('SCMP_ARCH_X86_64')).toBe(true);

    const syscallNames = new Set(
      profile.syscalls
        ?.filter((entry) => entry.action === 'SCMP_ACT_ALLOW')
        .flatMap((entry) => entry.names ?? []) ?? []
    );
    expect(syscallNames.has('accept4')).toBe(true);
    expect(syscallNames.has('clone3')).toBe(false);
  });
});
