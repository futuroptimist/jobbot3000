import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GOLDEN_MATCH_DATASET,
  evaluateGoldenMatches,
  loadGoldenMatchDataset,
} from '../src/evaluation/golden-matches.js';

describe('golden match dataset', () => {
  async function writeTempDataset(content) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'golden-match-'));
    const file = path.join(dir, 'dataset.json');
    await fs.writeFile(file, content, 'utf8');
    return file;
  }

  it('loads the curated dataset from config/golden', async () => {
    const entries = await loadGoldenMatchDataset();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('resume');
      expect(entry).toHaveProperty('job.requirements');
    }
  });

  it('evaluates the golden dataset and reports any regressions', async () => {
    const dataset = await loadGoldenMatchDataset(DEFAULT_GOLDEN_MATCH_DATASET);
    const report = evaluateGoldenMatches(dataset, { scoreTolerance: 0 });

    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('rejects missing dataset files', async () => {
    await expect(loadGoldenMatchDataset('/nonexistent/golden.json')).rejects.toThrow(
      /ENOENT/,
    );
  });

  it('rejects malformed dataset files', async () => {
    const malformed = await writeTempDataset('{not-json}');
    await expect(loadGoldenMatchDataset(malformed)).rejects.toThrow(
      /Failed to parse golden match dataset/,
    );
  });

  it('rejects invalid dataset structure', async () => {
    const invalidStructure = await writeTempDataset('{"not":"an array"}');
    await expect(loadGoldenMatchDataset(invalidStructure)).rejects.toThrow(
      'golden match dataset must be an array',
    );
  });

  it('rejects invalid entries', async () => {
    const missingResume = await writeTempDataset('[{"id":"missing_job"}]');
    await expect(loadGoldenMatchDataset(missingResume)).rejects.toThrow(
      /missing resume text/,
    );

    const invalidRequirements = await writeTempDataset(
      JSON.stringify([
        {
          id: 'invalid_requirements',
          resume: 'example resume',
          job: { requirements: ['string', 42] },
          expected: { matched: [], missing: [] },
        },
      ]),
    );
    await expect(loadGoldenMatchDataset(invalidRequirements)).rejects.toThrow(
      'job requirements for "invalid_requirements" entries must be strings',
    );
  });

  it('rejects invalid options', async () => {
    const dataset = await loadGoldenMatchDataset(DEFAULT_GOLDEN_MATCH_DATASET);
    expect(() => evaluateGoldenMatches(dataset, { scoreTolerance: -1 })).toThrow(
      'scoreTolerance must be a non-negative number',
    );
  });
});
