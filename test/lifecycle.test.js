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
  const counts = await getLifecycleCounts();
  expect(counts).toEqual({ no_response: 1, rejected: 1, next_round: 0 });
  const raw = await fs.readFile(path.join(tmp, 'applications.json'), 'utf8');
  expect(JSON.parse(raw)).toEqual({ abc: 'rejected', def: 'no_response' });
});
