import { STATUSES } from './lifecycle.js';

const LIFECYCLE_EXPERIMENTS = [
  {
    id: 'screening_resume_language',
    status: 'screening',
    name: 'Resume language framing',
    hypothesis:
      'Warmer, candidate-centric summaries increase screening callbacks without raising ' +
      'red flags.',
    description:
      'Compare a neutral resume summary against a warmer variant that foregrounds ' +
      'collaboration and empathy. Track callbacks while monitoring recruiter feedback to ensure ' +
      'tone stays professional.',
    variants: [
      {
        id: 'control',
        description: 'Neutral, accomplishment-first resume summary that mirrors baseline guidance.',
        baseline: true,
        successAction:
          'Keep the neutral summary as-is and continue to iterate on role-specific bullet ' +
          'targeting.',
        fallbackAction:
          'Review top-performing resumes in the library to ensure bullet clarity stays high.',
      },
      {
        id: 'warm_language',
          description:
            'Warm, collaborative summary that emphasizes user impact and cross-functional ' +
            'partnership.',
          successAction:
            'Adopt the warm resume summary tone and highlight cross-functional ' +
            'collaboration stories.',
          fallbackAction:
            'Iterate on specific bullet points instead of tone, focusing on quantified outcomes.',
      },
    ],
    analysisPlan: {
      primaryMetric: {
        id: 'screening_callback_rate',
        name: 'Screening callback rate',
        type: 'binary_proportion',
        successDirection: 'increase',
        minimumSampleSize: 150,
        baselineVariant: 'control',
      },
      guardrailMetrics: [
        {
          id: 'negative_feedback_rate',
          name: 'Negative recruiter feedback rate',
          type: 'binary_proportion',
          successDirection: 'decrease',
          maximumAcceptableRate: 0.08,
        },
      ],
      analysisMethod: 'two_proportion_z_test',
      significanceLevel: 0.05,
      statisticalPower: 0.8,
      multipleComparisonCorrection: 'bonferroni',
      stoppingRule:
        'Commit to 28 days or until every variant and control record at least the minimum sample ' +
        'size before peeking. Use sequential monitoring only for guardrail breaches.',
    },
    actionableNotes: [
      'Share anonymized bullet comparisons with the user so they can understand stylistic shifts.',
      'Pair recommendations with callback rate deltas and confidence intervals for transparency.',
    ],
  },
  {
    id: 'onsite_follow_up_timing',
    status: 'onsite',
    name: 'Post-interview follow-up timing',
    hypothesis:
      'Sending tailored follow-ups within 4 hours of an onsite improves panel engagement without ' +
      'hurting reply sentiment.',
    description:
      'Test immediate versus next-morning follow-ups that leverage the deliverables library. ' +
      'Measure reply rates and guard against negative sentiment signals.',
    variants: [
      {
        id: 'control',
        description: 'Send a tailored follow-up the next morning at 9am local time.',
        baseline: true,
        successAction:
          'Keep the next-morning cadence and focus on content personalization experiments next.',
        fallbackAction:
          'Audit follow-up templates to ensure company research is still specific and relevant.',
      },
      {
        id: 'same_day',
        description: 'Send the follow-up within 4 hours while the interview is top-of-mind.',
        successAction:
          'Adopt the accelerated send window and surface reminders that highlight panel-specific '
          + 'gratitude call-outs.',
        fallbackAction:
            'Maintain the next-morning cadence and explore message sequencing experiments instead.',
      },
    ],
    analysisPlan: {
      primaryMetric: {
        id: 'reply_rate',
        name: 'Hiring manager reply rate',
        type: 'binary_proportion',
        successDirection: 'increase',
        minimumSampleSize: 60,
        baselineVariant: 'control',
      },
      guardrailMetrics: [
        {
          id: 'negative_sentiment_rate',
          name: 'Negative sentiment in responses',
          type: 'binary_proportion',
          successDirection: 'decrease',
          maximumAcceptableRate: 0.1,
        },
      ],
      analysisMethod: 'two_proportion_z_test',
      significanceLevel: 0.05,
      statisticalPower: 0.8,
      multipleComparisonCorrection: 'bonferroni',
        stoppingRule:
          'Run for two full onsite cycles or until each arm hits the minimum sample size, ' +
          'whichever is longer. Do not terminate early on promising partial data.',
      },
      actionableNotes: [
        'When recommending the faster cadence, include calendar nudges so the user can automate ' +
        'sends.',
        'Provide the reply-rate delta alongside anonymized highlights from winning follow-ups.',
      ],
  },
  {
    id: 'offer_negotiation_script',
    status: 'offer',
    name: 'Negotiation script framing',
    hypothesis:
      'Leading with calibrated questions raises improved offer outcomes without extending ' +
      'negotiation cycles beyond acceptable limits.',
      description:
        'Compare a baseline negotiation script against one that opens with calibrated questions ' +
        'and data visualizations from compensation research.',
    variants: [
      {
        id: 'control',
        description: 'Direct value statement anchored on market data and closing with a clear ask.',
        baseline: true,
        successAction:
          'Continue the direct framing and invest in richer compensation benchmarking next.',
        fallbackAction:
          'Rehearse objection handling prompts and refine supporting data visualizations.',
      },
      {
        id: 'calibrated_questions',
          description:
            'Script that opens with calibrated questions, then transitions into quantified value ' +
            'framing.',
          successAction:
            'Adopt calibrated questions for negotiation kickoffs and coach the user on active ' +
            'listening cues.',
        fallbackAction:
          'Return to the baseline script and explore alternate closing language in a future test.',
      },
    ],
    analysisPlan: {
      primaryMetric: {
        id: 'improved_offer_rate',
        name: 'Rate of improved offers after negotiation',
        type: 'binary_proportion',
        successDirection: 'increase',
        minimumSampleSize: 40,
        baselineVariant: 'control',
      },
      guardrailMetrics: [
        {
          id: 'negotiation_cycle_extension',
          name: 'Negotiation cycle extension beyond one week',
          type: 'binary_proportion',
          successDirection: 'decrease',
          maximumAcceptableRate: 0.25,
        },
      ],
      analysisMethod: 'two_proportion_z_test',
      significanceLevel: 0.05,
      statisticalPower: 0.8,
      multipleComparisonCorrection: 'bonferroni',
        stoppingRule:
          'Evaluate only after each arm reaches the minimum sample size or four offers, ' +
          'whichever occurs later, to avoid premature conclusions.',
      },
      actionableNotes: [
        'Surface exemplar negotiation transcripts so the user can practice calibrated questions.',
        'Highlight improved-offer rate lifts with confidence intervals and note any guardrail ' +
        'pressure.',
    ],
  },
];

