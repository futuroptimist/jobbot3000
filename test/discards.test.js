import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const discardFileName = 'discarded_jobs.json';

let dataDir;

async function readDiscards() {
  const file = path.join(dataDir, discardFileName);
  const contents = await fs.readFile(file, 'utf8');
  return JSON.parse(contents);
}

describe('discarded job archive', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-discards-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
  });

  it('records discard reasons with ISO timestamps', async () => {
    const { recordJobDiscard, getDiscardedJobs } = await import('../src/discards.js');
    await recordJobDiscard('job-123', { reason: 'Not remote', date: '2025-01-02T03:04:05Z' });

    const archive = await readDiscards();
    expect(archive['job-123']).toEqual([
      {
        reason: 'Not remote',
        discarded_at: '2025-01-02T03:04:05.000Z',
      },
    ]);

    const byId = await getDiscardedJobs('job-123');
    expect(byId).toEqual(archive['job-123']);
  });

  it('returns the newest discard entry first', async () => {
    const { recordJobDiscard, getDiscardedJobs } = await import('../src/discards.js');
    await recordJobDiscard('job-ordered', {
      reason: 'Earlier concern',
      date: '2025-03-01T10:00:00Z',
    });
    await recordJobDiscard('job-ordered', {
      reason: 'Latest update',
      date: '2025-04-05T09:30:00Z',
    });

    const history = await getDiscardedJobs('job-ordered');
    expect(history.map(entry => entry.reason)).toEqual(['Latest update', 'Earlier concern']);
  });

  it('rejects missing job ids or reasons', async () => {
    const { recordJobDiscard } = await import('../src/discards.js');
    await expect(recordJobDiscard('', { reason: 'Missing' })).rejects.toThrow('job id is required');
    await expect(recordJobDiscard('job-456', { reason: '' })).rejects.toThrow('reason is required');
  });

  it('stores optional tags without duplicates', async () => {
    const { recordJobDiscard, getDiscardedJobs } = await import('../src/discards.js');
    await recordJobDiscard('job-tags', {
      reason: 'Not aligned',
      tags: ['Remote', 'remote', ''],
    });
    const entries = await getDiscardedJobs('job-tags');
    expect(entries[0].tags).toEqual(['Remote']);
  });

  it('deduplicates legacy tag history ignoring case', async () => {
    const archivePath = path.join(dataDir, discardFileName);
    const legacyArchive = {
      'job-legacy-tags': [
        {
          reason: 'Revisit later',
          discarded_at: '2025-04-10T09:00:00Z',
          tags: [' Remote ', 'remote', 'ONSITE', 'onsite'],
        },
      ],
    };

    await fs.writeFile(archivePath, `${JSON.stringify(legacyArchive, null, 2)}\n`);

    const { getDiscardedJobs } = await import('../src/discards.js');
    const history = await getDiscardedJobs('job-legacy-tags');
    expect(history).toEqual([
      {
        reason: 'Revisit later',
        discarded_at: '2025-04-10T09:00:00.000Z',
        tags: ['Remote', 'ONSITE'],
      },
    ]);
  });

  it('normalizes messy discard archive entries when reading history', async () => {
    const { getDiscardedJobs } = await import('../src/discards.js');

    const archivePath = path.join(dataDir, discardFileName);
    const messyArchive = {
      'job-1': [
        {
          reason: '  First impression ',
          discarded_at: '2025-04-02T10:00:00Z',
          tags: [' Remote ', '', 'onsite'],
        },
        {
          reason: '',
          discardedAt: 'not a date',
          tags: 'manual entry',
        },
        {
          reason: 'Legacy without time',
          tags: ['  '],
        },
        null,
        'junk',
      ],
      'job-2': [
        {
          reason: 'Earlier entry',
          discarded_at: '2025-04-01T09:15:00Z',
        },
      ],
    };

    await fs.writeFile(archivePath, `${JSON.stringify(messyArchive, null, 2)}\n`);

    const jobHistory = await getDiscardedJobs('job-1');
    expect(jobHistory).toEqual([
      {
        reason: 'First impression',
        discarded_at: '2025-04-02T10:00:00.000Z',
        tags: ['Remote', 'onsite'],
      },
      {
        reason: 'Unknown reason',
        discarded_at: 'not a date',
      },
      {
        reason: 'Legacy without time',
        discarded_at: 'unknown time',
      },
    ]);

    const archive = await getDiscardedJobs();
    expect(Object.keys(archive)).toEqual(['job-1', 'job-2']);
    expect(archive['job-2']).toEqual([
      {
        reason: 'Earlier entry',
        discarded_at: '2025-04-01T09:15:00.000Z',
      },
    ]);
  });
});
