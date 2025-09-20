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

  it('fetches Lever postings and writes snapshots', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: 'abc123',
          text: 'Senior Backend Engineer',
          hostedUrl: 'https://jobs.lever.co/example/abc123',
          categories: { location: 'Remote', commitment: 'Full-time' },
          description: `
            <h2>About the role</h2>
            <p>Help build reliable services.</p>
            <h3>Requirements</h3>
            <ul>
              <li>Design distributed systems</li>
            </ul>
          `,
          lists: {
            requirements: [
              { text: '<li>Own Node.js services</li>' },
              { content: '<li>Coach teammates</li>' },
            ],
          },
          updatedAt: 1751993411000,
        },
      ],
    });

    const { ingestLeverBoard } = await import('../src/lever.js');

    const result = await ingestLeverBoard({ org: 'example' });

    expect(fetch).toHaveBeenCalledWith('https://api.lever.co/v0/postings/example?mode=json');

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
    expect(saved.parsed.title).toBe('Senior Backend Engineer');
    expect(saved.parsed.location).toBe('Remote');
    expect(saved.parsed.requirements).toEqual([
      'Design distributed systems',
      'Own Node.js services',
      'Coach teammates',
    ]);
    expect(saved.fetched_at).toBe(new Date(1751993411000).toISOString());
  });

  it('throws when the postings fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'Not Found' }),
    });

    const { ingestLeverBoard } = await import('../src/lever.js');

    await expect(ingestLeverBoard({ org: 'missing' })).rejects.toThrow(
      /Failed to fetch Lever postings/
    );
  });
});
