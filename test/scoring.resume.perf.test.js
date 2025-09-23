import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, it, expect } from 'vitest';
import { computeFitScore, __resetScoringCachesForTest } from '../src/scoring.js';

const LARGE_RESUME = Array.from({ length: 120000 }, (_, i) => `Skill ${i}`).join('\n');
const REQUIREMENTS = ['Skill 123', 'Skill 119999'];

describe('computeFitScore resume tokenization performance', () => {
  it('tokenizes a 120k-line resume within 190ms on a cold run', () => {
    // Warm up the JIT on a tiny input so the cold-run measurement below only captures
    // the resume tokenization path. Each invocation uses a unique resume string to avoid
    // triggering the module-level cache.
    __resetScoringCachesForTest();
    computeFitScore('Warm up', ['Skill 0']);
    const start = performance.now();
    computeFitScore(`${LARGE_RESUME}\n${randomUUID()}`, REQUIREMENTS);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(190);
  });
});