const EXPERIMENTS_BY_ID = new Map(
  LIFECYCLE_EXPERIMENTS.map(experiment => [experiment.id, experiment]),
);

function assertKnownStatus(status) {
  if (!STATUSES.includes(status)) {
    throw new Error(`unknown status: ${status}`);
  }
}

function validateDatasetKeys(dataset) {
  const allowed = new Set(['primaryMetric', 'guardrails']);
  for (const key of Object.keys(dataset)) {
    if (!allowed.has(key)) {
      throw new Error(`Metric ${key} is not pre-registered for this experiment.`);
    }
  }
}

function normalizeCountPair(pair, metricId) {
  if (!pair || typeof pair !== 'object') {
    throw new Error(`Missing counts for metric ${metricId}.`);
  }
  const successes = Number(pair.successes ?? pair.events);
  const trials = Number(pair.trials ?? pair.total);
  if (!Number.isFinite(successes) || !Number.isFinite(trials)) {
    throw new Error(`Invalid counts for metric ${metricId}.`);
  }
  if (successes < 0 || trials <= 0 || successes > trials) {
    throw new Error(`Counts for metric ${metricId} must be between 0 and total trials.`);
  }
  return { successes, trials };
}

function proportion(successes, trials) {
  return trials === 0 ? 0 : successes / trials;
}

