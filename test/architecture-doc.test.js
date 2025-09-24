import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ARCHITECTURE_DOC_PATH = resolve('docs/architecture.md');

describe('architecture documentation', () => {
  it('documents the source-of-truth architecture map for contributors', () => {
    expect(existsSync(ARCHITECTURE_DOC_PATH)).toBe(true);

    const contents = readFileSync(ARCHITECTURE_DOC_PATH, 'utf8');

    expect(contents).toMatch(/# jobbot3000 Architecture Map/);
    expect(contents).toMatch(/CLI pipeline/);
    expect(contents).toMatch(/Resume ingestion/);
    expect(contents).toMatch(/Job ingestion/);
    expect(contents).toMatch(/Matching and scoring/);
    expect(contents).toMatch(/Deliverables/);
  });
});
