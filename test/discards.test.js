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
});
