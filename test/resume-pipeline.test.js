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
      const stageNames = context.stages.map(stage => stage.name);
      expect(stageNames).toEqual(
        expect.arrayContaining(['load', 'normalize', 'enrich', 'analyze']),
      );

      const normalizeStage = context.stages.find(stage => stage.name === 'normalize');
      expect(normalizeStage).toBeDefined();
      expect(context.normalized).toEqual(normalizeStage.output);
      expect(normalizeStage.output).toMatchObject({
        lineCount: expect.any(Number),
        nonEmptyLineCount: expect.any(Number),
        wordCount: expect.any(Number),
        sections: expect.any(Object),
        sectionOrder: expect.any(Array),
      });

      if (testCase.name.includes('markdown')) {
        expect(normalizeStage.output.sections.experience).toEqual(
          expect.arrayContaining(['Senior Developer at Example Corp']),
        );
        expect(normalizeStage.output.sections.skills).toBeDefined();
      } else {
        expect(normalizeStage.output.sections.body).toEqual(
          expect.arrayContaining(['I am an engineer with JavaScript experience.']),
        );
      }

      const enrichStage = context.stages.find(stage => stage.name === 'enrich');
      expect(enrichStage).toBeDefined();
      expect(context.enrichment).toEqual(enrichStage.output);
      if (testCase.name.includes('markdown')) {
        expect(enrichStage.output.sections.experience).toMatchObject({
          lineCount: 3,
          hasMetrics: false,
          hasPlaceholders: true,
        });
        expect(enrichStage.output.sections.skills).toMatchObject({ hasMetrics: true });
        expect(enrichStage.output.sections.projects).toBeUndefined();
        expect(enrichStage.output.missingSections).toEqual(
          expect.arrayContaining(['projects', 'education']),
        );
      } else {
        expect(enrichStage.output.sections.body).toMatchObject({
          lineCount: 1,
          hasMetrics: false,
          hasPlaceholders: false,
        });
        expect(enrichStage.output.missingSections).toEqual(
          expect.arrayContaining(['experience', 'projects', 'education', 'skills']),
        );
      }

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
