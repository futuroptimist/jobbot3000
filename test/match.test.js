import { describe, expect, it } from 'vitest';

import { matchResumeToJob } from '../src/match.js';
import { parseJobText } from '../src/parser.js';

const jobText = `Title: Platform Engineer
Company: Example Corp
Requirements:
- Experience with Node.js
- Must have Kubernetes certification
- Terraform proficiency
`;

const resumeText = [
  'I build resilient Node.js services, manage PostgreSQL clusters,',
  'and automate cloud stacks with Terraform.',
].join(' ');

describe('matchResumeToJob', () => {
  it('returns parsed job fields and scoring details from raw job text', () => {
    const result = matchResumeToJob(resumeText, jobText);

    expect(result).toMatchObject({
      title: 'Platform Engineer',
      company: 'Example Corp',
      requirements: [
        'Experience with Node.js',
        'Must have Kubernetes certification',
        'Terraform proficiency',
      ],
      score: 67,
      matched: ['Experience with Node.js', 'Terraform proficiency'],
      missing: ['Must have Kubernetes certification'],
      must_haves_missed: ['Must have Kubernetes certification'],
      blockers: ['Must have Kubernetes certification'],
    });

    expect(result.skills_hit).toEqual(result.matched);
    expect(result.skills_gap).toEqual(result.missing);
    expect(Array.isArray(result.keyword_overlap)).toBe(true);
    expect(result.evidence).toEqual([
      {
        text: 'Experience with Node.js',
        source: 'requirements',
      },
      {
        text: 'Terraform proficiency',
        source: 'requirements',
      },
    ]);
  });

  it('optionally includes a localized explanation summary', () => {
    const withExplanation = matchResumeToJob(resumeText, jobText, {
      includeExplanation: true,
      locale: 'fr',
    });

    expect(withExplanation.explanation).toContain('Correspond 2 sur 3 exigences');
  });

  it('propagates calibration metadata when enabled', () => {
    const result = matchResumeToJob(resumeText, jobText, {
      calibration: true,
    });

    expect(result.calibration).toEqual(
      expect.objectContaining({
        applied: true,
        method: 'logistic',
        baselineScore: expect.any(Number),
      }),
    );
    expect(result.score).toBe(result.calibration.score);
  });

  it('accepts pre-parsed job objects without mutating the source', () => {
    const parsed = parseJobText(jobText);
    const originalRequirements = parsed.requirements.slice();

    const result = matchResumeToJob(resumeText, parsed);

    expect(parsed.requirements).toEqual(originalRequirements);
    expect(result.requirements).toEqual(originalRequirements);
    expect(result.requirements).not.toBe(parsed.requirements);
  });
});
