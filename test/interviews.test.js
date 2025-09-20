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
});
