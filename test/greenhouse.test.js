import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';

const JOBS_DIR = 'jobs';

describe('Greenhouse ingest', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-greenhouse-'));
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

  it('fetches Greenhouse jobs and writes snapshots', async () => {
    const html = `
      <h1>Staff Engineer</h1>
      <p>Company: Example Corp</p>
      <p>Location: Remote</p>
      <h3>Requirements</h3>
      <ul>
        <li>Experience shipping production systems</li>
      </ul>
    `;
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        jobs: [
          {
            id: 123,
            title: 'Staff Engineer',
            location: { name: 'Remote' },
            absolute_url: 'https://boards.greenhouse.io/example/jobs/123',
            content: html,
            updated_at: '2025-04-05T06:07:08Z',
          },
        ],
      }),
    });

    const { ingestGreenhouseBoard } = await import('../src/greenhouse.js');

    const result = await ingestGreenhouseBoard({ board: 'example' });

    expect(fetch).toHaveBeenCalledWith(
      'https://boards.greenhouse.io/v1/boards/example/jobs?content=true',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'jobbot3000' }),
      }),
    );

    expect(result).toMatchObject({ board: 'example', saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(await fs.readFile(path.join(jobsDir, files[0]), 'utf8'));
    expect(saved.source).toMatchObject({
      type: 'greenhouse',
      value: 'https://boards.greenhouse.io/example/jobs/123',
    });
    expect(saved.source.headers).toEqual({ 'User-Agent': 'jobbot3000' });
    expect(saved.parsed.title).toBe('Staff Engineer');
    expect(saved.parsed.location).toBe('Remote');
    const hasRequirement = saved.parsed.requirements.some((req) =>
      req.includes('Experience shipping production systems'),
    );
    expect(hasRequirement).toBe(true);
    expect(saved.fetched_at).toBe('2025-04-05T06:07:08.000Z');
  });

  it('throws when the board fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });

    const { ingestGreenhouseBoard } = await import('../src/greenhouse.js');

    await expect(ingestGreenhouseBoard({ board: 'missing' })).rejects.toThrow(
      /Failed to fetch Greenhouse board/,
    );
  });
});
