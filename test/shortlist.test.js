import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  discardJob,
  getDiscardedJobs,
  setShortlistDataDir,
} from '../src/shortlist.js';

const FIXED_TIMESTAMP = '2025-01-02T03:04:05.000Z';

describe('shortlist discards', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-shortlist-'));
    setShortlistDataDir(dir);
  });

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
    setShortlistDataDir(undefined);
  });

  it('persists discard reasons with timestamps and keeps history per job', async () => {
    const first = await discardJob('job-1', 'not remote enough', {
      discardedAt: FIXED_TIMESTAMP,
    });
    expect(first).toMatchObject({
      jobId: 'job-1',
      reason: 'not remote enough',
      discardedAt: FIXED_TIMESTAMP,
    });

    const second = await discardJob('job-1', 'accepted another offer', {
      discardedAt: '2025-02-03T04:05:06.000Z',
    });
    expect(second.reason).toBe('accepted another offer');

    const history = await getDiscardedJobs('job-1');
    expect(history).toEqual([
      {
        jobId: 'job-1',
        reason: 'not remote enough',
        discardedAt: FIXED_TIMESTAMP,
      },
      {
        jobId: 'job-1',
        reason: 'accepted another offer',
        discardedAt: '2025-02-03T04:05:06.000Z',
      },
    ]);

    const raw = JSON.parse(
      await fs.readFile(path.join(dir, 'shortlist.json'), 'utf8')
    );
    expect(raw).toEqual({
      discards: {
        'job-1': history,
      },
    });
  });
});
