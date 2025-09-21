import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, test, expect } from 'vitest';
import { recordApplication, getLifecycleCounts } from '../src/lifecycle.js';

let dataDir;

const ALL_STATUSES = [
  'no_response',
  'screening',
  'onsite',
  'offer',
  'rejected',
  'withdrawn',
  'next_round',
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

test('tracks screening, onsite, offer, and withdrawn statuses', async () => {
  const entries = [
    ['job-screening', 'screening'],
    ['job-onsite', 'onsite'],
    ['job-offer', 'offer'],
    ['job-withdrawn', 'withdrawn'],
  ];
  for (const [id, status] of entries) {
    await recordApplication(id, status);
  }
  const counts = await getLifecycleCounts();
  expect(counts).toEqual(
    expectedCounts({ screening: 1, onsite: 1, offer: 1, withdrawn: 1 })
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
