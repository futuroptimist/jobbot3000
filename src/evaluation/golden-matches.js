import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchResumeToJob } from '../modules/enrichment/match.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GOLDEN_MATCH_DATASET = path.resolve(
  __dirname,
  '../../config/golden/match-dataset.json',
);

function asArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter(entry => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('golden match entries must be objects');
  }
  const id = typeof raw.id === 'string' && raw.id.trim();
  if (!id) {
    throw new Error('golden match entries must include an id');
  }

  const resume = typeof raw.resume === 'string' && raw.resume.trim();
  if (!resume) {
    throw new Error(`golden match entry "${id}" is missing resume text`);
  }

  const job = raw.job && typeof raw.job === 'object' ? { ...raw.job } : {};
  const requirements = asArray(job.requirements);
  if (requirements.length === 0) {
    throw new Error(`golden match entry "${id}" is missing job requirements`);
  }

  const expected = raw.expected && typeof raw.expected === 'object' ? { ...raw.expected } : {};
  const expectedMatched = asArray(expected.matched);
  const expectedMissing = asArray(expected.missing);

  return {
    id,
    resume,
    job: { ...job, requirements },
    expected: {
      ...expected,
      matched: expectedMatched,
      missing: expectedMissing,
      score: typeof expected.score === 'number' ? expected.score : undefined,
    },
  };
}

export async function loadGoldenMatchDataset(datasetPath = DEFAULT_GOLDEN_MATCH_DATASET) {
  const resolved = path.resolve(datasetPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('golden match dataset must be an array');
  }
  return parsed.map(entry => normalizeEntry(entry));
}

function compareLists(expected = [], actual = []) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter(item => !actualSet.has(item));
  const unexpected = actual.filter(item => !expectedSet.has(item));
  return { missing, unexpected };
}

export function evaluateGoldenMatches(entries, options = {}) {
  if (!Array.isArray(entries)) {
    throw new Error('entries must be an array');
  }

  const toleranceRaw = options.scoreTolerance ?? 0;
  const scoreTolerance = Number.isFinite(Number(toleranceRaw))
    ? Math.max(0, Number(toleranceRaw))
    : 0;

  const results = entries.map(entry => {
    const { expected } = entry;
    const actual = matchResumeToJob(entry.resume, entry.job, { includeExplanation: true });

    const matchedComparison = compareLists(expected.matched, actual.matched);
    const missingComparison = compareLists(expected.missing, actual.missing);

    const failures = [];
    if (expected.score !== undefined) {
      const diff = Math.abs(Number(actual.score) - expected.score);
      if (!Number.isFinite(diff) || diff > scoreTolerance) {
        failures.push(
          `score expected ${expected.score}, received ${actual.score}`,
        );
      }
    }

    if (matchedComparison.missing.length || matchedComparison.unexpected.length) {
      if (matchedComparison.missing.length) {
        failures.push(
          `missing matched requirements: ${matchedComparison.missing.join(', ')}`,
        );
      }
      if (matchedComparison.unexpected.length) {
        failures.push(
          `unexpected matched requirements: ${matchedComparison.unexpected.join(', ')}`,
        );
      }
    }

    if (missingComparison.missing.length || missingComparison.unexpected.length) {
      if (missingComparison.missing.length) {
        failures.push(
          `missing gaps: ${missingComparison.missing.join(', ')}`,
        );
      }
      if (missingComparison.unexpected.length) {
        failures.push(
          `unexpected gaps: ${missingComparison.unexpected.join(', ')}`,
        );
      }
    }

    return {
      id: entry.id,
      passed: failures.length === 0,
      failures,
      expected,
      actual: {
        score: actual.score,
        matched: actual.matched,
        missing: actual.missing,
        explanation: actual.explanation,
      },
    };
  });

  const failed = results.filter(result => !result.passed);
  return {
    total: results.length,
    passed: failed.length === 0,
    failures: failed,
    results,
  };
}
