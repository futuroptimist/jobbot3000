import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  return {
    'content-type': 'application/json',
    [headerName]: token,
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

    await mkdir(sandboxDataDir, { recursive: true });

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

  it('returns reminder sections via the real CLI', async () => {
    const workspaceDir = await createTempDir();
    const sandboxDataDir = path.join(workspaceDir, 'data');
    await mkdir(sandboxDataDir, { recursive: true });

    const { setApplicationEventsDataDir, logApplicationEvent } = await import(
      '../src/application-events.js'
    );
    setApplicationEventsDataDir(sandboxDataDir);
    await logApplicationEvent('job-1', {
      channel: 'follow_up',
      date: '2025-02-27T10:00:00Z',
      remindAt: '2025-03-05T09:00:00Z',
      note: 'Send update',
    });
    await logApplicationEvent('job-1', {
      channel: 'call',
      date: '2025-02-20T09:00:00Z',
      remindAt: '2025-02-28T09:00:00Z',
      contact: 'Taylor Recruiter',
    });
    setApplicationEventsDataDir(undefined);

    const originalEnableNativeCli = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = '1';

    try {
      const server = await startServer({
        commandAdapterOptions: { env: { ...process.env, JOBBOT_DATA_DIR: sandboxDataDir } },
      });

      const response = await fetch(`${server.url}/commands/reminders`, {
        method: 'POST',
        headers: buildHeaders(server),
        body: JSON.stringify({ now: '2025-03-01T00:00:00Z', upcomingOnly: true }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.command).toBe('reminders');
      expect(payload.format).toBe('json');
      expect(payload.stderr).toBe('');
      expect(payload.data).toEqual({
        reminders: [
          {
            job_id: 'job-1',
            remind_at: '2025-03-05T09:00:00.000Z',
            channel: 'follow_up',
            note: 'Send update',
            past_due: false,
          },
        ],
        sections: [
          {
            heading: 'Upcoming',
            reminders: [
              {
                job_id: 'job-1',
                remind_at: '2025-03-05T09:00:00.000Z',
                channel: 'follow_up',
                note: 'Send update',
                past_due: false,
              },
            ],
          },
        ],
      });
      expect(JSON.parse(payload.stdout)).toEqual(payload.data);
    } finally {
      if (originalEnableNativeCli === undefined) {
        delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
      } else {
        process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = originalEnableNativeCli;
      }
    }
  });

  it('exports reminders calendars via the real CLI', async () => {
    const workspaceDir = await createTempDir();
    const sandboxDataDir = path.join(workspaceDir, 'data');
    await mkdir(sandboxDataDir, { recursive: true });

    const { setApplicationEventsDataDir, logApplicationEvent } = await import(
      '../src/application-events.js'
    );
    setApplicationEventsDataDir(sandboxDataDir);
    await logApplicationEvent('job-42', {
      channel: 'email',
      date: '2025-02-27T10:00:00Z',
      remindAt: '2025-03-06T09:00:00Z',
      note: 'Send follow-up',
      contact: 'Jamie Recruiter',
    });
    setApplicationEventsDataDir(undefined);

    const originalEnableNativeCli = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = '1';

    try {
      const server = await startServer({
        commandAdapterOptions: { env: { ...process.env, JOBBOT_DATA_DIR: sandboxDataDir } },
      });

      const response = await fetch(`${server.url}/commands/remindersCalendar`, {
        method: 'POST',
        headers: buildHeaders(server),
        body: JSON.stringify({
          now: '2025-03-01T00:00:00Z',
          calendarName: 'Follow-ups',
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        command: 'remindersCalendar',
        format: 'ics',
        stderr: '',
      });
      expect(payload.stdout).toContain('Saved reminder calendar');
      expect(payload.calendar).toContain('BEGIN:VCALENDAR');
      expect(payload.calendar).toContain('SUMMARY:job-42');
      expect(payload.calendar).toContain('CONTACT:Jamie Recruiter');
      expect(payload.calendar).toContain('DESCRIPTION:Job ID: job-42\\nChannel: email\\n');
    } finally {
      if (originalEnableNativeCli === undefined) {
        delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
      } else {
        process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = originalEnableNativeCli;
      }
    }
  });
});
