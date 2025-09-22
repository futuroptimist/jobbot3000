import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { computeFitScore, __testHasSynonymMatch } from '../src/scoring.js';

describe('computeFitScore', () => {
  it('scores matched and missing requirements', () => {
    const resume = 'I know JavaScript and Node.js.';
    const requirements = ['JavaScript', 'Python'];
    const result = computeFitScore(resume, requirements);
    expect(result.score).toBe(50);
    expect(result.matched).toEqual(['JavaScript']);
    expect(result.missing).toEqual(['Python']);
  });

  it('matches tokens case-insensitively', () => {
    const resume = 'Expert in PYTHON and Go.';
    const requirements = ['python'];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({ score: 100, matched: ['python'], missing: [] });
  });

  it('skips non-string requirement entries', () => {
    const resume = 'Strong in Go';
    const requirements = ['Go', null, 123, undefined];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({ score: 100, matched: ['Go'], missing: [] });
  });

  it('treats non-string resume input as empty string', () => {
    const result = computeFitScore({ exp: 'JS' }, ['JS']);
    expect(result).toEqual({ score: 0, matched: [], missing: ['JS'] });
  });

  it('skips empty string requirement entries', () => {
    const resume = 'Skilled in JavaScript';
    const requirements = ['JavaScript', ''];
    const result = computeFitScore(resume, requirements);
    expect(result).toEqual({ score: 100, matched: ['JavaScript'], missing: [] });
  });

  it('returns zero score when no requirements given', () => {
    const result = computeFitScore('anything', []);
    expect(result).toEqual({ score: 0, matched: [], missing: [] });
  });

  it('handles undefined requirements', () => {
    const result = computeFitScore('anything');
    expect(result).toEqual({ score: 0, matched: [], missing: [] });
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
    expect(result).toEqual({ score: 100, matched: requirements, missing: [] });
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
    expect(result).toEqual({ score: 100, matched: requirements, missing: [] });
  });

  it('only bridges the CI/CD abbreviation to each spelled-out term', () => {
    expect(
      __testHasSynonymMatch(
        'Improve continuous integration workflows',
        'Continuous delivery expertise',
      ),
    ).toBe(false);
    expect(
      __testHasSynonymMatch('Automate continuous delivery deployments', 'CI/CD automation'),
    ).toBe(true);
    expect(
      __testHasSynonymMatch('Improve continuous integration workflows', 'CI/CD automation'),
    ).toBe(true);
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
