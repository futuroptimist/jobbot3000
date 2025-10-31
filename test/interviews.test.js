import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setSettingsDataDir, updateSettings } from '../src/settings.js';

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
    setSettingsDataDir(undefined);
  });

  it('persists transcripts, reflections, and feedback per session', async () => {
    const { setInterviewDataDir, recordInterviewSession, getInterviewSession } = await import(
      '../src/interviews.js'
    );

    setInterviewDataDir(dataDir);

    const recorded = await recordInterviewSession('job-123', 'session-abc', {
      transcript:
        '  Practiced STAR story covering situation, task, action, and result.  ',
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
      transcript: 'Practiced STAR story covering situation, task, action, and result.',
      reflections: ['Focus on capacity planning'],
      feedback: ['Dive deeper on trade-offs'],
      started_at: '2025-02-01T10:00:00.000Z',
      ended_at: '2025-02-01T11:15:00.000Z',
      heuristics: {
        brevity: {
          word_count: 9,
          sentence_count: 1,
          average_sentence_words: 9,
          estimated_wpm: 0.1,
        },
        filler_words: {
          total: 0,
          counts: {},
        },
        structure: {
          star: {
            mentioned: ['situation', 'task', 'action', 'result'],
            missing: [],
          },
        },
        critique: {
          tighten_this: [],
        },
      },
    });

    const fetched = await getInterviewSession('job-123', 'session-abc');
    expect(fetched).toEqual(disk);
  });

  it('rejects missing identifiers', async () => {
    const { setInterviewDataDir, recordInterviewSession } = await import('../src/interviews.js');
    setInterviewDataDir(dataDir);

    await expect(recordInterviewSession('', 's1', { transcript: 'x' })).rejects.toThrow(
      'job id is required'
    );
    await expect(recordInterviewSession('job', '', { transcript: 'x' })).rejects.toThrow(
      'session id is required'
    );
  });

  it('records sessions with default metadata when optional fields are omitted', async () => {
    const { setInterviewDataDir, recordInterviewSession, getInterviewSession } = await import(
      '../src/interviews.js'
    );

    setInterviewDataDir(dataDir);

    const recorded = await recordInterviewSession('job-empty', 'session-empty', {});

    expect(recorded).toMatchObject({
      job_id: 'job-empty',
      session_id: 'session-empty',
      stage: 'Behavioral',
      mode: 'Voice',
    });
    expect(recorded).toHaveProperty('recorded_at');
    expect(recorded).not.toHaveProperty('transcript');
    expect(recorded).not.toHaveProperty('reflections');
    expect(recorded).not.toHaveProperty('feedback');
    expect(recorded).not.toHaveProperty('notes');
    expect(recorded).not.toHaveProperty('heuristics');

    const fromDisk = await getInterviewSession('job-empty', 'session-empty');
    expect(fromDisk).toEqual(recorded);
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

  it('summarizes filler words and STAR coverage in heuristics', async () => {
    const { setInterviewDataDir, recordInterviewSession } = await import(
      '../src/interviews.js'
    );

    setInterviewDataDir(dataDir);

    const entry = await recordInterviewSession('job-heuristics', 'session-2', {
      transcript:
        'Um I was like thinking, you know, about the task result and I uh kind of stalled.',
      startedAt: '2025-02-02T12:00:00Z',
      endedAt: '2025-02-02T12:05:00Z',
    });

    expect(entry.heuristics).toEqual({
      brevity: {
        word_count: 17,
        sentence_count: 1,
        average_sentence_words: 17,
        estimated_wpm: 3.4,
      },
      filler_words: {
        total: 5,
        counts: {
          um: 1,
          like: 1,
          'you know': 1,
          uh: 1,
          'kind of': 1,
        },
      },
      structure: {
        star: {
          mentioned: ['task', 'result'],
          missing: ['situation', 'action'],
        },
      },
      critique: {
        tighten_this: [
          'Tighten this: reduce filler words—5 across 17 words (~29%).',
          'Tighten this: add STAR coverage for situation, action.',
        ],
      },
    });
  });

  it('omits stored transcripts when privacy settings disable retention', async () => {
    const {
      setInterviewDataDir,
      recordInterviewSession,
      getInterviewSession,
    } = await import('../src/interviews.js');

    setInterviewDataDir(dataDir);
    setSettingsDataDir(dataDir);
    await updateSettings({ privacy: { storeInterviewTranscripts: false } });

    const entry = await recordInterviewSession('job-privacy', 'session-keep', {
      transcript: 'Practiced STAR response focused on impact.',
      reflections: ['Focus on brevity'],
    });

    expect(entry).not.toHaveProperty('transcript');
    expect(entry.heuristics).toBeDefined();

    const stored = await getInterviewSession('job-privacy', 'session-keep');
    expect(stored).not.toHaveProperty('transcript');
    expect(stored.heuristics).toBeDefined();
  });

  it('stores audio source metadata when provided', async () => {
    const { setInterviewDataDir, recordInterviewSession } = await import('../src/interviews.js');

    setInterviewDataDir(dataDir);

    const recorded = await recordInterviewSession('job-audio', 'session-audio', {
      transcript: 'Voice rehearsal summary',
      audioSource: { type: 'file', name: 'answer.wav' },
    });

    expect(recorded.audio_source).toEqual({ type: 'file', name: 'answer.wav' });

    const disk = await readSession('job-audio', 'session-audio');
    expect(disk.audio_source).toEqual({ type: 'file', name: 'answer.wav' });
  });

  it('exports interview sessions as a zip manifest', async () => {
    const {
      setInterviewDataDir,
      recordInterviewSession,
      exportInterviewSessions,
    } = await import('../src/interviews.js');

    setInterviewDataDir(dataDir);

    await recordInterviewSession('job-zip', 'session-one', {
      transcript: 'First session',
      stage: 'Behavioral',
      startedAt: '2025-02-01T09:00:00Z',
      endedAt: '2025-02-01T09:30:00Z',
    });

    await recordInterviewSession('job-zip', 'session-two', {
      transcript: 'Second session',
      stage: 'Onsite',
      mode: 'Voice',
      startedAt: '2025-02-02T17:00:00Z',
      endedAt: '2025-02-02T18:00:00Z',
    });

    const archive = await exportInterviewSessions('job-zip');

    const zip = await JSZip.loadAsync(archive);
    const manifestRaw = await zip.file('manifest.json')?.async('string');
    expect(manifestRaw).toBeTruthy();

    const manifest = JSON.parse(manifestRaw);
    expect(manifest).toMatchObject({
      job_id: 'job-zip',
      total_sessions: 2,
    });
    expect(Array.isArray(manifest.sessions)).toBe(true);
    expect(manifest.sessions).toHaveLength(2);
    expect(manifest.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          session_id: 'session-two',
          stage: 'Onsite',
          mode: 'Voice',
          file: 'sessions/session-two.json',
        }),
        expect.objectContaining({
          session_id: 'session-one',
          stage: 'Behavioral',
          mode: 'Voice',
          file: 'sessions/session-one.json',
        }),
      ]),
    );
    for (const entry of manifest.sessions) {
      expect(typeof entry.recorded_at).toBe('string');
    }

    const storedOne = await zip.file('sessions/session-one.json')?.async('string');
    const storedTwo = await zip.file('sessions/session-two.json')?.async('string');
    expect(storedOne).toContain('First session');
    expect(storedTwo).toContain('Second session');
  });