function approximateErf(x) {
  const sign = Math.sign(x);
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t)
    + 0.254829592;
  const y = 1 - polynomial * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(value) {
  return 0.5 * (1 + approximateErf(value * Math.SQRT1_2));
}

function analyzeBinaryLift(controlCounts, variantCounts) {
  const controlRate = proportion(controlCounts.successes, controlCounts.trials);
  const variantRate = proportion(variantCounts.successes, variantCounts.trials);
  const pooled =
    (controlCounts.successes + variantCounts.successes) /
    (controlCounts.trials + variantCounts.trials);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / controlCounts.trials + 1 / variantCounts.trials),
  );
  const effect = variantRate - controlRate;
  const zScore = standardError === 0 ? 0 : effect / standardError;
  const pValue = 1 - normalCdf(zScore);
  return { controlRate, variantRate, effect, zScore, pValue };
}

function formatRate(rate) {
  return Number.isFinite(rate) ? Number(rate.toFixed(4)) : 0;
}

function guardrailBreach(metricPlan, controlCounts, variantCounts) {
  const controlRate = proportion(controlCounts.successes, controlCounts.trials);
  const variantRate = proportion(variantCounts.successes, variantCounts.trials);
  if (metricPlan.maximumAcceptableRate != null) {
    if (variantRate > metricPlan.maximumAcceptableRate) {
      return {
        metricId: metricPlan.id,
        message:
          `${metricPlan.name} exceeded the maximum acceptable rate (${formatRate(variantRate)} > ` +
          `${formatRate(metricPlan.maximumAcceptableRate)}).`,
      };
    }
  }
  if (metricPlan.successDirection === 'decrease' && variantRate > controlRate) {
    return {
      metricId: metricPlan.id,
      message:
        `${metricPlan.name} increased (${formatRate(variantRate)} vs ${formatRate(controlRate)}).`,
    };
  }
  return null;
}

export function listExperimentsForStatus(status) {
  assertKnownStatus(status);
  return LIFECYCLE_EXPERIMENTS.filter(experiment => experiment.status === status);
}

export function getExperimentById(id) {
  return EXPERIMENTS_BY_ID.get(id) ?? null;
}

