import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  logApplicationEvent,
  getApplicationEvents,
  getApplicationReminders,
  setApplicationEventsDataDir,
  snoozeApplicationReminder,
  completeApplicationReminder,
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
      remindAt: '2025-02-10T17:30:00Z',
    });

    const events = await getApplicationEvents('job-123');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      channel: 'applied',
      date: '2025-02-03T00:00:00.000Z',
      contact: 'Taylor Recruiter',
      documents: ['resume.pdf', 'cover-letter.pdf'],
      note: 'Referred by Alex',
      remind_at: '2025-02-10T17:30:00.000Z',
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
          remind_at: '2025-02-10T17:30:00.000Z',
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

  it('returns reminders sorted and flags past due entries', async () => {
    await logApplicationEvent('job-1', {
      channel: 'follow_up',
      date: '2025-02-01T10:00:00Z',
      remindAt: '2025-02-10T12:00:00Z',
      note: 'Send thank-you email',
    });
    await logApplicationEvent('job-2', {
      channel: 'call',
      date: '2025-02-02T09:00:00Z',
      remindAt: '2025-02-05T09:00:00Z',
      contact: 'Alex Recruiter',
    });
    await logApplicationEvent('job-3', {
      channel: 'applied',
      date: '2025-02-03T09:00:00Z',
    });

    const reminders = await getApplicationReminders({ now: '2025-02-08T00:00:00Z' });
    expect(reminders).toEqual([
      {
        job_id: 'job-2',
        remind_at: '2025-02-05T09:00:00.000Z',
        channel: 'call',
        contact: 'Alex Recruiter',
        past_due: true,
      },
      {
        job_id: 'job-1',
        remind_at: '2025-02-10T12:00:00.000Z',
        channel: 'follow_up',
        note: 'Send thank-you email',
        past_due: false,
      },
    ]);
  });

  it('omits past due reminders when includePastDue is false', async () => {
    await logApplicationEvent('job-1', {
      channel: 'follow_up',
      date: '2025-02-01T10:00:00Z',
      remindAt: '2025-02-03T12:00:00Z',
    });
    await logApplicationEvent('job-2', {
      channel: 'call',
      date: '2025-02-02T09:00:00Z',
      remindAt: '2025-02-05T09:00:00Z',
    });

    const reminders = await getApplicationReminders({
      now: '2025-02-04T00:00:00Z',
      includePastDue: false,
    });
    expect(reminders).toEqual([
      {
        job_id: 'job-2',
        remind_at: '2025-02-05T09:00:00.000Z',
        channel: 'call',
        past_due: false,
      },
    ]);
  });

  it('snoozes the most recent reminder and preserves prior history', async () => {
    await logApplicationEvent('job-1', {
      channel: 'email',
      date: '2025-02-01T10:00:00Z',
      remindAt: '2025-02-04T09:00:00Z',
      note: 'Initial reach out',
    });
    await logApplicationEvent('job-1', {
      channel: 'call',
      date: '2025-02-02T12:00:00Z',
      remindAt: '2025-02-05T11:00:00Z',
    });

    const result = await snoozeApplicationReminder('job-1', {
      until: '2025-02-07T15:30:00Z',
    });

    expect(result).toMatchObject({
      channel: 'call',
      date: '2025-02-02T12:00:00.000Z',
      remind_at: '2025-02-07T15:30:00.000Z',
    });

    const events = await getApplicationEvents('job-1');
    expect(events).toEqual([
      {
        channel: 'email',
        date: '2025-02-01T10:00:00.000Z',
        note: 'Initial reach out',
        remind_at: '2025-02-04T09:00:00.000Z',
      },
      {
        channel: 'call',
        date: '2025-02-02T12:00:00.000Z',
        remind_at: '2025-02-07T15:30:00.000Z',
      },
    ]);

    const reminders = await getApplicationReminders({ now: '2025-02-06T00:00:00Z' });
    expect(reminders).toEqual([
      {
        job_id: 'job-1',
        remind_at: '2025-02-04T09:00:00.000Z',
        channel: 'email',
        note: 'Initial reach out',
        past_due: true,
      },
      {
        job_id: 'job-1',
        remind_at: '2025-02-07T15:30:00.000Z',
        channel: 'call',
        past_due: false,
      },
    ]);
  });

  it('marks reminders done by clearing remind_at and stamping completion time', async () => {
    await logApplicationEvent('job-2', {
      channel: 'follow_up',
      date: '2025-02-03T09:00:00Z',
      remindAt: '2025-02-08T12:00:00Z',
      note: 'Send prep materials',
    });

    const result = await completeApplicationReminder('job-2', {
      completedAt: '2025-02-06T10:00:00Z',
    });

    expect(result).toMatchObject({
      channel: 'follow_up',
      date: '2025-02-03T09:00:00.000Z',
      note: 'Send prep materials',
      reminder_completed_at: '2025-02-06T10:00:00.000Z',
    });
    expect(result).not.toHaveProperty('remind_at');

    const events = await getApplicationEvents('job-2');
    expect(events).toEqual([
      {
        channel: 'follow_up',
        date: '2025-02-03T09:00:00.000Z',
        note: 'Send prep materials',
        reminder_completed_at: '2025-02-06T10:00:00.000Z',
      },
    ]);

    const reminders = await getApplicationReminders({ now: '2025-02-07T00:00:00Z' });
    expect(reminders).toEqual([]);
  });

  it('rejects snooze or completion when no reminder exists for a job', async () => {
    await logApplicationEvent('job-3', {
      channel: 'applied',
      date: '2025-02-04T11:00:00Z',
    });

    await expect(
      snoozeApplicationReminder('job-3', { until: '2025-02-10T09:00:00Z' }),
    ).rejects.toThrow(/no reminder/i);
    await expect(
      completeApplicationReminder('job-3', { completedAt: '2025-02-05T09:00:00Z' }),
    ).rejects.toThrow(/no reminder/i);
  });
});
