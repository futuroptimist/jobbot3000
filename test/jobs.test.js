import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/fetch.js', () => ({
  fetchTextFromUrl: vi.fn(),
  DEFAULT_FETCH_HEADERS: { 'User-Agent': 'jobbot3000' },
}));

let dataDir;

function jobsDir() {
  if (!dataDir) throw new Error('jobs data directory was not initialised');
  return path.join(dataDir, 'jobs');
}

async function readSnapshot(id) {
  const file = path.join(jobsDir(), `${id}.json`);
  const contents = await fs.readFile(file, 'utf8');
  return JSON.parse(contents);
}

describe('job snapshots', () => {
  beforeEach(async () => {
    // Each test gets its own snapshot workspace so concurrent workers don't interfere.
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-jobs-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
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

  it('ingests individual job URLs and persists snapshots with request metadata', async () => {
    const url = 'https://example.com/jobs/789';
    const { fetchTextFromUrl } = await import('../src/fetch.js');
    fetchTextFromUrl.mockResolvedValue(
      [
        'Title: Staff Engineer',
        'Company: Example Corp',
        'Location: Remote',
        'Requirements',
        '- Build reliable systems',
      ].join('\n'),
    );

    const { ingestJobUrl } = await import('../src/url-ingest.js');
    const result = await ingestJobUrl({ url });

    expect(fetchTextFromUrl).toHaveBeenCalledWith(url, {
      timeoutMs: 10000,
      headers: { 'User-Agent': 'jobbot3000' },
    });

    const snapshot = await readSnapshot(result.id);
    expect(snapshot.source).toEqual({
      type: 'url',
      value: url,
      headers: { 'User-Agent': 'jobbot3000' },
    });
    expect(snapshot.parsed).toMatchObject({
      title: 'Staff Engineer',
      company: 'Example Corp',
      location: 'Remote',
    });
    expect(snapshot.parsed.requirements).toEqual(['Build reliable systems']);
  });

  it('rejects unsupported URL protocols during ingestion', async () => {
    const { ingestJobUrl } = await import('../src/url-ingest.js');
    await expect(ingestJobUrl({ url: 'ftp://example.com/job.txt' })).rejects.toThrow(
      /must use http or https/i,
    );
  });
});
