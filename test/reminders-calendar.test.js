import { describe, it, expect } from 'vitest';

import { createReminderCalendar } from '../src/reminders-calendar.js';

function extractDescription(ics) {
  const lines = ics.split('\r\n');
  let buffer = '';
  let capturing = false;
  for (const line of lines) {
    if (!capturing && line.startsWith('DESCRIPTION:')) {
      buffer += line.slice('DESCRIPTION:'.length);
      capturing = true;
      continue;
    }
    if (capturing) {
      if (line.startsWith(' ')) {
        buffer += line.slice(1);
        continue;
      }
      break;
    }
  }
  return buffer;
}

describe('createReminderCalendar', () => {
  it('produces ICS events with escaped fields and deterministic stamps', () => {
    const ics = createReminderCalendar(
      [
        {
          job_id: 'job-upcoming',
          remind_at: '2025-03-10T15:30:00Z',
          channel: 'call',
          contact: 'Jordan, Recruiting',
          note: 'Discuss offer; bring resume',
        },
      ],
      { now: '2025-03-06T00:00:00Z', calendarName: 'Reminder Feed' },
    );

    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0')).toBe(true);
    expect(ics).toContain('PRODID:-//jobbot3000//Reminders//EN');
    expect(ics).toContain('NAME:Reminder Feed');
    expect(ics).toContain('DTSTAMP:20250306T000000Z');
    expect(ics).toContain('DTSTART:20250310T153000Z');
    expect(ics).toContain('SUMMARY:job-upcoming — call');
    expect(ics).toContain('CONTACT:Jordan\\, Recruiting');

    const description = extractDescription(ics);
    const expectedDescription = [
      'Job ID: job-upcoming',
      'Channel: call',
      'Contact: Jordan\\, Recruiting',
      'Note: Discuss offer\\; bring resume',
    ].join('\\n');
    expect(description).toBe(expectedDescription);
  });

  it('skips invalid reminders and sorts by start time', () => {
    const ics = createReminderCalendar(
      [
        { job_id: 'job-invalid', remind_at: 'not-a-date' },
        { job_id: 'job-late', remind_at: '2025-04-01T12:00:00Z', channel: 'email' },
        { job_id: 'job soon', remind_at: '2025-04-01T09:00:00Z', channel: 'meeting' },
      ],
      { now: '2025-03-30T00:00:00Z' },
    );

    const summaries = ics
      .split('\r\n')
      .filter(line => line.startsWith('SUMMARY:'))
      .map(line => line.slice('SUMMARY:'.length));
    expect(summaries).toEqual(['job soon — meeting', 'job-late — email']);

    const uids = ics
      .split('\r\n')
      .filter(line => line.startsWith('UID:'))
      .map(line => line.slice('UID:'.length));
    expect(uids[0].startsWith('job-soon-')).toBe(true);
    expect(uids[1].startsWith('job-late-')).toBe(true);
    expect(ics).not.toContain('job-invalid');
  });
});

