import { recruiterEmailIngestInputSchema } from '../domain/opportunity.js';
import { applyLifecycleTransition } from '../domain/lifecycle.js';

const MONTHS = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

const TIMEZONE_OFFSETS = {
  PT: -7,
  PDT: -7,
  PST: -8,
  MT: -6,
  MDT: -6,
  MST: -7,
  CT: -5,
  CDT: -5,
  CST: -6,
  ET: -4,
  EDT: -4,
  EST: -5,
};

function parseHeaders(raw) {
  const lines = raw.split(/\r?\n/);
  const headers = {};
  for (const line of lines) {
    if (!line.trim()) break;
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (!headers[key]) headers[key] = value;
  }
  return headers;
}

function parseFrom(value) {
  if (!value) return {};
  const match = value.match(/^(.*)<([^>]+)>/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '');
    const email = match[2].trim();
    return { name, email };
  }
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (trimmed.includes('@')) return { email: trimmed };
  return { name: trimmed };
}

function guessCompany({ subject, email }) {
  if (subject) {
    const parts = subject.split(/[-:]/).map(part => part.trim()).filter(Boolean);
    if (parts.length) {
      return parts[0];
    }
  }
  if (email && email.includes('@')) {
    const domain = email.split('@')[1];
    const name = domain.split('.')[0];
    if (name) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return 'Unknown Company';
}

function guessRole({ subject }) {
  if (!subject) return undefined;
  const match = subject.match(/for\s+(.+)$/i) || subject.match(/-\s*(.+)$/);
  if (match) {
    return match[1].trim();
  }
  return undefined;
}

function parseSchedule(body, fallbackYear) {
  const scheduleRegex = new RegExp(
    '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+' +
      '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+' +
      '(\\d{1,2}),\\s*(\\d{1,2}):(\\d{2})\\s*' +
      '(AM|PM)\\s*([A-Z]{2,4})',
    'i',
  );
  const match = body.match(scheduleRegex);
  if (!match) return null;
  const [, , monthText, day, hour, minute, meridiem, timezone] = match;
  const month = MONTHS[monthText];
  if (!month) return null;
  const dayNum = String(day).padStart(2, '0');
  let hourNum = Number(hour);
  if (meridiem.toUpperCase() === 'PM' && hourNum < 12) {
    hourNum += 12;
  }
  if (meridiem.toUpperCase() === 'AM' && hourNum === 12) {
    hourNum = 0;
  }
  const offsetHours = TIMEZONE_OFFSETS[timezone.toUpperCase()] ?? 0;
  const utcDate = new Date(
    Date.UTC(
      fallbackYear,
      Number(month) - 1,
      Number(dayNum),
      hourNum - offsetHours,
      Number(minute),
    ),
  );
  const iso = utcDate.toISOString();
  const upperMeridiem = meridiem.toUpperCase();
  const upperTimezone = timezone.toUpperCase();
  const display = `${monthText} ${day}, ${hour}:${minute} ${upperMeridiem} ${upperTimezone}`;
  return {
    iso,
    display,
    timezone: upperTimezone,
  };
}

function extractBody(raw) {
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length <= 1) return raw;
  return parts.slice(1).join('\n\n');
}

export function ingestRecruiterEmail({ raw, repo, audit }) {
  const parsed = recruiterEmailIngestInputSchema.parse({ raw });
  const headers = parseHeaders(parsed.raw);
  const from = parseFrom(headers.from);
  const subject = headers.subject;
  const sentAtHeader = headers.date ? new Date(headers.date) : new Date();
  const sentAt = Number.isNaN(sentAtHeader.getTime())
    ? new Date().toISOString()
    : sentAtHeader.toISOString();
  const year = Number.isNaN(sentAtHeader.getTime())
    ? new Date().getFullYear()
    : sentAtHeader.getFullYear();
  const body = extractBody(parsed.raw);
  const schedule = parseSchedule(body, year);
  const company = guessCompany({ subject, email: from.email });
  const roleHint = guessRole({ subject });

  const opportunity = repo.upsertOpportunity({
    company,
    roleHint,
    contactEmail: from.email,
    contactName: from.name,
    lifecycleState: 'recruiter_outreach',
    firstSeenAt: sentAt,
    subject,
    source: 'recruiter_email',
  });

  const events = [];
  const auditEntries = [];

  const outreachEvent = repo.appendEvent({
    opportunityUid: opportunity.uid,
    type: 'recruiter_outreach_received',
    occurredAt: sentAt,
    payload: {
      subject,
      snippet: body.slice(0, 280),
    },
    lifecycleState: 'recruiter_outreach',
  });
  if (outreachEvent) {
    events.push(outreachEvent);
    const auditEntry = audit?.append({
      opportunityUid: opportunity.uid,
      action: 'recruiter_outreach_received',
      occurredAt: outreachEvent.occurredAt,
      relatedEventUid: outreachEvent.eventUid,
      payload: {
        subject,
        from,
      },
    });
    if (auditEntry) auditEntries.push(auditEntry);
  }

  let currentState = 'recruiter_outreach';
  if (schedule) {
    const transition = applyLifecycleTransition(opportunity.uid, currentState, {
      from: 'recruiter_outreach',
      to: 'phone_screen_scheduled',
      occurredAt: schedule.iso,
      note: 'Phone screen proposed by recruiter email',
    });

    const updated = repo.upsertOpportunity({
      company,
      roleHint,
      contactEmail: from.email,
      contactName: from.name,
      lifecycleState: transition.lifecycleState,
      firstSeenAt: sentAt,
      lastEventAt: transition.occurredAt,
      subject,
      source: 'recruiter_email',
    });
    if (updated) {
      currentState = updated.lifecycleState;
    }

    const lifecycleEvent = repo.appendEvent({
      opportunityUid: opportunity.uid,
      type: transition.event.type,
      occurredAt: transition.event.occurredAt,
      eventUid: transition.event.eventUid,
      payload: transition.event.payload,
      lifecycleState: transition.lifecycleState,
    });
    if (lifecycleEvent) {
      events.push(lifecycleEvent);
      const auditEntry = audit?.append({
        opportunityUid: opportunity.uid,
        action: 'lifecycle_transition',
        occurredAt: lifecycleEvent.occurredAt,
        relatedEventUid: lifecycleEvent.eventUid,
        payload: lifecycleEvent.payload,
      });
      if (auditEntry) auditEntries.push(auditEntry);
    }

    const phoneEvent = repo.appendEvent({
      opportunityUid: opportunity.uid,
      type: 'phone_screen_scheduled',
      occurredAt: schedule.iso,
      payload: {
        scheduledAt: schedule.iso,
        display: schedule.display,
        timezone: schedule.timezone,
      },
      lifecycleState: currentState,
    });
    if (phoneEvent) {
      events.push(phoneEvent);
      const auditEntry = audit?.append({
        opportunityUid: opportunity.uid,
        action: 'phone_screen_scheduled',
        occurredAt: phoneEvent.occurredAt,
        relatedEventUid: phoneEvent.eventUid,
        payload: phoneEvent.payload,
      });
      if (auditEntry) auditEntries.push(auditEntry);
    }
  }

  const finalOpportunity = repo.getOpportunityByUid(opportunity.uid);

  return {
    opportunity: finalOpportunity ?? opportunity,
    events,
    auditEntries,
    schedule,
  };
}
