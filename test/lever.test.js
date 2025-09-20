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

  it('fetches Lever postings, normalizes HTML fragments, and writes snapshots', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: '123abc',
          text: 'Backend Engineer',
          categories: { location: 'Remote' },
          content: [
            '<p>Build APIs</p>',
            { text: '<p>Ship features fast</p>' },
          ],
          lists: [
            {
              text: 'Responsibilities',
              content: [
                '<ul><li>Scale services</li></ul>',
                { text: '<p>Maintain reliability</p>' },
              ],
            },
            {
              text: 'Qualifications',
              content: [{ content: '<ul><li>TypeScript experience</li></ul>' }],
            },
          ],
          descriptionPlain: 'More details about the role.',
          hostedUrl: 'https://jobs.lever.co/example/123abc',
          updatedAt: 1730419200000,
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
      value: 'https://jobs.lever.co/example/123abc',
    });
    expect(saved.parsed.title).toBe('Backend Engineer');
    expect(saved.parsed.location).toBe('Remote');
    expect(saved.raw).toContain('More details about the role.');
    expect(saved.raw).toContain('Maintain reliability');
    const requirements = saved.parsed.requirements.join(' ');
    expect(requirements).toContain('Scale services');
    expect(requirements).toContain('TypeScript experience');
    expect(saved.fetched_at).toBe('2024-11-01T00:00:00.000Z');
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

  it('falls back to derived hosted URLs and merges metadata from plain fields', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: 42,
          text: 'Data Engineer',
          lists: [
            {
              text: 'Responsibilities',
              content: ['<ul><li>Maintain pipelines</li></ul>'],
            },
          ],
          descriptionPlain: 'Data team focused role.',
          additional: ['<p>Bonus info</p>'],
          additionalPlain: 'Apply soon.',
          workplaceType: 'Hybrid - NYC',
          hostedUrl: '  ',
          createdAt: '2024-09-01T12:00:00Z',
        },
      ],
    });

    const { ingestLeverBoard } = await import('../src/lever.js');

    const result = await ingestLeverBoard({ org: ' Example Corp ' });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.lever.co/v0/postings/Example%20Corp?mode=json',
    );

    expect(result).toMatchObject({ org: 'Example Corp', saved: 1 });
    const [jobId] = result.jobIds;
    expect(jobId).toBeTruthy();

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const files = await fs.readdir(jobsDir);
    expect(files).toHaveLength(1);

    const saved = JSON.parse(await fs.readFile(path.join(jobsDir, files[0]), 'utf8'));
    expect(saved.source).toMatchObject({
      type: 'lever',
      value: 'https://jobs.lever.co/Example%20Corp/42',
    });
    expect(saved.parsed.location).toBe('Hybrid - NYC');
    expect(saved.raw).toContain('Data team focused role.');
    expect(saved.raw).toContain('Bonus info');
    expect(saved.raw).toContain('Apply soon.');
  });

  it('escapes plain text fields before wrapping them in HTML', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: 'escape-1',
          text: 'Quality & Safety <Lead>',
          descriptionPlain: 'Handle <edge> & "quoted" workflows.',
          additionalPlain: "It's great & safe.",
          createdAt: '2024-09-15T08:00:00Z',
        },
      ],
    });

    const { ingestLeverBoard } = await import('../src/lever.js');

    const result = await ingestLeverBoard({ org: 'escape-co' });

    expect(result).toMatchObject({ org: 'escape-co', saved: 1 });

    const jobsDir = path.join(dataDir, JOBS_DIR);
    const [file] = await fs.readdir(jobsDir);
    const saved = JSON.parse(await fs.readFile(path.join(jobsDir, file), 'utf8'));

    expect(saved.raw).toMatch(/Quality & Safety <Lead>/i);
    expect(saved.raw).toMatch(/Handle <edge> & "quoted" workflows\./);
    expect(saved.raw).toMatch(/It's great & safe\./);
  });
});
