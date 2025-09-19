import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  logApplicationEvent,
  getApplicationEvents,
  setApplicationEventsDataDir,
} from '../src/application-events.js';

const dataDirRoot = path.resolve('test', 'tmp-events');
const eventsFile = path.join(dataDirRoot, 'application_events.json');

async function readEventsFile() {
  return JSON.parse(await fs.readFile(eventsFile, 'utf8'));
}

describe('application events', () => {
  beforeEach(async () => {
    await fs.rm(dataDirRoot, { recursive: true, force: true });
    setApplicationEventsDataDir(dataDirRoot);
  });

  afterEach(async () => {
    setApplicationEventsDataDir(undefined);
    await fs.rm(dataDirRoot, { recursive: true, force: true });
  });

  it('records channel, date, contact, documents, and notes per job', async () => {
    await logApplicationEvent('job-123', {
      channel: 'applied',
      date: '2025-02-03',
      contact: 'Taylor Recruiter',
      documents: ['resume.pdf', 'cover-letter.pdf'],
      note: 'Referred by Alex',
    });

    const events = await getApplicationEvents('job-123');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      channel: 'applied',
      date: '2025-02-03T00:00:00.000Z',
      contact: 'Taylor Recruiter',
      documents: ['resume.pdf', 'cover-letter.pdf'],
      note: 'Referred by Alex',
    });

    const raw = await readEventsFile();
    expect(raw).toEqual({
      'job-123': [
        {
          channel: 'applied',
          date: '2025-02-03T00:00:00.000Z',
          contact: 'Taylor Recruiter',
          documents: ['resume.pdf', 'cover-letter.pdf'],
          note: 'Referred by Alex',
        },
      ],
    });
  });

  it('appends additional events without clobbering prior history', async () => {
    await logApplicationEvent('job-123', {
      channel: 'applied',
      date: '2025-02-03T12:00:00Z',
    });
    await logApplicationEvent('job-123', {
      channel: 'follow_up',
      date: '2025-02-10T09:30:00Z',
      note: 'Sent thank-you email',
    });

    const events = await getApplicationEvents('job-123');
    expect(events).toEqual([
      {
        channel: 'applied',
        date: '2025-02-03T12:00:00.000Z',
      },
      {
        channel: 'follow_up',
        date: '2025-02-10T09:30:00.000Z',
        note: 'Sent thank-you email',
      },
    ]);
  });

  it('returns empty arrays for jobs with no events logged', async () => {
    const events = await getApplicationEvents('missing-job');
    expect(events).toEqual([]);
  });

  it('rejects unknown channels or invalid dates', async () => {
    await expect(
      logApplicationEvent('job-123', { channel: '', date: '2025-01-01' }),
    ).rejects.toThrow(/channel is required/);
    await expect(
      logApplicationEvent('job-123', { channel: 'applied', date: 'not-a-date' }),
    ).rejects.toThrow(/invalid date/);
  });
});
