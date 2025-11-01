import fs from 'node:fs/promises';
import path from 'node:path';

import { initProfile } from './profile.js';
import { getIntakeResponses, setIntakeDataDir } from './intake.js';

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setIntakePlanDataDir(dir) {
  overrideDir = dir || undefined;
  setIntakeDataDir(dir || undefined);
}

function loadResumeSync(resumePath) {
  return fs.readFile(resumePath, 'utf8');
}

function hasAnsweredResponse(responses, { tags = [], keywords = [] }) {
  if (!Array.isArray(responses) || responses.length === 0) return false;
  const normalizedTags = tags.map(tag => tag.toLowerCase());
  const keywordPatterns = keywords.map(keyword => new RegExp(keyword, 'i'));

  for (const response of responses) {
    if (!response || response.status !== 'answered') continue;
    const responseTags = Array.isArray(response.tags)
      ? response.tags.map(tag => String(tag).toLowerCase())
      : [];
    const question = typeof response.question === 'string' ? response.question : '';
    const answer = typeof response.answer === 'string' ? response.answer : '';

    if (normalizedTags.some(tag => responseTags.includes(tag))) {
      return true;
    }

    if (
      keywordPatterns.some(pattern => pattern.test(question) || pattern.test(answer))
    ) {
      return true;
    }
  }

  return false;
}

function hasResumeSummary(resume) {
  const summary = resume?.basics?.summary;
  if (typeof summary !== 'string') return false;
  return summary.trim().length >= 40;
}

function hasLocationPreference(resume) {
  const preferences = resume?.preferences;
  if (!preferences || typeof preferences !== 'object') return false;

  if (typeof preferences.relocation === 'boolean') {
    return true;
  }

  const maybeStrings = [
    preferences.location,
    preferences.locationPreference,
    preferences.relocationPreference,
  ];
  if (maybeStrings.some(value => typeof value === 'string' && value.trim())) {
    return true;
  }

  const locationList = preferences.locations || preferences.locationPreferences;
  if (
    Array.isArray(locationList) &&
    locationList.some(entry => typeof entry === 'string' && entry.trim())
  ) {
    return true;
  }

  return false;
}

function resumeHasQuantifiedWork(resume) {
  if (!resume || typeof resume !== 'object') return false;
  const work = Array.isArray(resume.work) ? resume.work : [];
  const numericPattern =
    /\b\d+(?:[.,]\d+)?(?:\s*(?:%|k|m|mm|bn|billion|million|thousand))?\b|\bpercent(?:age)?\b/i;
  for (const role of work) {
    if (!role || typeof role !== 'object') continue;
    const fields = [];
    if (typeof role.summary === 'string') fields.push(role.summary);
    if (Array.isArray(role.highlights)) fields.push(...role.highlights);
    for (const field of fields) {
      if (typeof field === 'string' && numericPattern.test(field)) {
        return true;
      }
    }
  }
  return false;
}

function resumeListsTools(resume) {
  if (!resume || typeof resume !== 'object') return false;
  const skills = Array.isArray(resume.skills) ? resume.skills : [];
  const named = skills
    .map(entry => (typeof entry?.name === 'string' ? entry.name.trim() : ''))
    .filter(Boolean);
  return named.length >= 3;
}

