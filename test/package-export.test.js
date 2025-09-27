import { describe, it, expect } from 'vitest';
import {
  summarize,
  listExperimentsForStatus,
  getExperimentById,
  analyzeExperiment,
} from 'jobbot3000';

describe('jobbot3000 package exports', () => {
  it('re-exports the documented public API from the package root', async () => {
    const module = await import('../src/index.js');
    expect(summarize).toBe(module.summarize);
    expect(listExperimentsForStatus).toBe(module.listExperimentsForStatus);
    expect(getExperimentById).toBe(module.getExperimentById);
    expect(analyzeExperiment).toBe(module.analyzeExperiment);
  });
});
