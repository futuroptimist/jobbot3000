const PROD_ID = '-//jobbot3000//Reminders//EN';
const DEFAULT_CALENDAR_NAME = 'jobbot3000 Reminders';

function coerceDate(value, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${label} must be a valid date`);
    }
    return value;
  }

  if (value == null) {
    return new Date();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return parsed;
}

function formatDateTimeUtc(date) {
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line) {
  if (line.length <= 75) {
    return line;
  }

  const segments = [];
  let remaining = line;
  while (remaining.length > 75) {
    let segment = remaining.slice(0, 75);
    remaining = remaining.slice(75);
    while (segment.endsWith('\\') && remaining.length > 0) {
      segment += remaining[0];
      remaining = remaining.slice(1);
    }
    segments.push(segment);
  }
  if (remaining) {
    segments.push(remaining);
  }
  return segments.map((segment, index) => (index === 0 ? segment : ` ${segment}`)).join('\r\n');
}

function sanitizeJobId(jobId) {
  if (!jobId) return 'jobbot3000';
  return String(jobId).replace(/[^A-Za-z0-9-]+/g, '-');
}

function buildDescription(reminder) {
  const lines = [];
  if (reminder.job_id) {
    lines.push(`Job ID: ${reminder.job_id}`);
  }
  if (reminder.channel) {
    lines.push(`Channel: ${reminder.channel}`);
  }
  if (reminder.contact) {
    lines.push(`Contact: ${reminder.contact}`);
  }
  if (reminder.note) {
    lines.push(`Note: ${reminder.note}`);
  }
  return escapeText(lines.join('\n'));
}

export function createReminderCalendar(reminders, options = {}) {
  if (!Array.isArray(reminders)) {
    throw new Error('reminders must be an array');
  }

  const now = coerceDate(options.now ?? new Date(), 'now');
  const calendarName =
    typeof options.calendarName === 'string' && options.calendarName.trim()
      ? options.calendarName.trim()
      : DEFAULT_CALENDAR_NAME;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PROD_ID}`,
    'CALSCALE:GREGORIAN',
    foldLine(`NAME:${escapeText(calendarName)}`),
    foldLine(`X-WR-CALNAME:${escapeText(calendarName)}`),
  ];

  const sorted = reminders
    .filter(entry => entry && typeof entry.remind_at === 'string')
    .map(entry => {
      const remindDate = new Date(entry.remind_at);
      if (Number.isNaN(remindDate.getTime())) {
        return null;
      }
      return { ...entry, remindDate };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.remindDate < b.remindDate) return -1;
      if (a.remindDate > b.remindDate) return 1;
      const aId = String(a.job_id || '');
      const bId = String(b.job_id || '');
      return aId.localeCompare(bId);
    });

  const dtstamp = formatDateTimeUtc(now);

  for (const reminder of sorted) {
    const summaryBase = reminder.job_id ? String(reminder.job_id) : 'Reminder';
    const summary = reminder.channel
      ? `${summaryBase} — ${reminder.channel}`
      : summaryBase;
    const uid = `${sanitizeJobId(reminder.job_id)}-${reminder.remindDate.getTime()}@jobbot3000`;
    const description = buildDescription(reminder);
    const dtstart = formatDateTimeUtc(reminder.remindDate);

    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${uid}`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${dtstart}`);
    lines.push(foldLine(`SUMMARY:${escapeText(summary)}`));
    if (description) {
      lines.push(foldLine(`DESCRIPTION:${description}`));
    }
    if (reminder.contact) {
      lines.push(foldLine(`CONTACT:${escapeText(reminder.contact)}`));
    }
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:PT0S');
    lines.push('ACTION:DISPLAY');
    lines.push(foldLine(`DESCRIPTION:${escapeText(summary)}`));
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return `${lines.join('\r\n')}\r\n`;
}

