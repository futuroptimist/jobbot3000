import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';

const JOBS_DIR = 'jobs';

describe('Lever ingest', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-lever-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
    fetch.mockReset();
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
  });

  it('fetches Lever jobs and writes snapshots', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: 'abc123',
          text: 'Senior Platform Engineer',
          hostedUrl: 'https://jobs.lever.co/example/abc123',
          descriptionPlain: `
Title: Senior Platform Engineer
Company: Example Corp
Location: Remote
Requirements
- Ship reliable systems
`,
          categories: { location: 'Remote' },
          updatedAt: '2025-01-02T03:04:05Z',
        },
      ],
    });

    const { ingestLeverBoard } = await import('../src/lever.js');

    const result = await ingestLeverBoard({ org: 'example' });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.lever.co/v0/postings/example?mode=json',
    );

    expect(result).toMatchObject({ org: 'example', saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(await fs.readFile(path.join(jobsDir, files[0]), 'utf8'));
    expect(saved.source).toMatchObject({
      type: 'lever',
      value: 'https://jobs.lever.co/example/abc123',
    });
    expect(saved.parsed.title).toBe('Senior Platform Engineer');
    expect(saved.parsed.location).toBe('Remote');
    expect(saved.fetched_at).toBe('2025-01-02T03:04:05.000Z');
  });

  it('throws when the org fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });

    const { ingestLeverBoard } = await import('../src/lever.js');

    await expect(ingestLeverBoard({ org: 'missing' })).rejects.toThrow(
      /Failed to fetch Lever org/,
    );
  });
});
