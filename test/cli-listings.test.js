import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/listings.js', () => ({
  listListingProviders: vi.fn(),
  fetchListings: vi.fn(),
  ingestListing: vi.fn(),
  archiveListing: vi.fn(),
}));

const cliModule = await import('../bin/jobbot.js');
const listingsModule = await import('../src/listings.js');

describe('jobbot listings CLI surface', () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exposes providers command with text and JSON output', async () => {
    listingsModule.listListingProviders.mockReturnValue([
      {
        id: 'all',
        label: 'All providers',
        identifierLabel: 'Saved sources',
        requiresIdentifier: false,
      },
      {
        id: 'greenhouse',
        label: 'Greenhouse',
        identifierLabel: 'Board slug',
        requiresIdentifier: true,
        placeholder: 'acme-co',
      },
    ]);

    expect(typeof cliModule.cmdListingsProviders).toBe('function');
    await cliModule.cmdListingsProviders([]);
    const textOutput = logSpy.mock.calls.map(call => call[0]).join('\n');
    expect(textOutput).toMatch(/All providers/);
    expect(textOutput).toMatch(/identifier/i);

    logSpy.mockClear();
    await cliModule.cmdListingsProviders(['--json']);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(Array.isArray(payload.providers)).toBe(true);
    expect(payload.providers[0].id).toBe('all');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fetches listings with filters and prints summaries', async () => {
    listingsModule.fetchListings.mockResolvedValue({
      provider: 'greenhouse',
      identifier: 'acme',
      fetched_at: '2025-01-01T00:00:00Z',
      total: 1,
      listings: [
        {
          jobId: 'job-123',
          title: 'Senior Engineer',
          company: 'Acme',
          location: 'Remote',
          compensation: '$120k',
          remote: true,
          url: 'https://example.com/job-123',
          ingested: false,
          archived: false,
          requirements: ['Work across the stack'],
        },
      ],
    });

    expect(typeof cliModule.cmdListingsFetch).toBe('function');
    await cliModule.cmdListingsFetch([
      '--provider',
      'greenhouse',
      '--identifier',
      'acme',
      '--location',
      'Remote',
    ]);

    const lines = logSpy.mock.calls.flat().join('\n');
    expect(lines).toMatch(/greenhouse/i);
    expect(lines).toMatch(/job-123/);
    expect(lines).toMatch(/Senior Engineer/);
    expect(lines).toMatch(/Remote/);

    logSpy.mockClear();
    await cliModule.cmdListingsFetch([
      '--provider',
      'greenhouse',
      '--identifier',
      'acme',
      '--json',
    ]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
    expect(jsonOutput.provider).toBe('greenhouse');
    expect(jsonOutput.listings).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ingests and archives listings with CLI wrappers', async () => {
    listingsModule.ingestListing.mockResolvedValue({
      jobId: 'job-123',
      listing: {
        jobId: 'job-123',
        title: 'Senior Engineer',
        company: 'Acme',
        provider: 'greenhouse',
        identifier: 'acme',
        ingested: true,
        archived: false,
      },
    });

    expect(typeof cliModule.cmdListingsIngest).toBe('function');
    await cliModule.cmdListingsIngest([
      'job-123',
      '--provider',
      'greenhouse',
      '--identifier',
      'acme',
    ]);
    const ingestText = logSpy.mock.calls.map(call => call[0]).join('\n');
    expect(ingestText).toMatch(/Ingested/);
    expect(ingestText).toMatch(/job-123/);

    logSpy.mockClear();
    await cliModule.cmdListingsIngest([
      'job-123',
      '--provider',
      'greenhouse',
      '--identifier',
      'acme',
      '--json',
    ]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const ingestPayload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(ingestPayload.listing.ingested).toBe(true);

    listingsModule.archiveListing.mockResolvedValue({
      jobId: 'job-123',
      archived_at: '2025-01-05T10:00:00Z',
      reason: 'Filled',
    });

    expect(typeof cliModule.cmdListingsArchive).toBe('function');
    logSpy.mockClear();
    await cliModule.cmdListingsArchive(['job-123', '--reason', 'Filled']);
    const archiveText = logSpy.mock.calls.map(call => call[0]).join('\n');
    expect(archiveText).toMatch(/Archived/);
    expect(archiveText).toMatch(/Filled/);

    logSpy.mockClear();
    await cliModule.cmdListingsArchive(['job-123', '--json']);
    const archivePayload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(archivePayload.jobId).toBe('job-123');
  });
});
