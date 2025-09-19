import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const dataDir = path.resolve('test', 'tmp-data');
const jobsDir = path.join(dataDir, 'jobs');

async function readSnapshot(id) {
  const file = path.join(jobsDir, `${id}.json`);
  const contents = await fs.readFile(file, 'utf8');
  return JSON.parse(contents);
}

describe('job snapshots', () => {
  beforeEach(async () => {
    process.env.JOBBOT_DATA_DIR = dataDir;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('persists raw and parsed listings with metadata under data/jobs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-02T03:04:05Z'));
    const { saveJobSnapshot, jobIdFromSource } = await import('../src/jobs.js');
    const source = 'https://example.com/jobs/123';
    const id = jobIdFromSource(source);
    await saveJobSnapshot({
      id,
      raw: '<p>Hello</p>',
      parsed: { title: 'Engineer', requirements: ['JS'] },
      source: { type: 'url', value: source },
      requestHeaders: { 'User-Agent': 'jobbot' },
    });

    const snapshot = await readSnapshot(id);
    expect(snapshot).toEqual({
      id,
      fetched_at: '2025-01-02T03:04:05.000Z',
      raw: '<p>Hello</p>',
      parsed: { title: 'Engineer', requirements: ['JS'] },
      source: {
        type: 'url',
        value: source,
        headers: { 'User-Agent': 'jobbot' },
      },
    });
  });

  it('overwrites existing snapshots for the same job id', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-04-05T06:07:08Z'));
    const { saveJobSnapshot, jobIdFromSource } = await import('../src/jobs.js');
    const id = jobIdFromSource('https://example.com/jobs/456');
    await saveJobSnapshot({
      id,
      raw: 'old',
      parsed: { title: 'Old' },
      source: { type: 'url', value: 'https://example.com/jobs/456' },
    });

    vi.setSystemTime(new Date('2025-04-05T07:08:09Z'));
    await saveJobSnapshot({
      id,
      raw: 'new',
      parsed: { title: 'New' },
      source: { type: 'url', value: 'https://example.com/jobs/456' },
    });

    const snapshot = await readSnapshot(id);
    expect(snapshot.raw).toBe('new');
    expect(snapshot.parsed).toEqual({ title: 'New' });
    expect(snapshot.fetched_at).toBe('2025-04-05T07:08:09.000Z');
  });
});
