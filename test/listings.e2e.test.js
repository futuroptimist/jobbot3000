import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const shortlistMock = {
  syncShortlistJob: vi.fn(),
  addJobTags: vi.fn(),
};

vi.mock('../src/shortlist.js', () => shortlistMock);

const lifecycleMock = {
  getLifecycleEntry: vi.fn(),
  recordApplication: vi.fn(),
};

vi.mock('../src/lifecycle.js', async () => {
  const actual = await vi.importActual('../src/lifecycle.js');
  return {
    ...actual,
    getLifecycleEntry: lifecycleMock.getLifecycleEntry,
    recordApplication: lifecycleMock.recordApplication,
  };
});

const discardsMock = {
  getDiscardedJobs: vi.fn(),
  recordJobDiscard: vi.fn(),
};

vi.mock('../src/discards.js', () => discardsMock);

const { createCommandAdapter } = await import('../src/web/command-adapter.js');
const { startWebServer } = await import('../src/web/server.js');

describe('listings web endpoints (e2e)', () => {
  let tempDir;
  let previousDataDir;
  let server;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-web-listings-'));
    previousDataDir = process.env.JOBBOT_DATA_DIR;
    process.env.JOBBOT_DATA_DIR = tempDir;
    const sourcesDir = path.join(tempDir, 'listings');
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.writeFile(
      path.join(sourcesDir, 'sources.json'),
      JSON.stringify([
        { provider: 'greenhouse', identifier: 'acme', limit: 5 },
        { provider: 'lever', identifier: 'acme', limit: 5 },
      ]),
      'utf8',
    );
    discardsMock.getDiscardedJobs.mockResolvedValue({});
    discardsMock.recordJobDiscard.mockResolvedValue({
      reason: 'Archived listing',
      discarded_at: '2025-01-01T00:00:00Z',
    });
    shortlistMock.syncShortlistJob.mockResolvedValue({});
    shortlistMock.addJobTags.mockResolvedValue(['listing']);
    lifecycleMock.getLifecycleEntry.mockResolvedValue(null);
    lifecycleMock.recordApplication.mockResolvedValue('no_response');
    greenhouseAdapterMock.listOpenings.mockReset();
    greenhouseAdapterMock.normalizeJob.mockReset();
    leverAdapterMock.listOpenings.mockReset();
    leverAdapterMock.normalizeJob.mockReset();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (previousDataDir === undefined) {
      delete process.env.JOBBOT_DATA_DIR;
    } else {
      process.env.JOBBOT_DATA_DIR = previousDataDir;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    vi.clearAllMocks();
  });

  it('fetches aggregated listings and ingests a role via HTTP', async () => {
    greenhouseAdapterMock.listOpenings.mockResolvedValue({
      jobs: [{ id: 1 }],
      context: { slug: 'acme' },
    });
    greenhouseAdapterMock.normalizeJob.mockResolvedValue({
      id: 'job-greenhouse',
      raw: 'Greenhouse role',
      parsed: {
        title: 'Software Engineer',
        company: 'Acme',
        location: 'Remote',
        requirements: ['Build systems'],
        body: 'Greenhouse role',
        compensation: '$120k',
      },
      source: { value: 'https://example.com/greenhouse' },
      fetchedAt: '2025-01-02T00:00:00Z',
    });

    leverAdapterMock.listOpenings.mockResolvedValue({
      jobs: [{ id: 2 }],
      context: { slug: 'acme' },
    });
    leverAdapterMock.normalizeJob.mockResolvedValue({
      id: 'job-lever',
      raw: 'Lever role',
      parsed: {
        title: 'Staff Engineer',
        company: 'Acme',
        location: 'Austin',
        requirements: ['Scale services'],
        body: 'Lever role',
        compensation: '$180k',
      },
      source: { value: 'https://example.com/lever' },
      fetchedAt: '2025-01-03T00:00:00Z',
    });

    const commandAdapter = createCommandAdapter();
    server = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      csrfToken: 'test-csrf-token',
      commandAdapter,
    });

    const headers = {
      'content-type': 'application/json',
      [server.csrfHeaderName]: server.csrfToken,
    };

    const fetchResponse = await fetch(`${server.url}/commands/listings-fetch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'all', title: 'Engineer', limit: 5 }),
    });

    expect(fetchResponse.status).toBe(200);
    const fetchPayload = await fetchResponse.json();
    expect(fetchPayload.command).toBe('listings-fetch');
    expect(fetchPayload.data.listings).toHaveLength(2);
    const [firstListing] = fetchPayload.data.listings;
    expect(firstListing.provider).toBe('lever');
    expect(firstListing.identifier).toBe('acme');

    const ingestResponse = await fetch(`${server.url}/commands/listings-ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: firstListing.provider,
        identifier: firstListing.identifier,
        jobId: firstListing.jobId,
      }),
    });

    expect(ingestResponse.status).toBe(200);
    const ingestPayload = await ingestResponse.json();
    expect(ingestPayload.data.listing.ingested).toBe(true);

    const snapshotPath = path.join(tempDir, 'jobs', `${firstListing.jobId}.json`);
    const snapshotRaw = await fs.readFile(snapshotPath, 'utf8');
    const snapshot = JSON.parse(snapshotRaw);
    expect(snapshot.id).toBe(firstListing.jobId);
    expect(snapshot.source.value).toBe('https://example.com/lever');
  });
});
