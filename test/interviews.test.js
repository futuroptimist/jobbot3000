import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir;

async function readSession(jobId, sessionId) {
  const file = path.join(dataDir, 'interviews', jobId, `${sessionId}.json`);
  const contents = await fs.readFile(file, 'utf8');
  return JSON.parse(contents);
}

describe('interview session archive', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-interviews-'));
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it('persists transcripts, reflections, and feedback per session', async () => {
    const { setInterviewDataDir, recordInterviewSession, getInterviewSession } = await import(
      '../src/interviews.js'
    );

    setInterviewDataDir(dataDir);

    const recorded = await recordInterviewSession('job-123', 'session-abc', {
      transcript: '  Practiced system design prompt.  ',
      reflections: ['Focus on capacity planning', ''],
      feedback: ['Dive deeper on trade-offs', 'dive deeper on trade-offs'],
      stage: 'Onsite',
      mode: 'Voice',
      startedAt: '2025-02-01T10:00:00Z',
      endedAt: new Date('2025-02-01T11:15:00Z'),
    });

    const disk = await readSession('job-123', 'session-abc');

    expect(disk).toEqual({
      job_id: 'job-123',
      session_id: 'session-abc',
      recorded_at: recorded.recorded_at,
      stage: 'Onsite',
      mode: 'Voice',
      transcript: 'Practiced system design prompt.',
      reflections: ['Focus on capacity planning'],
      feedback: ['Dive deeper on trade-offs'],
      started_at: '2025-02-01T10:00:00.000Z',
      ended_at: '2025-02-01T11:15:00.000Z',
    });

    const fetched = await getInterviewSession('job-123', 'session-abc');
    expect(fetched).toEqual(disk);
  });

  it('rejects missing identifiers or empty payloads', async () => {
    const { setInterviewDataDir, recordInterviewSession } = await import('../src/interviews.js');
    setInterviewDataDir(dataDir);

    await expect(recordInterviewSession('', 's1', { transcript: 'x' })).rejects.toThrow(
      'job id is required'
    );
    await expect(recordInterviewSession('job', '', { transcript: 'x' })).rejects.toThrow(
      'session id is required'
    );
    await expect(recordInterviewSession('job', 's1', {})).rejects.toThrow(
      'at least one session field is required'
    );
  });

  it('rejects identifiers that escape the interviews directory', async () => {
    const { setInterviewDataDir, recordInterviewSession, getInterviewSession } = await import(
      '../src/interviews.js'
    );
    setInterviewDataDir(dataDir);

    await expect(recordInterviewSession('../job', 's1', { transcript: 'x' })).rejects.toThrow(
      'job id cannot contain path separators'
    );

    await expect(recordInterviewSession('job', '..', { transcript: 'x' })).rejects.toThrow(
      'session id cannot reference parent directories'
    );

    await expect(getInterviewSession('job/../evil', 's1')).rejects.toThrow(
      'job id cannot contain path separators'
    );
  });

  it('returns null when a session is missing', async () => {
    const { setInterviewDataDir, getInterviewSession } = await import('../src/interviews.js');
    setInterviewDataDir(dataDir);

    const result = await getInterviewSession('job-404', 'missing');
    expect(result).toBeNull();
  });

  it('defaults stage and mode when omitted', async () => {
    const { setInterviewDataDir, recordInterviewSession } = await import('../src/interviews.js');

    setInterviewDataDir(dataDir);

    const recorded = await recordInterviewSession('job-default', 'session-default', {
      transcript: 'Practiced elevator pitch.',
    });

    expect(recorded).toMatchObject({
      stage: 'Behavioral',
      mode: 'Voice',
    });

    const disk = await readSession('job-default', 'session-default');
    expect(disk).toMatchObject({
      stage: 'Behavioral',
      mode: 'Voice',
    });
  });
});

describe('generateRehearsalPlan', () => {
  it('creates a behavioral rehearsal plan with role-specific guidance', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'behavioral', role: 'Staff Engineer' });

    expect(plan.stage).toBe('Behavioral');
    expect(plan.role).toBe('Staff Engineer');
    expect(plan.duration_minutes).toBeGreaterThan(0);
    expect(plan.summary).toMatch(/Staff Engineer/);
    expect(plan.summary).toMatch(/STAR/);
    expect(Array.isArray(plan.sections)).toBe(true);
    expect(plan.sections[0]).toMatchObject({ title: 'Warm-up' });
    const warmupItems = plan.sections[0].items.join(' ');
    expect(warmupItems).toMatch(/STAR stories/i);
    expect(plan.resources).toContain('Behavioral question bank');
  });

  it('returns technical plans when stage is specified', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'technical' });

    expect(plan.stage).toBe('Technical');
    expect(plan.duration_minutes).toBeGreaterThanOrEqual(45);
    const sectionTitles = plan.sections.map(section => section.title);
    expect(sectionTitles).toContain('Core practice');
    const practiceItems = plan.sections.find(section => section.title === 'Core practice').items;
    expect(practiceItems.join(' ')).toMatch(/pair programming/i);
    expect(plan.resources).toContain('Algorithm drill set');
  });

  it('packages flashcards and a question bank for study packets', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'technical' });

    expect(Array.isArray(plan.flashcards)).toBe(true);
    expect(plan.flashcards.length).toBeGreaterThan(0);
    expect(plan.flashcards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          front: 'Debugging loop',
          back: expect.stringContaining('Reproduce'),
        }),
      ]),
    );

    expect(Array.isArray(plan.question_bank)).toBe(true);
    expect(plan.question_bank.length).toBeGreaterThan(0);
    expect(plan.question_bank).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt: expect.stringContaining('memory leak'),
          tags: expect.arrayContaining(['Debugging']),
        }),
      ]),
    );
  });

  it('honors duration overrides for system design plans', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'system-design', durationMinutes: 50 });

    expect(plan.stage).toBe('System Design');
    expect(plan.duration_minutes).toBe(50);
    const architectureSection = plan.sections.find(section => section.title === 'Architecture');
    expect(architectureSection).toBeDefined();
    expect(architectureSection.items.join(' ')).toMatch(/data flow/i);
    expect(plan.resources).toContain('System design checklist');
  });

  it('provides take-home rehearsal plans with delivery checklist', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'take-home' });

    expect(plan.stage).toBe('Take-Home');
    expect(plan.sections.map(section => section.title)).toContain('Review & delivery');
    const deliverySection = plan.sections.find(section => section.title === 'Review & delivery');
    expect(deliverySection.items.join(' ')).toMatch(/lint/i);
    expect(plan.resources).toContain('Take-home submission rubric');
  });
});
