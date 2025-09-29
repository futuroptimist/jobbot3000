import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setActivityDataDir,
  summarizeDeliverableRuns,
  summarizeInterviewSessions,
  summarizeJobActivity,
} from '../src/activity-insights.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-activity-'));
  setActivityDataDir(tmpDir);
});

afterEach(() => {
  setActivityDataDir(undefined);
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('summarizeDeliverableRuns', () => {
  it('counts deliverable runs and reports most recent timestamp', async () => {
    const jobDir = path.join(tmpDir, 'deliverables', 'job-123');
    fs.mkdirSync(path.join(jobDir, '2025-03-01T10-00-00Z'), { recursive: true });
    const runFile = path.join(jobDir, '2025-03-01T10-00-00Z', 'resume.pdf');
    fs.writeFileSync(runFile, 'resume');
    const legacyFile = path.join(jobDir, 'legacy-output.txt');
    fs.writeFileSync(legacyFile, 'legacy');

    const expected = new Date('2025-03-01T10:00:00.000Z');
    fs.utimesSync(runFile, expected, expected);
    fs.utimesSync(path.join(jobDir, '2025-03-01T10-00-00Z'), expected, expected);

    const summary = await summarizeDeliverableRuns('job-123');
    expect(summary).toMatchObject({ runs: 1 });
    expect(summary.last_run_at).toBeDefined();
    expect(new Date(summary.last_run_at).getTime()).toBe(expected.getTime());
  });
});

describe('summarizeInterviewSessions', () => {
  it('summarizes interview sessions and exposes most recent session details', async () => {
    const jobDir = path.join(tmpDir, 'interviews', 'job-123');
    fs.mkdirSync(jobDir, { recursive: true });
    const sessionPath = path.join(jobDir, 'prep-2025-03-02.json');
    const payload = {
      session_id: 'prep-2025-03-02',
      recorded_at: '2025-03-02T09:30:00.000Z',
      stage: 'Onsite',
      mode: 'Voice',
      heuristics: {
        critique: { tighten_this: ['Tighten this: trim filler words.'] },
      },
    };
    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2));

    const summary = await summarizeInterviewSessions('job-123');
    expect(summary).toMatchObject({ sessions: 1 });
    expect(summary.last_session).toMatchObject({
      session_id: 'prep-2025-03-02',
      recorded_at: '2025-03-02T09:30:00.000Z',
      recorded_at_source: 'recorded_at',
      stage: 'Onsite',
      mode: 'Voice',
    });
    expect(summary.last_session?.critique?.tighten_this).toEqual([
      'Tighten this: trim filler words.',
    ]);
  });

  it('falls back to started_at when recorded_at is invalid', async () => {
    const jobDir = path.join(tmpDir, 'interviews', 'job-456');
    fs.mkdirSync(jobDir, { recursive: true });
    const sessionPath = path.join(jobDir, 'prep-invalid.json');
    const payload = {
      session_id: 'prep-invalid',
      recorded_at: 'not-a-timestamp',
      started_at: '2025-03-04T17:20:00.000Z',
      stage: 'Screen',
      mode: 'Voice',
    };
    fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2));

    const legacyMtime = new Date('2024-12-31T23:59:59.000Z');
    fs.utimesSync(sessionPath, legacyMtime, legacyMtime);

    const summary = await summarizeInterviewSessions('job-456');
    expect(summary?.last_session).toMatchObject({
      recorded_at: '2025-03-04T17:20:00.000Z',
      recorded_at_source: 'started_at',
    });
  });

  it('falls back to the session file mtime when timestamps are missing', async () => {
    const jobId = 'job-fallback';
    const jobDir = path.join(tmpDir, 'interviews', jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const sessionPath = path.join(jobDir, 'session.json');
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ session_id: 'session-1', transcript: 'Quick notes' }, null, 2),
    );

    const expected = new Date('2025-04-05T12:34:56.000Z');
    fs.utimesSync(sessionPath, expected, expected);

    const summary = await summarizeJobActivity(jobId);
    expect(summary?.interviews?.last_session).toMatchObject({
      recorded_at: expected.toISOString(),
      recorded_at_source: 'file_mtime',
    });
  });

  it('counts sessions recorded after a provided timestamp', async () => {
    const jobDir = path.join(tmpDir, 'interviews', 'job-correlation');
    fs.mkdirSync(jobDir, { recursive: true });
    const early = {
      session_id: 'session-early',
      recorded_at: '2025-03-01T08:00:00.000Z',
      stage: 'Screen',
    };
    const late = {
      session_id: 'session-late',
      recorded_at: '2025-03-15T09:30:00.000Z',
      stage: 'Onsite',
    };
    fs.writeFileSync(
      path.join(jobDir, 'early.json'),
      JSON.stringify(early, null, 2),
    );
    fs.writeFileSync(
      path.join(jobDir, 'late.json'),
      JSON.stringify(late, null, 2),
    );

    const summary = await summarizeInterviewSessions('job-correlation', {
      after: '2025-03-10T00:00:00.000Z',
    });
    expect(summary?.sessions_after_last_deliverable).toBe(1);
  });
});

describe('summarizeJobActivity', () => {
  it('combines deliverable and interview insights', async () => {
    const deliverableDir = path.join(tmpDir, 'deliverables', 'job-xyz', '2025-02-01T10-00-00Z');
    fs.mkdirSync(deliverableDir, { recursive: true });
    fs.writeFileSync(path.join(deliverableDir, 'resume.pdf'), 'data');

    const interviewDir = path.join(tmpDir, 'interviews', 'job-xyz');
    fs.mkdirSync(interviewDir, { recursive: true });
    fs.writeFileSync(
      path.join(interviewDir, 'session.json'),
      JSON.stringify({
        session_id: 'session-1',
        recorded_at: '2025-02-02T11:00:00.000Z',
        stage: 'Behavioral',
        mode: 'Voice',
      }),
    );

    const activity = await summarizeJobActivity('job-xyz');
    expect(activity?.deliverables?.runs).toBe(1);
    expect(activity?.interviews?.sessions).toBe(1);
    expect(activity?.interviews?.sessions_after_last_deliverable).toBe(1);
  });

  it('returns null when no activity exists', async () => {
    const activity = await summarizeJobActivity('job-missing');
    expect(activity).toBeNull();
  });
});
