import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadScheduleConfig, buildScheduledTasks } from '../src/schedule.js';

function runCli(args, { dataDir }) {
  const bin = path.resolve('bin', 'jobbot.js');
  return execFileSync('node', [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
  });
}

describe('notifications scheduler integration', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-notifications-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('subscribes weekly summary emails through the CLI', async () => {
    const configPath = path.join(tmpDir, 'schedule.json');
    const outboxDir = path.join(tmpDir, 'outbox');

    runCli(
      [
        'notifications',
        'subscribe',
        'weekly',
        '--email',
        'applicant@example.com',
        '--config',
        configPath,
        '--outbox',
        outboxDir,
      ],
      { dataDir: tmpDir },
    );

    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.tasks).toEqual([
      expect.objectContaining({
        id: expect.stringContaining('weekly'),
        type: 'notification',
        template: 'weekly-summary',
        email: 'applicant@example.com',
        intervalMinutes: 7 * 24 * 60,
        outbox: outboxDir,
      }),
    ]);
  });

  it('delivers weekly summary emails via scheduled notification tasks', async () => {
    const configPath = path.join(tmpDir, 'schedule.json');
    const outboxDir = path.join(tmpDir, 'outbox');

    await fs.writeFile(
      path.join(tmpDir, 'applications.json'),
      JSON.stringify(
        {
          'job-1': 'screening',
          'job-2': 'onsite',
          'job-3': 'offer',
        },
        null,
        2,
      ),
    );

    await fs.writeFile(
      path.join(tmpDir, 'application_events.json'),
      JSON.stringify(
        {
          'job-1': [
            {
              channel: 'email',
              date: '2025-03-02T15:00:00.000Z',
              remind_at: '2025-03-09T12:00:00.000Z',
              note: 'Follow up after onsite',
            },
          ],
          'job-2': [
            {
              channel: 'referral',
              date: '2025-03-04T18:30:00.000Z',
            },
          ],
          'job-3': [
            {
              channel: 'offer_accepted',
              date: '2025-03-01T09:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    );

    runCli(
      [
        'notifications',
        'subscribe',
        'weekly',
        '--email',
        'applicant@example.com',
        '--config',
        configPath,
        '--outbox',
        outboxDir,
      ],
      { dataDir: tmpDir },
    );

    const definitions = await loadScheduleConfig(configPath);
    const logger = { info: vi.fn(), error: vi.fn() };
    const now = () => new Date('2025-03-08T10:00:00.000Z');
    const originalDataDir = process.env.JOBBOT_DATA_DIR;
    process.env.JOBBOT_DATA_DIR = tmpDir;

    try {
      const tasks = buildScheduledTasks(definitions, { logger, now });
      const notificationTask = tasks.find(task => task.id.includes('weekly'));
      expect(notificationTask).toBeDefined();

      const message = await notificationTask.run();
      expect(typeof message).toBe('string');
      expect(message).toMatch(/Sent weekly summary email/i);
      notificationTask.onSuccess?.(message, notificationTask);

      const files = await fs.readdir(outboxDir);
      expect(files).toHaveLength(1);
      const emailPath = path.join(outboxDir, files[0]);
      const emailContents = await fs.readFile(emailPath, 'utf8');
      expect(emailContents).toContain('Subject: Jobbot Weekly Summary');
      expect(emailContents).toContain('Tracked jobs: 2');
      expect(emailContents).toContain('Largest drop-off');
      expect(emailContents).toContain('Upcoming follow-ups: 1');
      expect(logger.info).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      if (originalDataDir === undefined) {
        delete process.env.JOBBOT_DATA_DIR;
      } else {
        process.env.JOBBOT_DATA_DIR = originalDataDir;
      }
    }
  });
});
