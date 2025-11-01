import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir;

async function resetDataDir() {
  if (dataDir) {
    const fs = await import('node:fs/promises');
    await fs.rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
}

describe('intake question plan', () => {
  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-intake-plan-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
    const { setIntakePlanDataDir } = await import('../src/intake-plan.js');
    setIntakePlanDataDir(dataDir);
  });

  afterEach(async () => {
    await resetDataDir();
    delete process.env.JOBBOT_DATA_DIR;
    const { setIntakePlanDataDir } = await import('../src/intake-plan.js');
    setIntakePlanDataDir(undefined);
  });

  it('suggests core questions when profile data is sparse', async () => {
    const { initProfile } = await import('../src/profile.js');
    await initProfile({ force: true });

    const { plan } = await (await import('../src/intake-plan.js')).loadIntakeQuestionPlan();
    const ids = plan.map(item => item.id);
    expect(ids).toEqual([
      'career_goals',
      'relocation_preferences',
      'compensation_guardrails',
      'visa_status',
      'measurable_outcomes',
      'tool_stack',
    ]);

    const first = plan[0];
    expect(first).toMatchObject({
      id: 'career_goals',
      tags: ['career', 'goals'],
    });
    expect(first.reason).toContain('summary');
  });

  it('omits topics already covered by intake responses or resume data', async () => {
    const fs = await import('node:fs/promises');
    const profileDir = path.join(dataDir, 'profile');
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, 'resume.json'),
      JSON.stringify(
        {
          basics: {
            summary: 'Senior SRE focused on reliable user-facing platforms.',
            location: { city: 'Seattle', region: 'WA', country: 'USA' },
            },
            work: [
              {
                summary:
                  'Improved availability from 98.5% to 99.95% by ' +
                  'automating incident response.',
                highlights: ['Cut MTTR by 40% over six months.'],
              },
          ],
          skills: [
            { name: 'Go' },
            { name: 'Kubernetes' },
            { name: 'Terraform' },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const { recordIntakeResponse } = await import('../src/intake.js');
    await recordIntakeResponse({
      question: 'Where are you willing to relocate?',
      answer: 'Open to West Coast US and remote-first roles.',
      tags: ['relocation'],
    });
    await recordIntakeResponse({
      question: 'Share your compensation guardrails.',
      answer: 'Targeting $185k-$210k base with total comp flexibility for high-growth teams.',
      tags: ['compensation'],
    });
    await recordIntakeResponse({
      question: 'Work authorization constraints?',
      answer: 'US citizen, no sponsorship required.',
      tags: ['visa'],
    });

    const { plan } = await (await import('../src/intake-plan.js')).loadIntakeQuestionPlan();
    expect(plan).toEqual([]);
  });

  it('exposes manual question templates for fallback intake flows', async () => {
    const { loadIntakeQuestionPlan } = await import('../src/intake-plan.js');
    const result = await loadIntakeQuestionPlan();

    expect(Array.isArray(result.manualTemplates)).toBe(true);
    expect(result.manualTemplates.length).toBeGreaterThan(0);

    for (const template of result.manualTemplates) {
      expect(template).toMatchObject({
        id: expect.any(String),
        category: expect.any(String),
        prompt: expect.any(String),
      });
      expect(Array.isArray(template.tags)).toBe(true);
      expect(template.tags.length).toBeGreaterThan(0);
      if (template.starter) {
        expect(typeof template.starter).toBe('string');
        expect(template.starter.length).toBeGreaterThan(0);
      }
    }
  });

  it('still asks for measurable outcomes when resume lacks numeric signals', async () => {
    const fs = await import('node:fs/promises');
    const profileDir = path.join(dataDir, 'profile');
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, 'resume.json'),
      JSON.stringify(
        {
          basics: {
            summary:
              'Product leader focused on empowering teams to ship user impact through clarity.',
            location: { city: 'Denver', region: 'CO', country: 'USA' },
          },
          work: [
            {
              summary: 'Managed cross-functional team delivering onboarding improvements.',
              highlights: [
                'Shepherded rollout of new activation journey across design, marketing, and data.',
              ],
            },
          ],
          skills: [
            { name: 'Product discovery' },
            { name: 'Experimentation' },
            { name: 'Cross-functional leadership' },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const { recordIntakeResponse } = await import('../src/intake.js');
    await recordIntakeResponse({
      question: 'Share your compensation guardrails.',
      answer: 'Comfortable from $170k base with flexibility for equity.',
      tags: ['compensation'],
    });
    await recordIntakeResponse({
      question: 'Where are you open to working next?',
      answer: 'Prefer Mountain West but open to hybrid coastal roles.',
      tags: ['relocation'],
    });
    await recordIntakeResponse({
      question: 'Any work authorization constraints?',
      answer: 'Permanent resident, no sponsorship needed.',
      tags: ['visa'],
    });

    const { plan } = await (await import('../src/intake-plan.js')).loadIntakeQuestionPlan();
    expect(plan.map(item => item.id)).toEqual(['measurable_outcomes']);
  });

  it('loads intake plans from a custom resume path', async () => {
    const fs = await import('node:fs/promises');
    const customDir = path.join(dataDir, 'custom-profile');
    await fs.mkdir(customDir, { recursive: true });
    const customResumePath = path.join(customDir, 'resume.json');
    await fs.writeFile(
      customResumePath,
      JSON.stringify(
        {
          basics: {
            summary: 'Staff product manager focused on metrics-driven growth.',
            location: { city: 'Austin', region: 'TX', country: 'USA' },
          },
          work: [
            {
              summary: 'Delivered onboarding experiments that increased activation.',
              highlights: ['Raised activation by 18% through funnel instrumentation.'],
            },
          ],
          skills: [{ name: 'Product discovery' }, { name: 'Experimentation' }, { name: 'SQL' }],
        },
        null,
        2,
      ),
      'utf8',
    );

    const { loadIntakeQuestionPlan } = await import('../src/intake-plan.js');
    const result = await loadIntakeQuestionPlan({ profilePath: customResumePath });

    expect(result.plan.map(item => item.id)).toEqual([
      'relocation_preferences',
      'compensation_guardrails',
      'visa_status',
    ]);
    expect(result.resumePath).toBe(customResumePath);
  });
});
