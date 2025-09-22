import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';

const JOBS_DIR = 'jobs';

describe('SmartRecruiters ingest', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-smartrecruiters-'));
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

  it('fetches SmartRecruiters jobs and writes snapshots', async () => {
    const postingUrl =
      'https://jobs.smartrecruiters.com/example/744000082406416-partner-development-manager';

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        offset: 0,
        limit: 100,
        totalFound: 1,
        content: [
          {
            id: '744000082406416',
            name: 'Partner Development Manager',
            releasedDate: '2025-09-17T09:30:30.267Z',
            ref: 'https://api.smartrecruiters.com/v1/companies/example/postings/744000082406416',
            postingUrl,
            location: { fullLocation: 'Remote, United Kingdom' },
          },
        ],
      }),
    });

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        name: 'Partner Development Manager',
        postingUrl,
        releasedDate: '2025-09-17T09:30:30.267Z',
        location: { fullLocation: 'Remote, United Kingdom' },
        jobAd: {
          sections: {
            jobDescription: {
              title: 'Job Description',
              text: '<p>Build scalable systems</p>',
            },
            qualifications: {
              title: 'Qualifications',
              text: '<ul><li>Experience shipping production systems</li></ul>',
            },
          },
        },
      }),
    });

    const { ingestSmartRecruitersBoard } = await import('../src/smartrecruiters.js');

    const result = await ingestSmartRecruitersBoard({
      company: 'example',
      rateLimitIntervalMs: 0,
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.smartrecruiters.com/v1/companies/example/postings?limit=100&offset=0',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'jobbot3000' }),
      }),
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.smartrecruiters.com/v1/companies/example/postings/744000082406416',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'jobbot3000' }),
      }),
    );

    expect(result).toMatchObject({ company: 'example', saved: 1 });
    expect(result.jobIds).toHaveLength(1);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(await fs.readFile(path.join(jobsDir, files[0]), 'utf8'));
    expect(saved.source).toMatchObject({
      type: 'smartrecruiters',
      value:
        'https://jobs.smartrecruiters.com/example/744000082406416-partner-development-manager',
    });
    expect(saved.parsed.title).toBe('Partner Development Manager');
    expect(saved.parsed.location).toBe('Remote, United Kingdom');
    const hasRequirement = saved.parsed.requirements.some((req) =>
      req.includes('Experience shipping production systems'),
    );
    expect(hasRequirement).toBe(true);
    expect(saved.fetched_at).toBe('2025-09-17T09:30:30.267Z');
  });

  it('throws when the postings fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    });

    const { ingestSmartRecruitersBoard } = await import('../src/smartrecruiters.js');

    await expect(
      ingestSmartRecruitersBoard({
        company: 'example',
        retry: { delayMs: 0 },
        rateLimitIntervalMs: 0,
      })
    ).rejects.toThrow(
      /Failed to fetch SmartRecruiters company example/,
    );
  });
});
