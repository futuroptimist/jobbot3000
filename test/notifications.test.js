import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sendWeeklySummaryEmail } from '../src/notifications.js';

describe('notifications', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-notifications-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
  });

  it('spools a weekly summary email with analytics insights', async () => {
    const applicationsPath = path.join(dataDir, 'applications.json');
    const eventsPath = path.join(dataDir, 'application_events.json');

    await fs.writeFile(
      applicationsPath,
      JSON.stringify(
        {
          'job-1': {
            status: 'onsite',
            updated_at: '2025-01-30T18:00:00.000Z',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await fs.writeFile(
      eventsPath,
      JSON.stringify(
        {
          'job-1': [
            { channel: 'email', date: '2025-01-27T10:00:00.000Z' },
            { channel: 'call', date: '2025-01-29T16:30:00.000Z' },
          ],
          'job-2': [{ channel: 'email', date: '2025-01-28T09:15:00.000Z' }],
          'job-old': [{ channel: 'email', date: '2024-12-15T09:00:00.000Z' }],
        },
        null,
        2,
      ),
      'utf8',
    );

    const outboxDir = path.join(dataDir, 'outbox');
    const now = new Date('2025-02-01T12:00:00.000Z');

    const result = await sendWeeklySummaryEmail({
      to: 'alice@example.com',
      from: 'jobbot3000 <jobbot@example.com>',
      now,
      outboxDir,
    });

    expect(result.subject).toBe('jobbot3000 Weekly Summary (2025-01-26 → 2025-02-01)');
    expect(result.range).toEqual({
      from: '2025-01-26T00:00:00.000Z',
      to: '2025-02-01T23:59:59.999Z',
    });
    expect(result.stats).toMatchObject({
      trackedJobs: 2,
      outreach: 2,
      missingStatuses: 1,
    });
    expect(result.outboxPath).toMatch(/weekly-summary-20250126-20250201-/);

    const payload = await fs.readFile(result.outboxPath, 'utf8');
    expect(payload).toContain('Subject: jobbot3000 Weekly Summary (2025-01-26 → 2025-02-01)');
    expect(payload).toContain('To: alice@example.com');
    expect(payload).toContain('Tracked jobs touched: 2');
    expect(payload).toContain('Missing statuses: 1 job (job-2)');
    expect(payload).toContain('Largest drop-off: Outreach → Screening (2 lost)');
    expect(payload).toContain('Stay focused and close the loop on outstanding follow-ups.');
  });
});
