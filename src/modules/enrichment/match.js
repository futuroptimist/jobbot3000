import { parseJobText } from '../../parser.js';
import { computeFitScore } from '../scoring/index.js';
import { formatMatchExplanation } from '../../exporters.js';

function cloneParsedJob(job) {
  if (!job || typeof job !== 'object') return { requirements: [] };
  const requirements = Array.isArray(job.requirements) ? job.requirements.slice() : [];
  const clone = { ...job, requirements };
  return clone;
}

function ensureJobStructure(input) {
  if (typeof input === 'string') {
    return parseJobText(input);
  }
  return cloneParsedJob(input);
}

function normalizeOptions(options = {}) {
  return {
    includeExplanation: Boolean(options.includeExplanation),
    locale: options.locale,
    explanationLimit: options.explanationLimit,
    jobUrl: options.jobUrl,
    calibration: options.calibration,
  };
}

export function matchResumeToJob(resumeText, jobInput, options = {}) {
  if (resumeText == null) {
    throw new Error('resume text is required');
  }
  if (jobInput == null) {
    throw new Error('job description is required');
  }

  const parsedJob = ensureJobStructure(jobInput);
  const requirements = Array.isArray(parsedJob.requirements)
    ? parsedJob.requirements.slice()
    : [];

  const normalizedOptions = normalizeOptions(options);
  const {
    score,
    matched,
    missing,
    must_haves_missed,
    keyword_overlap,
    evidence,
    calibration,
  } = computeFitScore(resumeText, requirements, {
    calibration: normalizedOptions.calibration,
  });
  const blockers = Array.isArray(must_haves_missed) ? must_haves_missed.slice() : [];

  const payload = {
    ...parsedJob,
    requirements,
    score,
    matched,
    missing,
    skills_hit: matched,
    skills_gap: missing,
    must_haves_missed,
    blockers,
    keyword_overlap,
    evidence,
  };
  if (normalizedOptions.jobUrl) {
    payload.url = normalizedOptions.jobUrl;
  }
  if (normalizedOptions.locale) {
    payload.locale = normalizedOptions.locale;
  }
  if (normalizedOptions.includeExplanation) {
    payload.explanation = formatMatchExplanation({
      matched,
      missing,
      score,
      locale: normalizedOptions.locale,
      limit: normalizedOptions.explanationLimit,
    });
  }
  if (calibration) {
    payload.calibration = calibration;
  }

  return payload;
}

export default matchResumeToJob;
