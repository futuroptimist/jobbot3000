import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir;

describe('shortlist metadata sync and filters', () => {
  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-shortlist-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
    const { setShortlistDataDir } = await import('../src/shortlist.js');
    setShortlistDataDir(dataDir);
  });

  afterEach(async () => {
    if (dataDir) {
      const fs = await import('node:fs/promises');
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
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

  it('filters shortlist entries by tag', async () => {
    const { addJobTags, filterShortlist } = await import('../src/shortlist.js');

    await addJobTags('job-tags', ['Remote', 'Dream']);
    await addJobTags('job-other', ['Hold']);

    const remote = await filterShortlist({ tags: ['remote'] });
    expect(Object.keys(remote.jobs)).toEqual(['job-tags']);

    const multi = await filterShortlist({ tags: ['remote', 'dream'] });
    expect(Object.keys(multi.jobs)).toEqual(['job-tags']);

    const none = await filterShortlist({ tags: ['onsite'] });
    expect(Object.keys(none.jobs)).toEqual([]);
  });

  it('records discard tags in shortlist and archive files', async () => {
    const { discardJob } = await import('../src/shortlist.js');

    const entry = await discardJob('job-tags', 'Overlap with existing role', {
      tags: ['Remote', 'remote', 'Dream'],
      date: '2025-05-06T07:08:09Z',
    });

    expect(entry).toMatchObject({
      reason: 'Overlap with existing role',
      discarded_at: '2025-05-06T07:08:09.000Z',
      tags: ['Remote', 'Dream'],
    });

    const fs = await import('node:fs/promises');
    const shortlistRaw = JSON.parse(
      await fs.readFile(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(shortlistRaw.jobs['job-tags'].discarded[0]).toMatchObject({
      reason: 'Overlap with existing role',
      discarded_at: '2025-05-06T07:08:09.000Z',
      tags: ['Remote', 'Dream'],
    });

    const archiveRaw = JSON.parse(
      await fs.readFile(path.join(dataDir, 'discarded_jobs.json'), 'utf8')
    );
    expect(archiveRaw['job-tags'][0]).toMatchObject({
      reason: 'Overlap with existing role',
      discarded_at: '2025-05-06T07:08:09.000Z',
      tags: ['Remote', 'Dream'],
    });
  });

  it('summarizes the most recent discard for shortlist records', async () => {
    const { discardJob, getShortlist } = await import('../src/shortlist.js');

    await discardJob('job-latest', 'First pass', {
      date: '2025-03-09T10:11:12Z',
      tags: ['remote', 'focus'],
    });

    await discardJob('job-latest', 'Second pass (older)', {
      date: '2025-03-01T09:08:07Z',
      tags: ['remote'],
    });

    const record = await getShortlist('job-latest');
    expect(record.last_discard).toMatchObject({
      reason: 'First pass',
      discarded_at: '2025-03-09T10:11:12.000Z',
      tags: ['remote', 'focus'],
    });
  });

  it('restores currency symbols for legacy shortlist compensation entries', async () => {
    const fs = await import('node:fs/promises');
    await fs.writeFile(
      path.join(dataDir, 'shortlist.json'),
      JSON.stringify(
        {
          jobs: {
            'job-legacy': {
              tags: [],
              discarded: [],
              metadata: { location: 'Remote', level: 'Senior', compensation: '120k' },
            },
          },
        },
        null,
        2
      )
    );

    const { getShortlist, filterShortlist } = await import('../src/shortlist.js');
    const record = await getShortlist('job-legacy');
    expect(record.metadata).toMatchObject({
      location: 'Remote',
      level: 'Senior',
      compensation: '$120k',
    });

    const filtered = await filterShortlist({ compensation: '$120k' });
    expect(Object.keys(filtered.jobs)).toEqual(['job-legacy']);
  });

  it('applies JOBBOT_SHORTLIST_CURRENCY to legacy compensation values', async () => {
    const fs = await import('node:fs/promises');
    await fs.writeFile(
      path.join(dataDir, 'shortlist.json'),
      JSON.stringify(
        {
          jobs: {
            'job-euro': {
              tags: [],
              discarded: [],
              metadata: { compensation: '95k' },
            },
          },
        },
        null,
        2
      )
    );

    process.env.JOBBOT_SHORTLIST_CURRENCY = '€';
    try {
      const { getShortlist } = await import('../src/shortlist.js');
      const record = await getShortlist('job-euro');
      expect(record.metadata.compensation).toBe('€95k');
    } finally {
      delete process.env.JOBBOT_SHORTLIST_CURRENCY;
    }
  });
});
