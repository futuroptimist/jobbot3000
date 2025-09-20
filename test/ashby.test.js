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

  it('fetches Ashby postings, flattens nested sections, and writes snapshots', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        jobBoard: {
          sections: [
            {
              title: 'Engineering',
              jobs: [
                {
                  id: 'job-1',
                  title: 'Senior Backend Engineer',
                  primaryLocation: { name: 'Remote - US' },
                  descriptionHtml: '<p>Build APIs</p>',
                  sections: [
                    {
                      heading: 'Responsibilities',
                      content: [
                        '<ul><li>Scale services</li></ul>',
                        { html: '<p>Own incidents</p>' },
                        { text: 'Collaborate cross-functionally' },
                        { items: ['<li>Pair program weekly</li>', { text: 'Mentor teammates' }] },
                      ],
                    },
                    {
                      title: 'Qualifications',
                      content: [
                        { html: '<ul><li>5+ years Node.js</li></ul>' },
                        { text: 'Experience with GraphQL' },
                      ],
                    },
                  ],
                  additionalText: 'Nice to have: distributed systems.',
                  jobUrl: 'https://jobs.ashbyhq.com/example/job/job-1',
                  updatedAt: '2024-11-05T10:00:00Z',
                },
                {
                  id: 'job 3',
                  title: 'Data Analyst',
                  locationText: 'Toronto, Canada',
                  descriptionHtml: '<p>Analyze data.</p>',
                  sections: [],
                  postedAt: 1730419200000,
                },
              ],
              sections: [
                {
                  title: 'Support',
                  postings: [
                    {
                      id: 'job-2',
                      title: 'Support Specialist',
                      location: { text: 'Austin, TX' },
                      descriptionText: 'Assist customers.',
                      contentSections: [
                        {
                          name: 'Responsibilities',
                          items: ['<p>Handle tickets</p>', { text: 'Document feedback' }],
                        },
                      ],
                      applyUrl: 'https://jobs.ashbyhq.com/example/job/job-2',
                      postedAt: '2024-10-01T08:00:00Z',
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    });

    const { ingestAshbyBoard } = await import('../src/ashby.js');

    const result = await ingestAshbyBoard({ org: ' Example Org ' });

    expect(fetch).toHaveBeenCalledWith(
      'https://jobs.ashbyhq.com/api/non-embed/company/Example%20Org?includeCompensation=true',
    );

    expect(result).toMatchObject({ org: 'Example Org', saved: 3 });
    expect(result.jobIds).toHaveLength(3);

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(3);

    const savedByTitle = {};
    for (const file of files) {
      const saved = JSON.parse(await fs.readFile(path.join(jobsDir, file), 'utf8'));
      savedByTitle[saved.parsed.title] = saved;
    }

    const backend = savedByTitle['Senior Backend Engineer'];
    expect(backend).toBeTruthy();
    expect(backend.source).toMatchObject({
      type: 'ashby',
      value: 'https://jobs.ashbyhq.com/example/job/job-1',
    });
    expect(backend.parsed.location).toBe('Remote - US');
    expect(backend.raw).toContain('Scale services');
    expect(backend.raw).toContain('Mentor teammates');
    expect(backend.raw).toContain('Nice to have: distributed systems.');
    expect(backend.fetched_at).toBe('2024-11-05T10:00:00.000Z');

    const support = savedByTitle['Support Specialist'];
    expect(support).toBeTruthy();
    expect(support.source.value).toBe('https://jobs.ashbyhq.com/example/job/job-2');
    expect(support.parsed.location).toBe('Austin, TX');
    expect(support.raw).toContain('Handle tickets');
    expect(support.raw).toContain('Document feedback');
    expect(support.fetched_at).toBe('2024-10-01T08:00:00.000Z');

    const analyst = savedByTitle['Data Analyst'];
    expect(analyst).toBeTruthy();
    expect(analyst.source.value).toBe(
      'https://jobs.ashbyhq.com/Example%20Org/job/job%203',
    );
    expect(analyst.parsed.location).toBe('Toronto, Canada');
    expect(analyst.raw).toContain('Analyze data.');
    expect(analyst.fetched_at).toBe('2024-11-01T00:00:00.000Z');
  });

  it('throws when the org fetch fails', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });

    const { ingestAshbyBoard } = await import('../src/ashby.js');

    await expect(ingestAshbyBoard({ org: 'missing' })).rejects.toThrow(
      /Failed to fetch Ashby org/,
    );
  });
});