it('throws when exporting a job without sessions', async () => {
  const { setInterviewDataDir, exportInterviewSessions } = await import('../src/interviews.js');
  setInterviewDataDir(dataDir);

  await expect(exportInterviewSessions('job-empty')).rejects.toThrow(
    'No interview sessions found for job-empty',
  );
});
});

describe('interview reminders', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-reminders-'));
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it('flags stale interview practice and empty jobs', async () => {
    const { setInterviewDataDir, listInterviewReminders } = await import(
      '../src/interviews.js'
    );

    setInterviewDataDir(dataDir);

    const interviewsRoot = path.join(dataDir, 'interviews');
    await fs.mkdir(interviewsRoot, { recursive: true });

    const staleDir = path.join(interviewsRoot, 'job-stale');
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(
      path.join(staleDir, 'session-1.json'),
      `${JSON.stringify(
        {
          recorded_at: '2025-02-20T10:00:00.000Z',
          stage: 'Onsite',
          mode: 'Voice',
          heuristics: { critique: { tighten_this: [' tighten transitions ', ''] } },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const freshDir = path.join(interviewsRoot, 'job-fresh');
    await fs.mkdir(freshDir, { recursive: true });
    await fs.writeFile(
      path.join(freshDir, 'session-1.json'),
      `${JSON.stringify({ recorded_at: '2025-03-26T09:00:00.000Z' }, null, 2)}\n`,
      'utf8',
    );

    const emptyDir = path.join(interviewsRoot, 'job-empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const reminders = await listInterviewReminders({
      now: '2025-03-30T12:00:00.000Z',
      staleAfterDays: 7,
    });

    expect(reminders).toEqual([
      {
        job_id: 'job-stale',
        reason: 'stale',
        sessions: 1,
        last_session_at: '2025-02-20T10:00:00.000Z',
        stale_for_days: 38,
        stage: 'Onsite',
        mode: 'Voice',
        suggestions: ['tighten transitions'],
      },
      {
        job_id: 'job-empty',
        reason: 'no_sessions',
        sessions: 0,
        message: 'No rehearsal sessions have been recorded yet.',
      },
    ]);
  });

  it('derives timestamps from started_at when recorded_at is missing', async () => {
    const { setInterviewDataDir, listInterviewReminders } = await import(
      '../src/interviews.js'
    );

    setInterviewDataDir(dataDir);

    const jobDir = path.join(dataDir, 'interviews', 'job-started');
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(
      path.join(jobDir, 'session-1.json'),
      `${JSON.stringify(
        {
          started_at: '2025-01-01T09:30:00.000Z',
          heuristics: {},
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const reminders = await listInterviewReminders({
      now: '2025-01-10T09:30:00.000Z',
      staleAfterDays: 3,
    });

    expect(reminders).toEqual([
      {
        job_id: 'job-started',
        reason: 'stale',
        sessions: 1,
        last_session_at: '2025-01-01T09:30:00.000Z',
        stale_for_days: 9,
      },
    ]);
  });

  it('returns an empty list when no reminders are due', async () => {
    const { setInterviewDataDir, listInterviewReminders } = await import(
      '../src/interviews.js'
    );

    setInterviewDataDir(dataDir);
    const reminders = await listInterviewReminders({
      now: '2025-02-01T00:00:00.000Z',
      staleAfterDays: 5,
    });
    expect(reminders).toEqual([]);
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

  it('supplies dialog trees with branching follow-ups', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'behavioral' });

    expect(Array.isArray(plan.dialog_tree)).toBe(true);
    expect(plan.dialog_tree.length).toBeGreaterThan(0);
    expect(plan.dialog_tree[0]).toMatchObject({
      id: 'opener',
      prompt: expect.stringContaining('recent project'),
    });
    expect(plan.dialog_tree[0].follow_ups).toEqual(
      expect.arrayContaining([expect.stringMatching(/metrics/i)]),
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

  it('supports onsite rehearsal plans focused on logistics and follow-up', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'onsite', role: 'Engineering Manager' });

    expect(plan.stage).toBe('Onsite');
    expect(plan.duration_minutes).toBeGreaterThanOrEqual(120);
    expect(plan.summary).toMatch(/onsite/i);
    const sectionTitles = plan.sections.map(section => section.title);
    expect(sectionTitles).toEqual(expect.arrayContaining(['Agenda review', 'Follow-up']));
    const followUpSection = plan.sections.find(section => section.title === 'Follow-up');
    expect(followUpSection.items.join(' ')).toMatch(/thank-you/i);
    expect(plan.resources).toContain('Onsite checklist');
    expect(plan.flashcards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          front: 'Panel transitions',
          back: expect.stringMatching(/expectations/i),
        }),
      ]),
    );
    expect(plan.question_bank).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt: expect.stringMatching(/debrief/i),
          tags: expect.arrayContaining(['Strategy']),
        }),
      ]),
    );
    expect(Array.isArray(plan.dialog_tree)).toBe(true);
    expect(plan.dialog_tree.length).toBeGreaterThan(0);
    expect(plan.dialog_tree[0]).toMatchObject({
      prompt: expect.stringMatching(/onsite/i),
    });
    expect(plan.dialog_tree[0].follow_ups).toEqual(
      expect.arrayContaining([expect.stringMatching(/thank-you/i)]),
    );
  });

  it('provides recruiter screen plans that center narrative and logistics', async () => {
    const { generateRehearsalPlan } = await import('../src/interviews.js');

    const plan = generateRehearsalPlan({ stage: 'screen', role: 'Product Manager' });

    expect(plan.stage).toBe('Screen');
    expect(plan.summary).toMatch(/recruiter screen/i);
    expect(plan.sections.map(section => section.title)).toEqual(
      expect.arrayContaining(['Pitch warm-up', 'Logistics & next steps']),
    );
    const logistics = plan.sections.find(section => section.title === 'Logistics & next steps');
    expect(logistics.items.join(' ')).toMatch(/timeline/i);
    expect(plan.resources).toEqual(
      expect.arrayContaining([
        'Recruiter alignment checklist',
        'Compensation research worksheet',
      ]),
    );
    expect(plan.flashcards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ front: 'Recruiter pitch' }),
      ]),
    );
    expect(plan.question_bank).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tags: expect.arrayContaining(['Motivation']) }),
      ]),
    );
    expect(plan.dialog_tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'opener',
          follow_ups: expect.arrayContaining([
            expect.stringMatching(/highlights/i),
          ]),
        }),
      ]),
    );
  });
});

