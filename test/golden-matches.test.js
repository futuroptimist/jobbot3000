import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GOLDEN_MATCH_DATASET,
  evaluateGoldenMatches,
  loadGoldenMatchDataset,
} from '../src/evaluation/golden-matches.js';

describe('golden match dataset', () => {
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

    const failed = report.failures.map(entry => ({
      id: entry.id,
      failures: entry.failures,
    }));

    expect(report.passed).toBe(true);
    expect(failed).toEqual([]);
  });
});
