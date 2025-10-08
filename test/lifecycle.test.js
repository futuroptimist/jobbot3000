import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, test, expect } from 'vitest';
import {
  recordApplication,
  getLifecycleCounts,
  getLifecycleBoard,
  getLifecycleEntry,
  listLifecycleEntries,
} from '../src/lifecycle.js';

let dataDir;

const ALL_STATUSES = [
  'no_response',
  'screening',
  'onsite',
  'offer',
  'rejected',
  'withdrawn',
  'next_round',
  'accepted',
  'acceptance',
  'hired',
];

const expectedCounts = (overrides = {}) => ({
  ...Object.fromEntries(ALL_STATUSES.map(status => [status, 0])),
  ...overrides,
});

beforeEach(async () => {
  // Allocate a throwaway lifecycle directory per test file so status mutations don't leak across
  // parallel workers.
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-lifecycle-'));
  process.env.JOBBOT_DATA_DIR = dataDir;
});

afterEach(async () => {
  if (dataDir) {
    await fs.rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
  delete process.env.JOBBOT_DATA_DIR;
});

test('records and summarizes application statuses', async () => {
  await recordApplication('abc', 'rejected', { date: '2025-02-01T10:00:00Z' });
  await recordApplication('def', 'no_response');
  await recordApplication('ghi', 'screening');
  const counts = await getLifecycleCounts();
  expect(counts).toEqual(
    expectedCounts({ rejected: 1, no_response: 1, screening: 1 })
  );
  const raw = await fs.readFile(path.join(dataDir, 'applications.json'), 'utf8');
  const parsed = JSON.parse(raw);
  expect(parsed.abc).toMatchObject({
    status: 'rejected',
    updated_at: '2025-02-01T10:00:00.000Z',
  });
  expect(parsed.def.status).toBe('no_response');
  expect(parsed.def.updated_at).toEqual(new Date(parsed.def.updated_at).toISOString());
  expect(parsed.ghi.status).toBe('screening');
});

test('stores optional notes alongside application statuses', async () => {
  await recordApplication('job-note', 'screening', {
    note: 'Emailed hiring manager',
    date: '2025-02-02T11:22:33Z',
  });

  const raw = await fs.readFile(path.join(dataDir, 'applications.json'), 'utf8');
  const parsed = JSON.parse(raw);
  expect(parsed['job-note']).toEqual({
    status: 'screening',
    note: 'Emailed hiring manager',
    updated_at: '2025-02-02T11:22:33.000Z',
  });
});

test('tracks core lifecycle and acceptance statuses', async () => {
  const entries = [
    ['job-screening', 'screening'],
    ['job-onsite', 'onsite'],
    ['job-offer', 'offer'],
    ['job-withdrawn', 'withdrawn'],
    ['job-accepted', 'accepted'],
    ['job-acceptance', 'acceptance'],
    ['job-hired', 'hired'],
  ];
  for (const [id, status] of entries) {
    await recordApplication(id, status);
  }
  const counts = await getLifecycleCounts();
  expect(counts).toEqual(
    expectedCounts({
      screening: 1,
      onsite: 1,
      offer: 1,
      withdrawn: 1,
      accepted: 1,
      acceptance: 1,
      hired: 1,
    })
  );
});

test('throws when lifecycle file has invalid JSON', async () => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'applications.json'), '{');
  await expect(recordApplication('ghi', 'rejected')).rejects.toThrow();
  await expect(getLifecycleCounts()).rejects.toThrow();
});

test('handles concurrent status updates across all lifecycle statuses', async () => {
  const entries = ALL_STATUSES.map((status, index) => [
    `job-${index}`,
    status,
  ]);
  await Promise.all(entries.map(([id, status]) => recordApplication(id, status)));
  const raw = JSON.parse(
    await fs.readFile(path.join(dataDir, 'applications.json'), 'utf8'),
  );
  for (const [id, status] of entries) {
    expect(raw[id].status).toBe(status);
    expect(raw[id].updated_at).toEqual(new Date(raw[id].updated_at).toISOString());
  }
  const expected = expectedCounts();
  for (const [, status] of entries) {
    expected[status] += 1;
  }
  const counts = await getLifecycleCounts();
  expect(counts).toEqual(expected);
});

test('returns zero counts when lifecycle file is missing', async () => {
  const counts = await getLifecycleCounts();
  expect(counts).toEqual(expectedCounts());
});

