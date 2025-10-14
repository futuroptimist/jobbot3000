import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const greenhouseAdapterMock = {
  listOpenings: vi.fn(),
  normalizeJob: vi.fn(),
};

vi.mock('../src/greenhouse.js', () => ({
  greenhouseAdapter: greenhouseAdapterMock,
}));

const leverAdapterMock = {
  listOpenings: vi.fn(),
  normalizeJob: vi.fn(),
};

vi.mock('../src/lever.js', () => ({
  leverAdapter: leverAdapterMock,
}));

const ashbyAdapterMock = {
  listOpenings: vi.fn(),
  normalizeJob: vi.fn(),
};

vi.mock('../src/ashby.js', () => ({
  ashbyAdapter: ashbyAdapterMock,
}));

const smartRecruitersAdapterMock = {
  listOpenings: vi.fn(),
  normalizeJob: vi.fn(),
};

vi.mock('../src/smartrecruiters.js', () => ({
  smartRecruitersAdapter: smartRecruitersAdapterMock,
}));

const workableAdapterMock = {
  listOpenings: vi.fn(),
  normalizeJob: vi.fn(),
};

vi.mock('../src/workable.js', () => ({
  workableAdapter: workableAdapterMock,
}));

const shortlistMock = {
  syncShortlistJob: vi.fn(),
  addJobTags: vi.fn(),
};

vi.mock('../src/shortlist.js', () => shortlistMock);

const jobsMock = {
  saveJobSnapshot: vi.fn(),
};

vi.mock('../src/jobs.js', () => jobsMock);

const lifecycleMock = {
  getLifecycleEntry: vi.fn(),
  recordApplication: vi.fn(),
};

vi.mock('../src/lifecycle.js', () => lifecycleMock);

const discardsMock = {
  getDiscardedJobs: vi.fn(),
  recordJobDiscard: vi.fn(),
};

vi.mock('../src/discards.js', () => discardsMock);

const {
  listListingProviders,
  fetchListings,
  ingestListing,
  archiveListing,
} = await import('../src/listings.js');

