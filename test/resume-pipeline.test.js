import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runResumePipeline } from '../src/pipeline/resume-pipeline.js';

const FIXTURE_DIR = path.resolve('test', 'fixtures');

const CASES = [
  {
    name: 'markdown resume with ATS warnings and placeholder metrics',
    file: 'resume-pipeline.md',
    expect: {
      format: 'markdown',
      warningTypes: ['tables', 'images'],
      requiredAmbiguityTypes: ['metric'],
    },
  },
  {
    name: 'plain text resume without warnings',
    file: 'resume.txt',
    expect: {
      format: 'text',
      warningTypes: [],
      requiredAmbiguityTypes: ['metrics'],
    },
  },
];

describe('resume pipeline', () => {
  for (const testCase of CASES) {
    it(`processes ${testCase.name}`, async () => {
      const filePath = path.join(FIXTURE_DIR, testCase.file);
      const context = await runResumePipeline(filePath);

      expect(context.source.path).toBe(filePath);
      expect(context.metadata.format).toBe(testCase.expect.format);
      expect(Array.isArray(context.stages)).toBe(true);
      expect(context.stages.map(stage => stage.name)).toEqual(
        expect.arrayContaining(['load', 'analyze']),
      );

      const warningTypes = (context.analysis.warnings || []).map(entry => entry.type);
      expect(new Set(warningTypes)).toEqual(new Set(testCase.expect.warningTypes));

      const ambiguityTypes = (context.analysis.ambiguities || []).map(entry => entry.type);
      for (const type of testCase.expect.requiredAmbiguityTypes) {
        expect(ambiguityTypes).toContain(type);
      }
    });
  }

  it('summarizes analysis metrics for downstream consumers', async () => {
    const filePath = path.join(FIXTURE_DIR, 'resume-pipeline.md');
    const { analysis } = await runResumePipeline(filePath);

    expect(analysis.warningCount).toBe(2);
    expect(analysis.ambiguityCount).toBeGreaterThanOrEqual(2);
    expect(analysis.confidence.score).toBeGreaterThan(0);
    expect(analysis.confidence.signals.length).toBeGreaterThan(0);
  });
});