test('organizes lifecycle entries into ordered board columns', async () => {
  await recordApplication('job-screening-old', 'screening', {
    note: 'Waiting for recruiter reply',
    date: '2025-02-01T10:00:00Z',
  });
  await recordApplication('job-screening-new', 'screening', {
    date: '2025-02-03T09:00:00Z',
  });
  await recordApplication('job-offer', 'offer', {
    note: 'Review offer details',
    date: '2025-02-04T08:30:00Z',
  });

  // Legacy data: raw string values should still surface in the board without timestamps.
  const legacyPath = path.join(dataDir, 'applications.json');
  const raw = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
  raw['job-legacy'] = 'next_round';
  await fs.writeFile(legacyPath, JSON.stringify(raw, null, 2));

  const board = await getLifecycleBoard();
  expect(board[0]).toMatchObject({ status: 'no_response', jobs: [] });
  const screeningColumn = board.find(column => column.status === 'screening');
  expect(screeningColumn?.jobs.map(job => job.job_id)).toEqual([
    'job-screening-new',
    'job-screening-old',
  ]);
  expect(screeningColumn?.jobs[0]).toMatchObject({
    job_id: 'job-screening-new',
    status: 'screening',
    updated_at: '2025-02-03T09:00:00.000Z',
    note: undefined,
  });
  expect(screeningColumn?.jobs[1]).toMatchObject({
    job_id: 'job-screening-old',
    note: 'Waiting for recruiter reply',
  });

  const offerColumn = board.find(column => column.status === 'offer');
  expect(offerColumn?.jobs).toEqual([
    expect.objectContaining({
      job_id: 'job-offer',
      note: 'Review offer details',
      updated_at: '2025-02-04T08:30:00.000Z',
    }),
  ]);

  const nextRoundColumn = board.find(column => column.status === 'next_round');
  expect(nextRoundColumn?.jobs).toEqual([
    expect.objectContaining({ job_id: 'job-legacy', updated_at: undefined }),
  ]);
});

test('returns normalized lifecycle entries for track show', async () => {
  await recordApplication('job-detail', 'screening', {
    note: 'Awaiting hiring manager feedback',
    date: '2025-03-05T12:30:00Z',
  });

  const entry = await getLifecycleEntry('job-detail');
  expect(entry).toEqual({
    job_id: 'job-detail',
    status: 'screening',
    updated_at: '2025-03-05T12:30:00.000Z',
    note: 'Awaiting hiring manager feedback',
  });
});

test('returns null lifecycle entries for unknown jobs', async () => {
  const entry = await getLifecycleEntry('job-missing');
  expect(entry).toBeNull();
});

test('lists lifecycle entries with filters and pagination', async () => {
  await recordApplication('job-screening-old', 'screening', {
    date: '2025-02-02T09:00:00Z',
    note: 'Followed up with recruiter',
  });
  await recordApplication('job-screening-new', 'screening', {
    date: '2025-02-04T15:30:00Z',
  });
  await recordApplication('job-offer', 'offer', {
    date: '2025-02-05T12:00:00Z',
    note: 'Offer call scheduled',
  });
  await recordApplication('job-rejected', 'rejected', {
    date: '2025-01-20T08:00:00Z',
  });

  const pageOne = await listLifecycleEntries({
    statuses: ['screening', 'offer'],
    page: 1,
    pageSize: 2,
  });
  expect(pageOne.entries.map(entry => entry.job_id)).toEqual([
    'job-offer',
    'job-screening-new',
  ]);
  expect(pageOne.pagination).toEqual({
    page: 1,
    pageSize: 2,
    totalEntries: 3,
    totalPages: 2,
  });
  expect(pageOne.filters).toEqual({ statuses: ['screening', 'offer'] });

  const pageTwo = await listLifecycleEntries({
    statuses: ['screening', 'offer'],
    page: 2,
    pageSize: 2,
  });
  expect(pageTwo.entries.map(entry => entry.job_id)).toEqual(['job-screening-old']);
  expect(pageTwo.pagination.page).toBe(2);
  expect(pageTwo.pagination.totalPages).toBe(2);

  const unmatched = await listLifecycleEntries({ statuses: ['onsite'] });
  expect(unmatched.entries).toEqual([]);
  expect(unmatched.pagination.totalEntries).toBe(0);
  expect(unmatched.pagination.totalPages).toBe(0);
  expect(unmatched.filters).toEqual({ statuses: ['onsite'] });
});

test('ignores unknown statuses when summarizing lifecycle data', async () => {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'applications.json');
  const payload = {
    'job-known': 'no_response',
    'job-unknown': 'coffee_chat',
    'job-withdrawn': 'withdrawn',
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2));
  const counts = await getLifecycleCounts();
  expect(counts).toEqual(
    expectedCounts({ no_response: 1, withdrawn: 1 })
  );
});

test('rejects unknown application status', async () => {
  await expect(recordApplication('abc', 'maybe')).rejects.toThrow(
    /unknown status: maybe/,
  );
  await expect(
    fs.readFile(path.join(dataDir, 'applications.json')),
  ).rejects.toThrow();
});
