import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  listExperimentsForStatus,
  analyzeExperiment,
  getExperimentById,
  archiveExperimentAnalysis,
  getExperimentAnalysisHistory,
  setLifecycleExperimentDataDir,
} from '../src/lifecycle-experiments.js';

const KNOWN_STATUS = 'screening';

let experimentsDir;

beforeEach(async () => {
  experimentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-experiments-'));
  setLifecycleExperimentDataDir(experimentsDir);
});

afterEach(async () => {
  setLifecycleExperimentDataDir(undefined);
  if (experimentsDir) {
    await fs.rm(experimentsDir, { recursive: true, force: true });
    experimentsDir = undefined;
  }
});

describe('lifecycle experiments', () => {
  test('exposes pre-registered experiments for each lifecycle stage', () => {
    const experiments = listExperimentsForStatus(KNOWN_STATUS);
    expect(experiments.length).toBeGreaterThan(0);

    for (const experiment of experiments) {
      expect(experiment.status).toBe(KNOWN_STATUS);
      expect(typeof experiment.hypothesis).toBe('string');
      expect(experiment.hypothesis.length).toBeGreaterThan(10);
      expect(experiment.analysisPlan).toMatchObject({
        primaryMetric: expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          type: 'binary_proportion',
        }),
        significanceLevel: expect.any(Number),
        multipleComparisonCorrection: 'bonferroni',
        stoppingRule: expect.any(String),
      });
    }
  });

  test('analyzes experiments and produces actionable recommendations', () => {
    const experiment = getExperimentById('screening_resume_language');
    expect(experiment).toBeDefined();

    const result = analyzeExperiment('screening_resume_language', {
      primaryMetric: {
        control: { successes: 18, trials: 200 },
        variants: {
          warm_language: { successes: 34, trials: 200 },
        },
      },
      guardrails: {
        negative_feedback_rate: {
          control: { events: 2, total: 200 },
          variants: {
            warm_language: { events: 1, total: 200 },
          },
        },
      },
    });

    const variantResult = result.primaryMetric.results[0];
    expect(variantResult.variantId).toBe('warm_language');
    expect(typeof variantResult.pValue).toBe('number');
    expect(variantResult.pValue).toBeGreaterThanOrEqual(0);
    expect(typeof variantResult.recommendation).toBe('string');
    expect(result.recommendationSummary).toMatch(/resume/i);
    expect(result.supportingData).toHaveProperty('effectSizes');
  });

  test('recognizes statistically significant decreases for directional checks', () => {
    const result = analyzeExperiment('screening_resume_language', {
      primaryMetric: {
        control: { successes: 150, trials: 200 },
        variants: {
          warm_language: { successes: 90, trials: 200 },
        },
      },
    });

    const variantResult = result.primaryMetric.results[0];
    expect(variantResult.pValue).toBeLessThan(0.05);
    expect(variantResult.isSignificant).toBe(false);
    expect(variantResult.recommendation).toMatch(/wrong direction/i);
  });

  test('returns actionable notes for downstream experiment surfaces', () => {
    const experiment = getExperimentById('screening_resume_language');
    expect(Array.isArray(experiment.actionableNotes)).toBe(true);

    const result = analyzeExperiment('screening_resume_language', {
      primaryMetric: {
        control: { successes: 18, trials: 200 },
        variants: {
          warm_language: { successes: 34, trials: 200 },
        },
      },
    });

    expect(result.actionableNotes).toEqual(experiment.actionableNotes);
    expect(result.actionableNotes).not.toBe(experiment.actionableNotes);
    expect(result.actionableNotes.length).toBeGreaterThan(0);
  });

  test('rejects analysis requests that are not pre-registered', () => {
    expect(() =>
      analyzeExperiment('screening_resume_language', {
        exploratoryMetric: {
          control: { successes: 4, trials: 10 },
          variants: {
            warm_language: { successes: 7, trials: 10 },
          },
        },
      }),
    ).toThrow(/pre-registered/i);
  });

  test('archives experiment analyses alongside lifecycle data', async () => {
    const analysis = analyzeExperiment('screening_resume_language', {
      primaryMetric: {
        control: { successes: 50, trials: 120 },
        variants: {
          warm_language: { successes: 72, trials: 120 },
        },
      },
    });

    const recordedAt = '2025-03-02T18:00:00Z';
    const entry = await archiveExperimentAnalysis(
      'screening_resume_language',
      analysis,
      { recordedAt },
    );

    expect(entry.recorded_at).toBe('2025-03-02T18:00:00.000Z');
    expect(entry.result.recommendationSummary).toContain('resume');
    expect(entry.result.actionableNotes).toEqual(
      expect.arrayContaining(analysis.actionableNotes),
    );

    const history = await getExperimentAnalysisHistory('screening_resume_language');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      recorded_at: '2025-03-02T18:00:00.000Z',
      result: expect.objectContaining({ recommendationSummary: expect.stringContaining('resume') }),
    });

    const archivePath = path.join(experimentsDir, 'experiment_analyses.json');
    const raw = JSON.parse(await fs.readFile(archivePath, 'utf8'));
    expect(Array.isArray(raw.screening_resume_language)).toBe(true);
  });
});
