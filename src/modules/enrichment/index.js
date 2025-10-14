import { runResumePipeline } from './pipeline/resume.js';
import { loadResume } from './resume.js';
import { matchResumeToJob } from './match.js';

export function registerEnrichmentModule({ bus } = {}) {
  if (!bus || typeof bus.registerHandler !== 'function') {
    throw new Error('registerEnrichmentModule requires a module event bus');
  }

  const handlers = [
    bus.registerHandler('enrichment:resume:load', async payload => {
      const { filePath, options } = payload || {};
      return loadResume(filePath, options);
    }),
    bus.registerHandler('enrichment:resume:run', async payload => {
      const { filePath, options } = payload || {};
      return runResumePipeline(filePath, options);
    }),
    bus.registerHandler('enrichment:match:resume-to-job', async payload => {
      const { resumeText, job, options } = payload || {};
      return matchResumeToJob(resumeText, job, options);
    }),
  ];

  return () => handlers.splice(0).forEach(dispose => dispose?.());
}

export const enrichmentModule = {
  runResumePipeline,
  loadResume,
  matchResumeToJob,
};
