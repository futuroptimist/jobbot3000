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
});
