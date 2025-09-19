import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, test, expect } from 'vitest';
import { recordApplication, getLifecycleCounts } from '../src/lifecycle.js';

const tmp = path.resolve('test', 'tmp-data');

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
  process.env.JOBBOT_DATA_DIR = tmp;
  await fs.rm(tmp, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test('records and summarizes application statuses', async () => {
  await recordApplication('abc', 'rejected');
  await recordApplication('def', 'no_response');
  await recordApplication('ghi', 'screening');
  const counts = await getLifecycleCounts();
  expect(counts).toEqual(
    expectedCounts({ rejected: 1, no_response: 1, screening: 1 })
  );
  const raw = await fs.readFile(path.join(tmp, 'applications.json'), 'utf8');
  const payload = JSON.parse(raw);
  expect(payload).toMatchObject({
    abc: { status: 'rejected' },
    def: { status: 'no_response' },
    ghi: { status: 'screening' },
  });
  for (const entry of Object.values(payload)) {
    expect(typeof entry.updated_at).toBe('string');
  }
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
  await fs.mkdir(tmp, { recursive: true });
  await fs.writeFile(path.join(tmp, 'applications.json'), '{');
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
    await fs.readFile(path.join(tmp, 'applications.json'), 'utf8'),
  );
  for (const [id, status] of entries) {
    expect(raw[id]).toMatchObject({ status });
    expect(typeof raw[id].updated_at).toBe('string');
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
  await fs.mkdir(tmp, { recursive: true });
  const file = path.join(tmp, 'applications.json');
  const payload = {
    'job-known': { status: 'no_response' },
    'job-unknown': { status: 'coffee_chat' },
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
    fs.readFile(path.join(tmp, 'applications.json')),
  ).rejects.toThrow();
});

test('persists tracker metadata alongside statuses', async () => {
  const metadata = {
    channel: 'referral',
    date: '2025-09-18',
    contact: 'Alex',
    documents: ['resume.pdf', 'cover.pdf'],
    notes: 'Sent follow-up',
  };
  await recordApplication('job-meta', 'screening', metadata);
  const raw = JSON.parse(
    await fs.readFile(path.join(tmp, 'applications.json'), 'utf8'),
  );
  expect(raw['job-meta']).toMatchObject({
    status: 'screening',
    ...metadata,
  });
  expect(typeof raw['job-meta'].updated_at).toBe('string');
});
