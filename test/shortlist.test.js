import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir;

describe('shortlist metadata sync and filters', () => {
  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-shortlist-'));
    const { setShortlistDataDir } = await import('../src/shortlist.js');
    setShortlistDataDir(dataDir);
  });

  afterEach(async () => {
    if (dataDir) {
      const fs = await import('node:fs/promises');
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    const { setShortlistDataDir } = await import('../src/shortlist.js');
    setShortlistDataDir(undefined);
  });

  it('stores metadata and returns it when syncing shortlist entries', async () => {
    const { syncShortlistJob, getShortlist, filterShortlist } = await import('../src/shortlist.js');

    await syncShortlistJob('job-metadata', {
      location: 'Remote',
      level: 'Senior',
      compensation: '$180k',
      syncedAt: '2025-02-03T04:05:06Z',
    });

    const store = await getShortlist();
    expect(store.jobs['job-metadata'].metadata).toMatchObject({
      location: 'Remote',
      level: 'Senior',
      compensation: '$180k',
      synced_at: '2025-02-03T04:05:06.000Z',
    });

    const byFilters = await filterShortlist({ location: 'remote', level: 'senior' });
    expect(Object.keys(byFilters.jobs)).toEqual(['job-metadata']);
  });
});