describe('generateSystemDesignOutline', () => {
  it('produces a structured outline with kickoff through wrap-up segments', async () => {
    const { generateSystemDesignOutline } = await import('../src/interviews.js');

    const outline = generateSystemDesignOutline({ role: ' Staff Engineer ', durationMinutes: 90 });

    expect(outline.stage).toBe('System Design');
    expect(outline.role).toBe('Staff Engineer');
    expect(outline.duration_minutes).toBe(90);
    expect(Array.isArray(outline.segments)).toBe(true);
    expect(outline.segments).toHaveLength(5);
    expect(outline.segments[0]).toMatchObject({
      title: expect.stringContaining('Kickoff'),
      goal: expect.stringMatching(/success metrics/i),
    });
    expect(outline.segments[0].prompts).toEqual(
      expect.arrayContaining([expect.stringMatching(/traffic expectations/i)]),
    );
    expect(outline.segments.find(segment => segment.title.includes('Wrap-up'))).toBeDefined();
    expect(outline.checklists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Diagram essentials',
          items: expect.arrayContaining([expect.stringMatching(/label/i)]),
        }),
      ]),
    );
    expect(outline.follow_up_questions).toEqual(
      expect.arrayContaining([expect.stringMatching(/trade-offs/i)]),
    );
  });

  it('defaults to a 75-minute outline when overrides are omitted', async () => {
    const { generateSystemDesignOutline } = await import('../src/interviews.js');

    const outline = generateSystemDesignOutline();

    expect(outline.stage).toBe('System Design');
    expect(outline.duration_minutes).toBe(75);
    expect(outline.segments.some(segment => /Scaling & reliability/i.test(segment.title))).toBe(
      true,
    );
  });
});
