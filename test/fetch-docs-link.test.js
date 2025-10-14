import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const FETCH_PATH = path.resolve('src', 'shared', 'http', 'fetch.js');

function readFetchFile() {
  return fs.readFileSync(FETCH_PATH, 'utf8');
}

describe('fetch queue documentation', () => {
  it('links the host queue helper to the architecture map for onboarding', () => {
    const contents = readFetchFile();
    const commentBlock = contents.match(/\/\*\*[^]*?\*\/\s*async function withHostQueue/);
    expect(commentBlock).not.toBeNull();
    expect(commentBlock[0]).toMatch(/docs\/architecture\.md/);
  });
});