describe('listings module', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-listings-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
    greenhouseAdapterMock.listOpenings.mockReset();
    greenhouseAdapterMock.normalizeJob.mockReset();
    leverAdapterMock.listOpenings.mockReset();
    leverAdapterMock.normalizeJob.mockReset();
    ashbyAdapterMock.listOpenings.mockReset();
    ashbyAdapterMock.normalizeJob.mockReset();
    smartRecruitersAdapterMock.listOpenings.mockReset();
    smartRecruitersAdapterMock.normalizeJob.mockReset();
    workableAdapterMock.listOpenings.mockReset();
    workableAdapterMock.normalizeJob.mockReset();
    shortlistMock.syncShortlistJob.mockReset();
    shortlistMock.addJobTags.mockReset();
    jobsMock.saveJobSnapshot.mockReset();
    lifecycleMock.getLifecycleEntry.mockReset();
    lifecycleMock.recordApplication.mockReset();
    discardsMock.getDiscardedJobs.mockReset();
    discardsMock.recordJobDiscard.mockReset();
    discardsMock.getDiscardedJobs.mockResolvedValue({});
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
    vi.clearAllMocks();
  });

  it('lists supported providers', () => {
    const providers = listListingProviders();
    const ids = providers.map(entry => entry.id);
    expect(providers[0]?.id).toBe('all');
    expect(providers[0]?.requiresIdentifier).toBe(false);
    expect(ids).toContain('greenhouse');
    expect(ids).toContain('lever');
    expect(providers.find(entry => entry.id === 'greenhouse')?.identifierKey).toBe('board');
    expect(providers.find(entry => entry.id === 'greenhouse')?.requiresIdentifier).toBe(true);
  });

  it('fetches listings and marks ingested and archived state', async () => {
    const jobsDir = path.join(dataDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'job-123.json'), '{}');

    discardsMock.getDiscardedJobs.mockResolvedValue({
      'job-999': [{ reason: 'Archived listing', discarded_at: '2025-01-01T00:00:00Z' }],
    });

    greenhouseAdapterMock.listOpenings.mockResolvedValue({
      jobs: [
        { id: 1 },
        { id: 2 },
      ],
      context: { slug: 'acme' },
    });

    greenhouseAdapterMock.normalizeJob.mockImplementation(async job => {
      const base = {
        raw: 'Role description',
        parsed: {
          title: job.id === 1 ? 'Senior Engineer' : 'Staff Engineer',
          company: 'Acme',
          location: job.id === 1 ? 'Remote' : 'New York',
          requirements: ['Build reliable systems'],
          body: 'Role description',
        },
        source: { value: `https://example.com/${job.id}` },
        fetchedAt: '2025-01-01T00:00:00Z',
      };
      return job.id === 1 ? { id: 'job-123', ...base } : { id: 'job-999', ...base };
    });

    const result = await fetchListings({
      provider: 'greenhouse',
      identifier: 'acme',
      location: 'Remote',
    });

    expect(greenhouseAdapterMock.listOpenings).toHaveBeenCalledWith({ board: 'acme' });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].jobId).toBe('job-123');
    expect(result.listings[0].ingested).toBe(true);
    expect(result.listings[0].archived).toBe(false);

    const secondResult = await fetchListings({ provider: 'greenhouse', identifier: 'acme' });
    const archivedEntry = secondResult.listings.find(item => item.jobId === 'job-999');
    expect(archivedEntry?.archived).toBe(true);
  });

  it('aggregates listings across configured providers', async () => {
    const configDir = path.join(dataDir, 'listings');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'sources.json'),
      JSON.stringify([
        { provider: 'greenhouse', identifier: 'acme', limit: 5 },
        { provider: 'lever', identifier: 'acme', limit: 5 },
      ]),
      'utf8',
    );

    greenhouseAdapterMock.listOpenings.mockResolvedValue({
      jobs: [{ id: 1 }],
      context: { slug: 'acme' },
    });
    greenhouseAdapterMock.normalizeJob.mockImplementation(async () => ({
      id: 'job-greenhouse',
      raw: 'Greenhouse role',
      parsed: {
        title: 'Software Engineer',
        company: 'Acme',
        location: 'Remote',
        requirements: ['Build systems'],
        body: 'Greenhouse role',
        compensation: '$100k',
      },
      source: { value: 'https://example.com/greenhouse' },
      fetchedAt: '2025-01-02T00:00:00Z',
    }));

    leverAdapterMock.listOpenings.mockResolvedValue({
      jobs: [{ id: 2 }],
      context: { slug: 'acme' },
    });
    leverAdapterMock.normalizeJob.mockImplementation(async () => ({
      id: 'job-lever',
      raw: 'Lever role',
      parsed: {
        title: 'Staff Software Engineer',
        company: 'Acme',
        location: 'Austin',
        requirements: ['Scale services'],
        body: 'Lever role',
        compensation: '$180k',
      },
      source: { value: 'https://example.com/lever' },
      fetchedAt: '2025-01-03T00:00:00Z',
    }));

    const result = await fetchListings({ provider: 'all', title: 'Engineer', limit: 10 });

    expect(result.provider).toBe('all');
    expect(result.identifier).toBe('');
    expect(result.total).toBe(2);
    expect(result.listings).toHaveLength(2);
    expect(result.listings.map(item => item.jobId)).toEqual(['job-lever', 'job-greenhouse']);
    expect(result.listings.every(item => item.ingested === false)).toBe(true);
    expect(result.listings[0].provider).toBe('lever');
    expect(result.listings[1].provider).toBe('greenhouse');
  });

  it('ingests a listing and triggers tracking side effects', async () => {
    greenhouseAdapterMock.listOpenings.mockResolvedValue({
      jobs: [{ id: 1 }, { id: 2 }],
      context: { slug: 'acme' },
    });

    const snapshots = {
      1: {
        id: 'job-aaa',
        raw: 'First role',
        parsed: {
          title: 'First Role',
          company: 'Acme',
          location: 'Remote',
          requirements: [],
          body: 'First role',
        },
        source: { value: 'https://example.com/1' },
      },
      2: {
        id: 'job-bbb',
        raw: 'Second role',
        parsed: {
          title: 'Second Role',
          company: 'Acme',
          location: 'Remote',
          requirements: [],
          body: 'Second role',
        },
        source: { value: 'https://example.com/2' },
      },
    };

    greenhouseAdapterMock.normalizeJob.mockImplementation(async job => snapshots[job.id]);
    lifecycleMock.getLifecycleEntry
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ job_id: 'job-bbb', status: 'no_response' });
    shortlistMock.syncShortlistJob.mockResolvedValue({});
    shortlistMock.addJobTags.mockResolvedValue(['listing', 'greenhouse']);
    jobsMock.saveJobSnapshot.mockResolvedValue();
    lifecycleMock.recordApplication.mockResolvedValue('no_response');

    const result = await ingestListing({
      provider: 'greenhouse',
      identifier: 'acme',
      jobId: 'job-bbb',
    });

    expect(jobsMock.saveJobSnapshot).toHaveBeenCalledWith(snapshots[2]);
    expect(shortlistMock.syncShortlistJob).toHaveBeenCalledWith(
      'job-bbb',
      expect.objectContaining({ location: 'Remote' }),
    );
    expect(shortlistMock.addJobTags).toHaveBeenCalledWith('job-bbb', ['listing', 'greenhouse']);
    expect(lifecycleMock.recordApplication).toHaveBeenCalledWith(
      'job-bbb',
      'no_response',
      expect.objectContaining({ note: expect.any(String) }),
    );
    expect(result.listing.ingested).toBe(true);
    expect(result.listing.archived).toBe(false);
  });

  it('archives a listing with default reason', async () => {
    const archivedAt = '2025-02-03T04:05:06Z';
    discardsMock.recordJobDiscard.mockResolvedValue({
      reason: 'Archived listing',
      discarded_at: archivedAt,
    });

    const result = await archiveListing({ jobId: 'job-xyz' });

    expect(discardsMock.recordJobDiscard).toHaveBeenCalledWith(
      'job-xyz',
      expect.objectContaining({ reason: 'Archived listing' }),
    );
    expect(result.archived_at).toBe(archivedAt);
  });
});

