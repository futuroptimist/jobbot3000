import { describe, expect, test } from 'vitest';

import {
  listExperimentsForStatus,
  analyzeExperiment,
  getExperimentById,
} from '../src/lifecycle-experiments.js';

const KNOWN_STATUS = 'screening';

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
});
