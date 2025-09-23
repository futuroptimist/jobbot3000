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

describe('intake responses', () => {
  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-intake-'));
    const { setIntakeDataDir } = await import('../src/intake.js');
    setIntakeDataDir(dataDir);
    process.env.JOBBOT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    await resetDataDir();
    delete process.env.JOBBOT_DATA_DIR;
    const { setIntakeDataDir } = await import('../src/intake.js');
    setIntakeDataDir(undefined);
  });

  it('records structured responses with normalized metadata', async () => {
    const fs = await import('node:fs/promises');
    const { recordIntakeResponse } = await import('../src/intake.js');

    const entry = await recordIntakeResponse({
      question: '  Career goals?  ',
      answer: '\nBuild accessible tools\n',
      askedAt: '2025-02-01T12:00:00Z',
      tags: ['Growth', 'career', 'growth'],
      notes: ' Prefers mission-driven teams ',
    });

    expect(entry).toMatchObject({
      question: 'Career goals?',
      answer: 'Build accessible tools',
      asked_at: '2025-02-01T12:00:00.000Z',
      tags: ['Growth', 'career'],
      notes: 'Prefers mission-driven teams',
      status: 'answered',
    });
    expect(entry.recorded_at).toEqual(new Date(entry.recorded_at).toISOString());
    expect(typeof entry.id).toBe('string');

    const raw = JSON.parse(
      await fs.readFile(path.join(dataDir, 'profile', 'intake.json'), 'utf8')
    );
    expect(raw.responses).toHaveLength(1);
    expect(raw.responses[0]).toMatchObject({
      id: entry.id,
      question: 'Career goals?',
      answer: 'Build accessible tools',
      asked_at: '2025-02-01T12:00:00.000Z',
      tags: ['Growth', 'career'],
      notes: 'Prefers mission-driven teams',
      status: 'answered',
    });
  });

  it('requires both question and answer', async () => {
    const { recordIntakeResponse } = await import('../src/intake.js');

    await expect(
      recordIntakeResponse({ answer: 'Detailed accomplishments' })
    ).rejects.toThrow(/question is required/);

    await expect(
      recordIntakeResponse({ question: 'Tell me about yourself' })
    ).rejects.toThrow(/answer is required/);
  });

  it('returns intake history in insertion order', async () => {
    const { recordIntakeResponse, getIntakeResponses } = await import('../src/intake.js');

    await recordIntakeResponse({ question: 'First', answer: 'One' });
    await recordIntakeResponse({ question: 'Second', answer: 'Two' });

    const entries = await getIntakeResponses();
    expect(entries.map(entry => entry.question)).toEqual(['First', 'Second']);

    entries[0].question = 'mutated';
    const reread = await getIntakeResponses();
    expect(reread[0].question).toBe('First');
  });

  it('records skipped prompts for future follow-up', async () => {
    const { recordIntakeResponse, getIntakeResponses } = await import('../src/intake.js');

    const entry = await recordIntakeResponse({
      question: 'Which benefits matter most to you?',
      skipped: true,
      notes: 'Revisit after comparing offers',
      tags: ['benefits'],
      askedAt: '2025-02-02T08:00:00Z',
    });

    expect(entry.question).toBe('Which benefits matter most to you?');
    expect(entry.status).toBe('skipped');
    expect(entry.answer).toBe('');
    expect(entry.notes).toBe('Revisit after comparing offers');
    expect(entry.tags).toEqual(['benefits']);

    const responses = await getIntakeResponses();
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      question: 'Which benefits matter most to you?',
      status: 'skipped',
      answer: '',
      notes: 'Revisit after comparing offers',
      asked_at: '2025-02-02T08:00:00.000Z',
    });
  });

  it('synthesizes bullet options from answered responses', async () => {
    const { recordIntakeResponse, getIntakeBulletOptions } = await import('../src/intake.js');

    const leadership = await recordIntakeResponse({
      question: 'Tell me about a leadership win',
      answer: 'Led SRE incident response overhaul',
      tags: ['Leadership', 'SRE'],
      notes: 'Focus on cross-team coordination',
    });

    const metrics = await recordIntakeResponse({
      question: 'Share a metric-driven accomplishment',
      answer: 'Increased activation by 25%\nReduced churn by 10%',
      tags: ['Metrics'],
    });

    await recordIntakeResponse({
      question: 'Which benefits matter most to you?',
      skipped: true,
    });

    const bullets = await getIntakeBulletOptions();
    expect(bullets).toEqual([
      {
        id: `${leadership.id}:0`,
        text: 'Led SRE incident response overhaul',
        tags: ['Leadership', 'SRE'],
        notes: 'Focus on cross-team coordination',
        source: {
          type: 'intake',
          question: 'Tell me about a leadership win',
          response_id: leadership.id,
          asked_at: leadership.asked_at,
          recorded_at: leadership.recorded_at,
        },
      },
      {
        id: `${metrics.id}:0`,
        text: 'Increased activation by 25%',
        tags: ['Metrics'],
        source: {
          type: 'intake',
          question: 'Share a metric-driven accomplishment',
          response_id: metrics.id,
          asked_at: metrics.asked_at,
          recorded_at: metrics.recorded_at,
        },
      },
      {
        id: `${metrics.id}:1`,
        text: 'Reduced churn by 10%',
        tags: ['Metrics'],
        source: {
          type: 'intake',
          question: 'Share a metric-driven accomplishment',
          response_id: metrics.id,
          asked_at: metrics.asked_at,
          recorded_at: metrics.recorded_at,
        },
      },
    ]);

    const metricsOnly = await getIntakeBulletOptions({ tags: ['metrics'] });
    expect(metricsOnly.map(entry => entry.text)).toEqual([
      'Increased activation by 25%',
      'Reduced churn by 10%',
    ]);
  });
});
