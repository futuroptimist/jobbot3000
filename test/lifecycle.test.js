import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, test, expect } from 'vitest';
import { recordApplication, getLifecycleCounts } from '../src/lifecycle.js';

const tmp = path.resolve('test', 'tmp-data');

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
  await recordApplication('ghi', 'offer');
  const counts = await getLifecycleCounts();
  expect(counts).toEqual({ no_response: 1, rejected: 1, next_round: 0, offer: 1 });
  const raw = await fs.readFile(path.join(tmp, 'applications.json'), 'utf8');
  expect(JSON.parse(raw)).toEqual({ abc: 'rejected', def: 'no_response', ghi: 'offer' });
});

test('throws when lifecycle file has invalid JSON', async () => {
  await fs.mkdir(tmp, { recursive: true });
  await fs.writeFile(path.join(tmp, 'applications.json'), '{');
  await expect(recordApplication('ghi', 'rejected')).rejects.toThrow();
  await expect(getLifecycleCounts()).rejects.toThrow();
});

test('handles concurrent status updates', async () => {
  await Promise.all([
    recordApplication('a', 'rejected'),
    recordApplication('b', 'no_response'),
    recordApplication('c', 'next_round'),
    recordApplication('d', 'offer'),
  ]);
  const raw = JSON.parse(
    await fs.readFile(path.join(tmp, 'applications.json'), 'utf8'),
  );
  expect(raw).toEqual({
    a: 'rejected',
    b: 'no_response',
    c: 'next_round',
    d: 'offer',
  });
  const counts = await getLifecycleCounts();
  expect(counts).toEqual({ no_response: 1, rejected: 1, next_round: 1, offer: 1 });
});
