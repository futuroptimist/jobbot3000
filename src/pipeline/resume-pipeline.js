import path from 'node:path';

import { loadResume } from '../resume.js';

/**
 * Stage-driven helper that runs the resume ingestion pipeline against a single source file.
 * Each stage mutates the shared context with typed outputs so downstream consumers can
 * inspect intermediate results (plain-text resume, metadata, warning heuristics) or insert
 * new stages without rewriting the orchestration logic. The default implementation wires the
 * existing `loadResume` helper into a reusable pipeline surface.
 */

function cloneEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(entry => ({ ...entry }));
}

const RESUME_PIPELINE_STAGES = [
  {
    name: 'load',
    run: async (context, options = {}) => {
      const withMetadata = options.withMetadata !== false;
      const result = await loadResume(context.filePath, { withMetadata });
      if (typeof result === 'string') {
        context.text = result;
        context.metadata = undefined;
        return { text: result, metadata: undefined };
      }
      const { text, metadata } = result;
      context.text = text;
      context.metadata = metadata;
      return { text, metadata };
    },
  },
  {
    name: 'analyze',
    run: context => {
      const metadata = context.metadata || {};
      const warnings = cloneEntries(metadata.warnings);
      const ambiguities = cloneEntries(metadata.ambiguities);
      const confidence = metadata.confidence
        ? { ...metadata.confidence }
        : { score: undefined, signals: [] };

      const analysis = {
        warnings,
        ambiguities,
        warningCount: warnings.length,
        ambiguityCount: ambiguities.length,
        confidence,
      };

      context.analysis = analysis;
      return analysis;
    },
  },
];

export async function runResumePipeline(filePath, options = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('resume path is required');
  }

  const resolved = path.resolve(filePath);
  const context = {
    filePath: resolved,
    source: { path: resolved },
    stages: [],
  };

  for (const stage of RESUME_PIPELINE_STAGES) {
    const output = await stage.run(context, options);
    context.stages.push({ name: stage.name, output });
  }

  return {
    source: context.source,
    text: context.text,
    metadata: context.metadata,
    analysis: context.analysis,
    stages: context.stages.map(stage => ({ name: stage.name, output: stage.output })),
  };
}

export { RESUME_PIPELINE_STAGES };
