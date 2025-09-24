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
    expect(store.jobs['job-metadata'].discard_count).toBe(0);

    const byFilters = await filterShortlist({ location: 'remote', level: 'senior' });
    expect(Object.keys(byFilters.jobs)).toEqual(['job-metadata']);
    expect(byFilters.jobs['job-metadata'].discard_count).toBe(0);
  });

  it('updates the synced timestamp when only syncedAt metadata is provided', async () => {
    const { syncShortlistJob, getShortlist } = await import('../src/shortlist.js');

    await syncShortlistJob('job-timestamp', {
      location: 'Remote',
      syncedAt: '2025-05-01T09:00:00Z',
    });

    await syncShortlistJob('job-timestamp', { syncedAt: '2025-05-02T11:30:00Z' });

    const record = await getShortlist('job-timestamp');
    expect(record.metadata).toMatchObject({
      location: 'Remote',
      synced_at: '2025-05-02T11:30:00.000Z',
    });
  });

  it('touches shortlist metadata when metadata is omitted', async () => {
    const { syncShortlistJob, getShortlist } = await import('../src/shortlist.js');

    const before = Date.now();
    await syncShortlistJob('job-touch-api');
    const created = await getShortlist('job-touch-api');
    expect(typeof created.metadata.synced_at).toBe('string');
    const createdTimestamp = new Date(created.metadata.synced_at).getTime();
    expect(Number.isNaN(createdTimestamp)).toBe(false);
    expect(createdTimestamp).toBeGreaterThanOrEqual(before - 10);

    await syncShortlistJob('job-touch-api', { location: 'Remote' });
    const withMetadata = await getShortlist('job-touch-api');
    expect(withMetadata.metadata).toMatchObject({ location: 'Remote' });
    const firstTimestamp = new Date(withMetadata.metadata.synced_at).getTime();
    expect(Number.isNaN(firstTimestamp)).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 5));

    await syncShortlistJob('job-touch-api');
    const touched = await getShortlist('job-touch-api');
    expect(touched.metadata).toMatchObject({ location: 'Remote' });
    const touchedTimestamp = new Date(touched.metadata.synced_at).getTime();
    expect(Number.isNaN(touchedTimestamp)).toBe(false);
    expect(touchedTimestamp).toBeGreaterThan(firstTimestamp);
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

  it('deduplicates shortlist tags ignoring case', async () => {
    const { addJobTags, getShortlist } = await import('../src/shortlist.js');

    await addJobTags('job-dedupe', ['Remote']);
    await addJobTags('job-dedupe', ['remote', 'REMOTE', 'Hybrid']);

    const record = await getShortlist('job-dedupe');
    expect(record.tags).toEqual(['Remote', 'Hybrid']);
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
    expect(record.discard_count).toBe(0);

    const filtered = await filterShortlist({ compensation: '$120k' });
    expect(Object.keys(filtered.jobs)).toEqual(['job-legacy']);
    expect(filtered.jobs['job-legacy'].discard_count).toBe(0);
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
      expect(record.discard_count).toBe(0);
    } finally {
      delete process.env.JOBBOT_SHORTLIST_CURRENCY;
    }
  });

  it('exposes the latest discard summary alongside shortlist entries', async () => {
    const { discardJob, getShortlist, filterShortlist } = await import('../src/shortlist.js');

    await discardJob('job-history', 'Not remote', {
      tags: ['Remote', 'onsite'],
      date: '2025-03-05T12:00:00Z',
    });

    await discardJob('job-history', 'Focus changed', {
      tags: ['Focus', 'focus', ' remote '],
      date: '2025-03-07T09:30:00Z',
    });

    const snapshot = await getShortlist('job-history');
    expect(snapshot.last_discard).toEqual({
      reason: 'Focus changed',
      discarded_at: '2025-03-07T09:30:00.000Z',
      tags: ['Focus', 'remote'],
    });
    expect(snapshot.discard_count).toBe(2);

    const filtered = await filterShortlist();
    expect(filtered.jobs['job-history'].last_discard).toEqual({
      reason: 'Focus changed',
      discarded_at: '2025-03-07T09:30:00.000Z',
      tags: ['Focus', 'remote'],
    });
    expect(filtered.jobs['job-history'].discard_count).toBe(2);
  });
});
