import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { computeFitScore } from '../src/scoring.js';

describe('computeFitScore', () => {
  it('scores matched and missing requirements', () => {
    const resume = 'I know JavaScript and Node.js.';
    const requirements = ['JavaScript', 'Python'];
    const result = computeFitScore(resume, requirements);
    expect(result.score).toBe(50);
    expect(result.matched).toEqual(['JavaScript']);
    expect(result.missing).toEqual(['Python']);
    expect(result.must_haves_missed).toEqual([]);
    expect(result.keyword_overlap).toEqual(['javascript']);
    expect(result.evidence).toEqual([
      { text: 'JavaScript', source: 'requirements' },
    ]);
  });

  it('matches tokens case-insensitively', () => {
    const resume = 'Expert in PYTHON and Go.';
    const requirements = ['python'];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({
      score: 100,
      matched: ['python'],
      missing: [],
      must_haves_missed: [],
      keyword_overlap: ['python'],
      evidence: [{ text: 'python', source: 'requirements' }],
    });
  });

  it('skips non-string requirement entries', () => {
    const resume = 'Strong in Go';
    const requirements = ['Go', null, 123, undefined];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({
      score: 100,
      matched: ['Go'],
      missing: [],
      must_haves_missed: [],
      keyword_overlap: ['go'],
      evidence: [{ text: 'Go', source: 'requirements' }],
    });
  });

  it('treats non-string resume input as empty string', () => {
    const result = computeFitScore({ exp: 'JS' }, ['JS']);
    expect(result).toEqual({
      score: 0,
      matched: [],
      missing: ['JS'],
      must_haves_missed: [],
      keyword_overlap: [],
      evidence: [],
    });
  });

  it('skips empty string requirement entries', () => {
    const resume = 'Skilled in JavaScript';
    const requirements = ['JavaScript', ''];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({
      score: 100,
      matched: ['JavaScript'],
      missing: [],
      must_haves_missed: [],
      keyword_overlap: ['javascript'],
      evidence: [{ text: 'JavaScript', source: 'requirements' }],
    });
  });

  it('returns zero score when no requirements given', () => {
    const result = computeFitScore('anything', []);
    expect(result).toEqual({
      score: 0,
      matched: [],
      missing: [],
      must_haves_missed: [],
      keyword_overlap: [],
      evidence: [],
    });
  });

  it('handles undefined requirements', () => {
    const result = computeFitScore('anything');
    expect(result).toEqual({
      score: 0,
      matched: [],
      missing: [],
      must_haves_missed: [],
      keyword_overlap: [],
      evidence: [],
    });
  });

  it('matches documented semantic aliases between resumes and requirements', () => {
    const resume =
      'Hands-on AWS migrations, ML experimentation, AI assistants, and Postgres tuning.';
    const requirements = [
      'Design Amazon Web Services infrastructure',
      'Own machine learning pipelines',
      'Advance artificial intelligence research',
      'Administer PostgreSQL clusters',
    ];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({
      score: 100,
      matched: requirements,
      missing: [],
      must_haves_missed: [],
      keyword_overlap: [
        'amazon web services',
        'machine learning',
        'artificial intelligence',
        'postgresql',
      ],
      evidence: requirements.map(text => ({ text, source: 'requirements' })),
    });
  });

  it('matches expanded O*NET/ESCO-inspired synonym groups', () => {
    const resume =
      'Scaled a SaaS analytics platform on K8s, owning CI/CD automation with JS and TS services.';
    const requirements = [
      'Own software as a service uptime targets',
      'Harden Kubernetes clusters',
      'Improve continuous integration workflows',
      'Automate continuous delivery deployments',
      'Build JavaScript frontends',
      'Maintain TypeScript monorepos',
    ];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({
      score: 100,
      matched: requirements,
      missing: [],
      must_haves_missed: [],
      keyword_overlap: [
        'software as a service',
        'kubernetes',
        'continuous integration',
        'continuous delivery',
        'javascript',
        'typescript',
      ],
      evidence: requirements.map(text => ({ text, source: 'requirements' })),
    });
  });

  it('identifies missed must-have requirements', () => {
    const resume = 'Seasoned backend engineer focused on mentoring and developer experience.';
    const requirements = [
      'Must have Kubernetes expertise',
      'Security clearance required',
      'Strong communication skills',
    ];
    const result = computeFitScore(resume, requirements);
    expect(result.must_haves_missed).toEqual([
      'Must have Kubernetes expertise',
      'Security clearance required',
    ]);
    expect(result.keyword_overlap).toEqual([]);
    expect(result.evidence).toEqual([]);
  });

  it('reports keyword overlap for matched requirements', () => {
    const resume =
      'Experience with distributed systems and Amazon Web Services (AWS) migrations.';
    const requirements = [
      'Distributed systems experience',
      'Amazon Web Services architecture expertise',
      'Kubernetes certification',
    ];
    const result = computeFitScore(resume, requirements);
    expect(result.keyword_overlap).toEqual([
      'distributed',
      'systems',
      'experience',
      'amazon web services',
    ]);
    expect(result.evidence).toEqual([
      { text: 'Distributed systems experience', source: 'requirements' },
      { text: 'Amazon Web Services architecture expertise', source: 'requirements' },
    ]);
  });

  it('calibrates scores via logistic regression when requested', () => {
    const resume =
      'Led AWS infrastructure migrations, Terraform automation, and Kubernetes SRE rotations.';
    const requirements = [
      'Own Amazon Web Services infrastructure',
      'Automate Terraform workflows',
      'Run Kubernetes site reliability rotations',
      'Lead security clearance onboarding',
    ];

    const baseline = computeFitScore(resume, requirements);
    const calibrated = computeFitScore(resume, requirements, { calibration: true });

    expect(calibrated.score).not.toBe(baseline.score);
    expect(calibrated.calibration).toEqual(
      expect.objectContaining({
        applied: true,
        method: 'logistic',
        baselineScore: baseline.score,
      }),
    );
  });

  it('allows overriding calibration weights', () => {
    const resume = 'Broad operations and systems mentoring background.';
    const requirements = [
      'Hands-on distributed systems expertise',
      'Deep Amazon Web Services experience',
      'Must have security clearance',
      'Mentor engineering teams',
    ];

    const custom = computeFitScore(resume, requirements, {
      calibration: {
        intercept: -5,
        coverageWeight: 7.5,
        missingWeight: -3,
        blockerWeight: -4,
        keywordWeight: 0.5,
        requirementWeight: 0.1,
      },
    });

    expect(custom.calibration).toEqual(
      expect.objectContaining({
        applied: true,
        method: 'logistic',
        weights: expect.objectContaining({
          intercept: -5,
          coverageWeight: 7.5,
          missingWeight: -3,
          blockerWeight: -4,
          keywordWeight: 0.5,
          requirementWeight: 0.1,
        }),
      }),
    );
  });

  it('reuses cached keyword overlap results across repeated evaluations', () => {
    const resume = 'Delivered SaaS products on AWS with machine learning personalization.';
    const requirements = [
      'Amazon Web Services infrastructure ownership',
      'Machine learning experimentation',
      'SaaS product delivery',
      'Continuous integration pipelines',
      'Continuous delivery automation',
      'TypeScript platform stewardship',
      'Kubernetes fleet scaling',
    ];

    const first = computeFitScore(resume, requirements);
    const second = computeFitScore(resume, requirements);

    expect(first.keyword_overlap.length).toBeLessThanOrEqual(12);
    expect(second.keyword_overlap).toEqual(first.keyword_overlap);
    expect(first.evidence).toHaveLength(first.matched.length);
    expect(second.evidence).toEqual(first.evidence);
  });

  it('skips keyword overlap extraction when the resume has more than 5k unique tokens', () => {
    const resume = Array.from({ length: 6000 }, (_, i) => `Skill${i}`).join(' ');
    const requirements = ['Skill1', 'Skill5999'];

    const result = computeFitScore(resume, requirements);

    expect(result.matched).toEqual(requirements);
    expect(result.keyword_overlap).toEqual([]);
    expect(result.evidence.map(entry => entry.text)).toEqual(result.matched);
  });


  // Allow slower CI environments by using a relaxed threshold.
  it('processes large requirement lists within 2500ms', () => {
    const resume = 'skill '.repeat(1000);
    const requirements = Array(100).fill('skill');
    computeFitScore(resume, requirements); // warm up JIT
    const start = performance.now();
    for (let i = 0; i < 5000; i += 1) {
      computeFitScore(resume, requirements);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2500);
  });
});
