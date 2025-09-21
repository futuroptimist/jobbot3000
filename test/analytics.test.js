import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir;
let restoreAnalyticsDir;

describe('analytics conversion funnel', () => {
  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-analytics-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
    restoreAnalyticsDir = undefined;
  });

  afterEach(async () => {
    if (restoreAnalyticsDir) {
      await restoreAnalyticsDir();
      restoreAnalyticsDir = undefined;
    }
    if (dataDir) {
      const fs = await import('node:fs/promises');
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
  });

  it('summarizes lifecycle and event data into drop-off stages', async () => {
    const fs = await import('node:fs/promises');
    await fs.writeFile(
      path.join(dataDir, 'applications.json'),
      JSON.stringify(
        {
          'job-1': 'screening',
          'job-2': 'onsite',
          'job-3': 'offer',
          'job-4': 'rejected',
          'job-5': 'withdrawn',
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(dataDir, 'application_events.json'),
      JSON.stringify(
        {
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
        },
        null,
        2,
      ),
    );

    const { computeFunnel, formatFunnelReport, setAnalyticsDataDir } = await import(
      '../src/analytics.js'
    );
    setAnalyticsDataDir(dataDir);
    restoreAnalyticsDir = async () => setAnalyticsDataDir(undefined);

    const funnel = await computeFunnel();
    expect(funnel).toMatchObject({
      totals: { trackedJobs: 5, withEvents: 4 },
      largestDropOff: { from: 'outreach', to: 'screening', dropOff: 3 },
      stages: [
        { key: 'outreach', count: 4 },
        { key: 'screening', count: 1, conversionRate: 0.25, dropOff: 3 },
        { key: 'onsite', count: 1, conversionRate: 1, dropOff: 0 },
        { key: 'offer', count: 1, conversionRate: 1, dropOff: 0 },
        { key: 'acceptance', count: 1, conversionRate: 1, dropOff: 0 },
      ],
    });

    const report = formatFunnelReport(funnel);
    expect(report).toContain('Outreach: 4');
    expect(report).toContain('Screening: 1 (25% conversion, 3 drop-off)');
    expect(report).toContain('Largest drop-off: Outreach → Screening (3 lost)');
    expect(report).toContain('Tracked jobs: 5 total; 4 with outreach events');
  });

  it('marks conversion as unavailable when no prior stage baseline exists', async () => {
    const fs = await import('node:fs/promises');
    await fs.writeFile(
      path.join(dataDir, 'applications.json'),
      JSON.stringify({ 'job-1': 'screening', 'job-2': 'offer' }, null, 2),
    );
    await fs.writeFile(path.join(dataDir, 'application_events.json'), JSON.stringify({}, null, 2));

    const { computeFunnel, formatFunnelReport, setAnalyticsDataDir } = await import(
      '../src/analytics.js'
    );
    setAnalyticsDataDir(dataDir);
    restoreAnalyticsDir = async () => setAnalyticsDataDir(undefined);

    const funnel = await computeFunnel();
    expect(funnel.stages[0]).toMatchObject({ key: 'outreach', count: 0 });
    expect(funnel.stages[1]).toMatchObject({ key: 'screening', count: 1 });
    expect(funnel.stages[1].conversionRate).toBeUndefined();

    const report = formatFunnelReport(funnel);
    expect(report).toContain('Screening: 1 (n/a conversion');
  });
});
