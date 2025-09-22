import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';

const JOBS_DIR = 'jobs';

describe('Workable ingest', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-workable-'));
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

  it('fetches Workable jobs and writes snapshots', async () => {
    const listPayload = {
      jobs: [
        {
          shortcode: 'abc123',
          title: 'Senior Platform Engineer',
          location: { location_str: 'Remote' },
          url: 'https://apply.workable.com/example/j/abc123/',
          updated_at: '2025-01-02T03:04:05Z',
        },
      ],
    };

    const detailPayload = {
      shortcode: 'abc123',
      title: 'Senior Platform Engineer',
      location: { location_str: 'Remote' },
      description: `
        <h1>Senior Platform Engineer</h1>
        <p>Build durable infrastructure.</p>
        <h3>Requirements</h3>
        <ul>
          <li>Go</li>
        </ul>
      `,
      updated_at: '2025-01-02T03:04:05Z',
    };

    fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => listPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => detailPayload,
      });

    const { ingestWorkableBoard } = await import('../src/workable.js');

    const result = await ingestWorkableBoard({ account: 'example', rateLimitIntervalMs: 0 });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://www.workable.com/api/accounts/example/jobs',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'jobbot3000',
          Accept: 'application/json',
        }),
      }),
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://www.workable.com/api/accounts/example/jobs/abc123',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'jobbot3000',
          Accept: 'application/json',
        }),
      }),
    );

    expect(result).toMatchObject({ account: 'example', saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(await fs.readFile(path.join(jobsDir, files[0]), 'utf8'));
    expect(saved.source).toMatchObject({
      type: 'workable',
      value: 'https://apply.workable.com/example/j/abc123/',
    });
    expect(saved.source.headers).toEqual({
      Accept: 'application/json',
      'User-Agent': 'jobbot3000',
    });
    expect(saved.parsed.title).toBe('Senior Platform Engineer');
    expect(saved.parsed.location).toBe('Remote');
    const hasRequirement = saved.parsed.requirements.some((req) => req.includes('Go'));
    expect(hasRequirement).toBe(true);
    expect(saved.fetched_at).toBe('2025-01-02T03:04:05.000Z');
  });

  it('throws when the account fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });

    const { ingestWorkableBoard } = await import('../src/workable.js');

    await expect(
      ingestWorkableBoard({ account: 'missing', rateLimitIntervalMs: 0 })
    ).rejects.toThrow(
      /Failed to fetch Workable account/,
    );
  });

  it('throws when a job detail fetch fails', async () => {
    const listPayload = {
      jobs: [
        {
          shortcode: 'abc123',
          title: 'Senior Platform Engineer',
          url: 'https://apply.workable.com/example/j/abc123/',
        },
      ],
    };

    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => listPayload,
    });

    const { ingestWorkableBoard } = await import('../src/workable.js');

    await expect(
      ingestWorkableBoard({
        account: 'example',
        retry: { delayMs: 0 },
        rateLimitIntervalMs: 0,
      })
    ).rejects.toThrow(
      /Failed to fetch Workable job/,
    );
  });
});
