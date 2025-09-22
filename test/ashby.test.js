import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';

const JOBS_DIR = 'jobs';

describe('Ashby ingest', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-ashby-'));
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

  it('fetches Ashby jobs and writes snapshots', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        jobPostings: [
          {
            id: 'senior-platform-engineer',
            title: 'Senior Platform Engineer',
            locationName: 'Remote - US',
            workplaceType: 'Remote',
            employmentType: 'FullTime',
            jobPostingUrl: 'https://jobs.ashbyhq.com/example/job/senior-platform-engineer',
            descriptionHtml: `
              <h1>Senior Platform Engineer</h1>
              <p>Build durable infrastructure.</p>
              <h3>Requirements</h3>
              <ul>
                <li>Go</li>
              </ul>
            `,
            descriptionText: `Senior Platform Engineer\nRequirements\n- Go`,
            updatedAt: '2025-03-04T05:06:07Z',
          },
        ],
      }),
    });

    const { ingestAshbyBoard } = await import('../src/ashby.js');

    const result = await ingestAshbyBoard({ org: 'example', rateLimitIntervalMs: 0 });

    const expectedUrl =
      'https://jobs.ashbyhq.com/api/postings?organizationSlug=example' +
      '&includeCompensation=true&includeUnlisted=false';

    expect(fetch).toHaveBeenCalledWith(
      expectedUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'jobbot3000',
          Accept: 'application/json',
        }),
      }),
    );

    expect(result).toMatchObject({ org: 'example', saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(await fs.readFile(path.join(jobsDir, files[0]), 'utf8'));
    expect(saved.source).toMatchObject({
      type: 'ashby',
      value: 'https://jobs.ashbyhq.com/example/job/senior-platform-engineer',
    });
    expect(saved.source.headers).toEqual({
      Accept: 'application/json',
      'User-Agent': 'jobbot3000',
    });
    expect(saved.parsed.title).toBe('Senior Platform Engineer');
    expect(saved.parsed.location).toBe('Remote - US');
    const hasRequirement = saved.parsed.requirements.some((req) => req.includes('Go'));
    expect(hasRequirement).toBe(true);
    expect(saved.fetched_at).toBe('2025-03-04T05:06:07.000Z');
  });

  it('throws when the org fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });

    const { ingestAshbyBoard } = await import('../src/ashby.js');

    await expect(
      ingestAshbyBoard({ org: 'missing', rateLimitIntervalMs: 0 })
    ).rejects.toThrow(/Failed to fetch Ashby org/);
  });
});
