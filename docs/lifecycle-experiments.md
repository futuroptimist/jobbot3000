# Lifecycle Experiments

The lifecycle board now ships with pre-registered experiments so we can iterate on resumes,
follow-ups, and negotiation scripts without hand-rolling statistics. The
[`src/lifecycle-experiments.js`](../src/lifecycle-experiments.js) module describes each experiment,
its hypothesis, the primary metric, guardrail metrics, and the analysis plan the automation follows.
The `analyzeExperiment` helper evaluates aggregated outcomes and returns actionable recommendations,
complete with effect sizes, adjusted p-values, and guardrail findings.

## Experiment catalog

| Lifecycle stage | Experiment ID | Hypothesis | Primary metric | Minimum sample per arm | Guardrail focus |
| --------------- | ------------- | ---------- | -------------- | ---------------------- | --------------- |
| Screening | `screening_resume_language` | Warmer resume summaries drive more callbacks without tripping recruiter concerns. | Screening callback rate | 150 | Negative recruiter feedback rate ≤ 8% |
| Onsite | `onsite_follow_up_timing` | Same-day follow-ups raise reply rates without hurting sentiment. | Hiring manager reply rate | 60 | Negative sentiment rate ≤ 10% |
| Offer | `offer_negotiation_script` | Calibrated questions increase improved-offer rates without extending cycles beyond one week. | Improved offer rate | 40 | Negotiation cycle extension rate ≤ 25% |

Each experiment intentionally constrains sample sizes to a level individual applicants can reach in a
few weeks, while still powering an 80% test with a 5% one-sided alpha. Guardrail metrics ensure
variants do not win at the expense of professionalism, sentiment, or negotiation velocity.

## Running an experiment end-to-end

1. **Select a pre-registered experiment.** Call `listExperimentsForStatus(status)` to surface the
   playbooks relevant to the current lifecycle stage. Each includes a hypothesis statement and the
   minimum per-arm sample size required before the automation will declare a winner.
2. **Instrument outcomes in the background.** The CLI and deliverables pipeline already capture the
   successes and trials required for the primary and guardrail metrics. Aggregate results per variant
   before invoking the analyzer—no manual statistical work is required from the user.
3. **Analyze with guardrails enforced.** Pass the aggregated counts to `analyzeExperiment`. The
   helper validates that only pre-registered metrics are supplied, applies a two-proportion z-test,
   adjusts p-values with Bonferroni corrections, and checks every guardrail before issuing a
   recommendation.
4. **Surface actionable insights.** The return payload highlights the winning variant (if any), the
   supporting effect sizes, adjusted p-values, any guardrail breaches, and experiment-specific
   `actionableNotes`. Feed the `recommendationSummary`, `actionableNotes`, and `supportingData` back
   into the lifecycle UI so users can adopt changes confidently without duplicating prose from the
   playbook definitions.
5. **Archive the analysis for future runs.** Call `archiveExperimentAnalysis(id, result, options)`
   with the object returned from `analyzeExperiment` (pass `recordedAt` to override the default
   timestamp) so the outcome is written to `data/experiment_analyses.json`. Retrieve prior runs with
   `getExperimentAnalysisHistory(id)` when seeding future baselines or presenting evidence to users.

## Statistical guardrails

The automation follows the same evidence standards we expect from disciplined experimentation:

- **Pre-registration only.** `analyzeExperiment` throws when metrics outside the registered plan are
  provided. This eliminates p-hacking, data dredging, optional stopping, and other issues listed in
  [the related statistical misuse taxonomy](https://en.wikipedia.org/wiki/Data_dredging#See_also).
- **Fixed alpha with multiple-comparison control.** Every experiment uses a one-sided 5% alpha and
  applies a Bonferroni correction across all variants to manage family-wise error rates.
- **Adequate power before conclusions.** Recommendations only fire when each arm meets the minimum
  sample size that powers an 80% test. Otherwise the helper requests more data.
- **Sequential monitoring limited to guardrails.** Stopping rules prevent premature peeking at the
  primary metric. Guardrail breaches, however, interrupt experiments immediately to protect user
  outcomes.
- **Transparent effect reporting.** The analyzer returns absolute lift, z-scores, and adjusted
  p-values so downstream UX can show the evidence behind every recommendation.

## Operational guidance

- Promote the winning variant only when the recommendation summary signals adoption. Guardrail
  breaches return hold messages with the offending metric spelled out.
- Archive analysis results alongside lifecycle history so future experiments can start with empirical
  baselines instead of anecdotes. `archiveExperimentAnalysis` persists each run and
  `getExperimentAnalysisHistory` surfaces the stored entries; see
  [`test/experiments.test.js`](../test/experiments.test.js) for coverage that locks the archive format
  and timestamp normalization in place.
- Expand the catalog as new lifecycle touch-points appear. Ensure each addition includes a clear
  hypothesis, success metric, guardrail metric(s), and a stopping rule before exposing it to users.