export function analyzeExperiment(id, dataset) {
  const experiment = EXPERIMENTS_BY_ID.get(id);
  if (!experiment) {
    throw new Error(`unknown experiment: ${id}`);
  }
  validateDatasetKeys(dataset);

  const { analysisPlan } = experiment;
  const baselineVariant = analysisPlan.primaryMetric.baselineVariant;
  const primaryData = dataset.primaryMetric;
  if (!primaryData) {
    throw new Error('primaryMetric data is required for analysis.');
  }
  const controlCounts = normalizeCountPair(primaryData.control, analysisPlan.primaryMetric.id);
  const variantsData = primaryData.variants;
  if (!variantsData || typeof variantsData !== 'object' || Object.keys(variantsData).length === 0) {
    throw new Error('At least one variant must be provided for analysis.');
  }

  const variantResults = [];
  const comparisons = Object.entries(variantsData);
  const correctionDivisor = analysisPlan.multipleComparisonCorrection === 'bonferroni'
    ? comparisons.length
    : 1;
  const alpha = analysisPlan.significanceLevel;

  const variantById = new Map(experiment.variants.map(variant => [variant.id, variant]));

  for (const [variantId, counts] of comparisons) {
      const variantCounts = normalizeCountPair(
        counts,
        `${analysisPlan.primaryMetric.id}:${variantId}`,
      );
    const sampleAdequate =
      controlCounts.trials >= analysisPlan.primaryMetric.minimumSampleSize &&
      variantCounts.trials >= analysisPlan.primaryMetric.minimumSampleSize;

    const stats = analyzeBinaryLift(controlCounts, variantCounts);
    const adjustedP = Math.min(stats.pValue * correctionDivisor, 1);
    const variantMeta = variantById.get(variantId);

    const guardrailBreaches = [];
    if (dataset.guardrails) {
      for (const metricPlan of analysisPlan.guardrailMetrics ?? []) {
        const guardrailDataset = dataset.guardrails[metricPlan.id];
        if (!guardrailDataset) continue;
        const guardrailControl = normalizeCountPair(guardrailDataset.control, metricPlan.id);
        const guardrailVariant = normalizeCountPair(
          guardrailDataset.variants?.[variantId],
          `${metricPlan.id}:${variantId}`,
        );
        const breach = guardrailBreach(metricPlan, guardrailControl, guardrailVariant);
        if (breach) guardrailBreaches.push(breach);
      }
    }

      let recommendation;
      if (!sampleAdequate) {
        recommendation =
          'Collect additional samples before drawing conclusions. Minimum per-arm sample size ' +
          'not met.';
      } else if (guardrailBreaches.length > 0) {
        recommendation =
          'Hold rollout due to guardrail regression. Investigate the flagged metrics before ' +
          'adoption.';
      } else if (
        stats.effect > 0 &&
        adjustedP <= alpha &&
        analysisPlan.primaryMetric.successDirection === 'increase'
      ) {
        recommendation =
          variantMeta?.successAction ??
          'Variant outperforms control. Roll out with ongoing monitoring.';
      } else if (
        stats.effect < 0 &&
        adjustedP <= alpha &&
        analysisPlan.primaryMetric.successDirection === 'decrease'
      ) {
        recommendation =
          variantMeta?.successAction ??
          'Variant meets directional goal. Roll out with monitoring.';
    } else {
        recommendation =
          variantMeta?.fallbackAction ??
          'Retain the control experience and collect more evidence before changing direction.';
    }

    variantResults.push({
      variantId,
      rate: formatRate(stats.variantRate),
      controlRate: formatRate(stats.controlRate),
      effect: formatRate(stats.effect),
      pValue: Number(stats.pValue.toFixed(6)),
      adjustedPValue: Number(adjustedP.toFixed(6)),
      zScore: Number(stats.zScore.toFixed(4)),
      meetsMinimumSample: sampleAdequate,
      guardrailBreaches,
      recommendation,
      isSignificant: adjustedP <= alpha && sampleAdequate && guardrailBreaches.length === 0,
    });
  }

  const winningVariant = variantResults.find(result => result.isSignificant && result.effect > 0);
  const summaryVariant = winningVariant
    ? variantById.get(winningVariant.variantId)
    : variantById.get(baselineVariant);

  const recommendationSummary = winningVariant
    ? `${summaryVariant?.successAction ?? 'Roll out the leading variant.'}`
    : `${summaryVariant?.fallbackAction ?? 'Maintain the control experience for now.'}`;

  return {
    experiment: { id: experiment.id, name: experiment.name },
    recommendationSummary,
    primaryMetric: {
      id: analysisPlan.primaryMetric.id,
      name: analysisPlan.primaryMetric.name,
      type: analysisPlan.primaryMetric.type,
      results: variantResults,
    },
    guardrailFindings: variantResults.flatMap(result =>
      result.guardrailBreaches.map(breach => ({
        variantId: result.variantId,
        metricId: breach.metricId,
        message: breach.message,
      })),
    ),
    supportingData: {
      effectSizes: variantResults.map(result => ({
        variantId: result.variantId,
        effect: result.effect,
      })),
      sampleSizes: {
        control: controlCounts.trials,
        variants: Object.fromEntries(
          comparisons.map(([variantId, counts]) => [
            variantId,
            normalizeCountPair(counts, `${analysisPlan.primaryMetric.id}:${variantId}`).trials,
          ]),
        ),
      },
    },
  };
}
