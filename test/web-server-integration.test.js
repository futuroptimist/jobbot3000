import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const activeServers = [];
const tempDirs = [];

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jobbot-web-int-'));
  tempDirs.push(dir);
  return dir;
}

async function startServer(options) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'integration-csrf-token',
    rateLimit: { windowMs: 1000, max: 20 },
    ...options,
  });
  activeServers.push(server);
  return server;
}

function buildHeaders(server, overrides = {}) {
  const headerName = server?.csrfHeaderName ?? 'x-jobbot-csrf';
  const token = server?.csrfToken ?? 'integration-csrf-token';
  const cookieName = server?.csrfCookieName ?? 'jobbot_csrf_token';
  return {
    'content-type': 'application/json',
    [headerName]: token,
    cookie: `${cookieName}=${token}`,
    ...overrides,
  };
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    await rm(dir, { recursive: true, force: true });
  }
});

describe('web server integration with CLI', () => {
  it('executes the match command via the real CLI in a sandboxed data dir', async () => {
    const workspaceDir = await createTempDir();
    const sandboxDataDir = path.join(workspaceDir, 'data');
    const resumePath = path.join(workspaceDir, 'resume.txt');
    const jobPath = path.join(workspaceDir, 'job.txt');

    await writeFile(
      resumePath,
      [
        'Summary: Built Node.js services',
        'Experience:',
        '- Company: Example',
        '  Details: Node.js and Terraform',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      jobPath,
      [
        'Title: Platform Engineer',
        'Company: ExampleCorp',
        'Location: Remote',
        'Summary: Build systems that scale.',
        'Requirements:',
        '- Node.js',
        '- Terraform',
      ].join('\n'),
      'utf8',
    );

    const originalEnableNativeCli = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = '1';

    try {
      const server = await startServer({
        commandAdapterOptions: {
          env: { ...process.env, JOBBOT_DATA_DIR: sandboxDataDir },
        },
      });

      const response = await fetch(`${server.url}/commands/match`, {
        method: 'POST',
        headers: buildHeaders(server),
        body: JSON.stringify({
          resume: resumePath,
          job: jobPath,
          format: 'json',
          explain: true,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        command: 'match',
        format: 'json',
        stderr: '',
        data: {
          title: 'Platform Engineer',
          score: 100,
          matched: ['Node.js', 'Terraform'],
          missing: [],
        },
      });
      expect(typeof payload.stdout).toBe('string');
      const stdoutJson = JSON.parse(payload.stdout);
      expect(stdoutJson).toMatchObject({
        title: 'Platform Engineer',
        score: 100,
        matched: ['Node.js', 'Terraform'],
        missing: [],
      });
      expect(Array.isArray(payload.data.evidence)).toBe(true);
      expect(payload.data.evidence[0]).toMatchObject({ source: 'requirements' });

      const jobsDir = path.join(sandboxDataDir, 'jobs');
      const jobFiles = await readdir(jobsDir);
      expect(jobFiles.length).toBeGreaterThan(0);
      const snapshotPath = path.join(jobsDir, jobFiles[0]);
      const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
      expect(snapshot).toMatchObject({
        parsed: { title: 'Platform Engineer' },
        source: { type: 'file' },
      });
    } finally {
      if (originalEnableNativeCli === undefined) {
        delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
      } else {
        process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = originalEnableNativeCli;
      }
    }
  });
});