export function generateIntakeQuestionPlan({ resume, responses = [] } = {}) {
  const plan = [];

  const answered = Array.isArray(responses) ? responses : [];

  if (
    !hasResumeSummary(resume) &&
    !hasAnsweredResponse(answered, {
      tags: ['career', 'goals', 'mission'],
      keywords: ['career', 'goal', 'mission statement', 'target role'],
    })
  ) {
    plan.push({
      id: 'career_goals',
      prompt: 'What roles are you targeting next and what impact do you want to make?',
      tags: ['career', 'goals'],
      reason: 'Resume summary is missing or too short to capture career goals.',
      priority: 1,
    });
  }

  if (
    !hasLocationPreference(resume) &&
    !hasAnsweredResponse(answered, {
      tags: ['relocation', 'location', 'remote'],
      keywords: ['relocat', 'location preference', 'remote work', 'commute'],
    })
  ) {
    plan.push({
      id: 'relocation_preferences',
      prompt: 'Where are you open to working and do you have relocation or remote constraints?',
      tags: ['relocation', 'location'],
      reason: 'Location preferences are not recorded in the profile.',
      priority: 2,
    });
  }

  if (
    !hasAnsweredResponse(answered, {
      tags: ['compensation', 'salary', 'pay', 'band'],
      keywords: ['compensation', 'salary', 'target pay', 'pay range', 'band'],
    })
  ) {
    plan.push({
      id: 'compensation_guardrails',
      prompt: 'What compensation range keeps you in the process and what trade-offs are flexible?',
      tags: ['compensation'],
      reason: 'Compensation guardrails are not captured in intake responses.',
      priority: 3,
    });
  }

  if (
    !hasAnsweredResponse(answered, {
      tags: ['visa', 'sponsorship', 'work authorization'],
      keywords: ['visa', 'sponsor', 'work authorization', 'work permit'],
    })
  ) {
    plan.push({
      id: 'visa_status',
      prompt: 'Do you need visa sponsorship or have any work authorization constraints?',
      tags: ['visa'],
      reason: 'Visa or work authorization details are not recorded.',
      priority: 4,
    });
  }

  if (
    !resumeHasQuantifiedWork(resume) &&
    !hasAnsweredResponse(answered, {
      tags: ['metrics', 'results', 'impact'],
      keywords: ['metric', 'impact', 'quantitative', 'results'],
    })
  ) {
    plan.push({
      id: 'measurable_outcomes',
      prompt:
        'Share a recent accomplishment with measurable outcomes (numbers, percentages, ' +
        'or before/after impact).',
      tags: ['metrics'],
      reason: 'Work history lacks quantified achievements.',
      priority: 5,
    });
  }

  if (
    !resumeListsTools(resume) &&
    !hasAnsweredResponse(answered, {
      tags: ['tools', 'stack', 'skills'],
      keywords: ['tooling', 'tech stack', 'tools', 'skills you rely on'],
    })
  ) {
    plan.push({
      id: 'tool_stack',
      prompt: 'Which tools, frameworks, or platforms do you rely on for your best work?',
      tags: ['tools'],
      reason: 'Resume does not enumerate core tools or stack preferences.',
      priority: 6,
    });
  }

  plan.sort((a, b) => a.priority - b.priority);
  return plan.map(item => {
    const { priority, ...rest } = item;
    void priority;
    return rest;
  });
}

export async function loadIntakeQuestionPlan(options = {}) {
  const dataDir = resolveDataDir();
  const profilePathRaw = options.profilePath;
  let resumePath;
  let resumeRaw;

  if (profilePathRaw) {
    resumePath = path.resolve(profilePathRaw);
    try {
      resumeRaw = await loadResumeSync(resumePath);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        throw new Error(`profile resume not found at ${resumePath}`);
      }
      throw new Error(
        `failed to read profile resume ${resumePath}: ${err?.message || err}`,
      );
    }
  } else {
    const { path: defaultResumePath } = await initProfile();
    resumePath = defaultResumePath;
    try {
      resumeRaw = await loadResumeSync(defaultResumePath);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        resumeRaw = '{}';
      } else {
        throw err;
      }
    }
  }

  let resume;
  try {
    resume = JSON.parse(resumeRaw);
  } catch {
    resume = {};
  }

  const responses = await getIntakeResponses();
  const plan = generateIntakeQuestionPlan({ resume, responses });
  return {
    plan,
    resumePath: resumePath.startsWith(dataDir)
      ? resumePath
      : path.resolve(resumePath),
  };
}

export { hasAnsweredResponse };
