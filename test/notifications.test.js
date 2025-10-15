import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDir;
let restoreAnalyticsDir;
let restoreNotificationsDir;

async function writeJson(filePath, data) {
  const fs = await import('node:fs/promises');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

describe('notifications', () => {
  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-notifications-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
    restoreAnalyticsDir = undefined;
    restoreNotificationsDir = undefined;
  });

  afterEach(async () => {
    vi.resetModules();
    if (restoreAnalyticsDir) {
      await restoreAnalyticsDir();
      restoreAnalyticsDir = undefined;
    }
    if (restoreNotificationsDir) {
      await restoreNotificationsDir();
      restoreNotificationsDir = undefined;
    }
    if (dataDir) {
      const fs = await import('node:fs/promises');
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
    delete process.env.JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY;
  });

  it('subscribes to weekly summaries and updates existing entries', async () => {
    const { subscribeWeeklySummary, listWeeklySummarySubscriptions, setNotificationsDataDir } =
      await import('../src/notifications.js');

    setNotificationsDataDir(dataDir);
    restoreNotificationsDir = async () => setNotificationsDataDir(undefined);

    const created = await subscribeWeeklySummary('Ada@example.com', {
      lookbackDays: 10,
      now: '2025-03-07T12:00:00.000Z',
    });

    expect(created).toMatchObject({
      email: 'ada@example.com',
      lookbackDays: 10,
      createdAt: '2025-03-07T12:00:00.000Z',
    });

    const firstList = await listWeeklySummarySubscriptions();
    expect(firstList).toHaveLength(1);

    const updated = await subscribeWeeklySummary('ada@example.com', {
      lookbackDays: 5,
      now: '2025-03-08T09:00:00.000Z',
    });

    expect(updated).toMatchObject({
      email: 'ada@example.com',
      lookbackDays: 5,
      updatedAt: '2025-03-08T09:00:00.000Z',
      id: created.id,
    });

    const finalList = await listWeeklySummarySubscriptions();
    expect(finalList).toHaveLength(1);
    expect(finalList[0]).toMatchObject({ email: 'ada@example.com', lookbackDays: 5 });
  });

  it('runs weekly summary notifications and writes email payloads to the outbox', async () => {
    const fs = await import('node:fs/promises');

    await writeJson(path.join(dataDir, 'applications.json'), {
      'job-1': 'screening',
      'job-2': 'onsite',
      'job-3': 'offer',
      'job-4': 'rejected',
      'job-5': 'withdrawn',
    });

    await writeJson(path.join(dataDir, 'application_events.json'), {
      'job-1': [
        { channel: 'email', date: '2025-01-02T10:00:00.000Z' },
        { channel: 'follow_up', date: '2025-01-05T15:30:00.000Z' },
      ],
      'job-2': [{ channel: 'referral', date: '2025-01-03T12:00:00.000Z' }],
      'job-3': [
        { channel: 'email', date: '2025-01-04T09:00:00.000Z' },
        { channel: 'offer_accepted', date: '2025-02-01T18:00:00.000Z' },
      ],
      'job-4': [{ channel: 'application', date: '2025-01-06T08:00:00.000Z' }],
    });

    const {
      subscribeWeeklySummary,
      runWeeklySummaryNotifications,
      setNotificationsDataDir,
    } = await import('../src/notifications.js');
    const { setAnalyticsDataDir } = await import('../src/analytics.js');

    setAnalyticsDataDir(dataDir);
    setNotificationsDataDir(dataDir);
    restoreAnalyticsDir = async () => setAnalyticsDataDir(undefined);
    restoreNotificationsDir = async () => setNotificationsDataDir(undefined);

    await subscribeWeeklySummary('ada@example.com', { lookbackDays: 60 });

    const result = await runWeeklySummaryNotifications({ now: '2025-02-08T12:00:00.000Z' });
    expect(result).toEqual({
      sent: 1,
      results: [
        expect.objectContaining({
          email: 'ada@example.com',
          file: expect.stringContaining(path.join('notifications', 'outbox')),
        }),
      ],
    });

    const outboxFiles = await fs.readdir(path.join(dataDir, 'notifications', 'outbox'));
    expect(outboxFiles).toHaveLength(1);
    const [fileName] = outboxFiles;
    expect(fileName).toMatch(/ada-example-com/);

    const emailPath = path.join(dataDir, 'notifications', 'outbox', fileName);
    const payload = await fs.readFile(emailPath, 'utf8');
    expect(payload).toContain('To: ada@example.com');
    expect(payload).toContain('Subject: jobbot3000 weekly summary (');
    expect(payload).toContain('Funnel snapshot');
    expect(payload).toMatch(/Outreach: 4/);
    expect(payload).toContain('Health check');
  });

  it('skips weekly summary delivery when JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY=false', async () => {
    process.env.JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY = 'false';

    const {
      subscribeWeeklySummary,
      runWeeklySummaryNotifications,
      setNotificationsDataDir,
    } = await import('../src/notifications.js');

    setNotificationsDataDir(dataDir);
    restoreNotificationsDir = async () => setNotificationsDataDir(undefined);

    await expect(
      subscribeWeeklySummary('ada@example.com', { lookbackDays: 7 }),
    ).rejects.toThrow(/weekly summary notifications are disabled/i);

    const result = await runWeeklySummaryNotifications({ now: '2025-02-08T12:00:00.000Z' });
    expect(result).toEqual({ sent: 0, results: [], disabled: true });
  });
});
