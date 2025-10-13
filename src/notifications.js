import fs from 'node:fs/promises';
import path from 'node:path';

import { computeFunnel } from './analytics.js';
import { getApplicationReminders } from './application-events.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SENDER = 'jobbot <no-reply@jobbot.local>';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function sanitizeLine(value) {
  if (value == null) return '';
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatStageLine(stage) {
  if (!stage || typeof stage !== 'object') return null;
  const key = typeof stage.key === 'string' ? stage.key : '';
  const label = typeof stage.label === 'string' ? stage.label : key;
  const display = label ? label : key;
  if (!display) return null;
  const count = Number.isFinite(stage.count) ? stage.count : 0;
  let conversion;
  if (stage.conversionRate === undefined) {
    conversion = 'n/a conversion';
  } else if (!Number.isFinite(stage.conversionRate)) {
    conversion = 'n/a conversion';
  } else {
    const pct = Math.round(stage.conversionRate * 100);
    conversion = `${pct}% conversion`;
  }
  const dropOff = Number.isFinite(stage.dropOff) ? stage.dropOff : 0;
  const dropSuffix = dropOff > 0 ? `, ${dropOff} drop-off` : '';
  return `- ${display}: ${count} (${conversion}${dropSuffix})`;
}

function describeDropOff(largestDrop) {
  if (!largestDrop || typeof largestDrop !== 'object') return null;
  const from = typeof largestDrop.from === 'string' ? largestDrop.from : '';
  const to = typeof largestDrop.to === 'string' ? largestDrop.to : '';
  const drop = Number.isFinite(largestDrop.dropOff) ? largestDrop.dropOff : 0;
  if (!from || !to || drop <= 0) return null;
  const label = `${from} → ${to}`;
  return `Largest drop-off: ${label} (${drop} lost)`;
}

function summarizeReminder(reminder) {
  if (!reminder || typeof reminder !== 'object') return null;
  const when = typeof reminder.remind_at === 'string' ? reminder.remind_at : '';
  const jobId = typeof reminder.job_id === 'string' ? reminder.job_id : 'unknown job';
  const note = sanitizeLine(reminder.note);
  const parts = [`${jobId} at ${when}`];
  if (note) parts.push(note);
  return `- ${parts.join(' — ')}`;
}

export function normalizeRecipientEmail(email) {
  if (typeof email !== 'string') {
    throw new Error('Notification email must be a string');
  }
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('Notification email is required');
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new Error(`Invalid notification email: ${email}`);
  }
  return trimmed;
}

function defaultOutboxDir() {
  return path.join(resolveDataDir(), 'notifications', 'outbox');
}

function resolveOutboxDir(outboxDir) {
  if (!outboxDir) return defaultOutboxDir();
  const trimmed = String(outboxDir).trim();
  if (!trimmed) return defaultOutboxDir();
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
}

function resolveReference(now) {
  if (now === undefined) return new Date();
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) {
      throw new Error(`Invalid notification reference timestamp: ${now}`);
    }
    return new Date(now.getTime());
  }
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid notification reference timestamp: ${now}`);
  }
  return parsed;
}

function createEmailFilename(recipient, reference) {
  const timestamp = reference.toISOString().replace(/[.:]/g, '-');
  const recipientSlug = recipient.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = recipientSlug || 'recipient';
  return `weekly-summary-${timestamp}--${suffix}.eml`;
}

export async function sendWeeklySummaryEmail({
  email,
  now,
  outboxDir,
  sender = DEFAULT_SENDER,
} = {}) {
  const recipient = normalizeRecipientEmail(email);
  const reference = resolveReference(now);
  const periodEnd = new Date(reference.getTime());
  const periodStart = new Date(reference.getTime() - 6 * MS_PER_DAY);

  let funnel;
  try {
    funnel = await computeFunnel({ from: periodStart.toISOString(), to: periodEnd.toISOString() });
  } catch (err) {
    throw new Error(`Failed to compute analytics funnel for notifications: ${err.message || err}`);
  }

  let reminders = [];
  try {
    reminders = await getApplicationReminders({ now: periodEnd, includePastDue: true });
  } catch (err) {
    throw new Error(`Failed to load application reminders: ${err.message || err}`);
  }

  const trackedJobs = funnel?.totals?.trackedJobs ?? 0;
  const outreach = funnel?.totals?.withEvents ?? 0;
  const stages = Array.isArray(funnel?.stages) ? funnel.stages : [];
  const stageLines = stages
    .map(stage => formatStageLine(stage))
    .filter(line => line !== null);
  const dropOffLine = describeDropOff(funnel?.largestDropOff);

  const pastDue = reminders.filter(reminder => reminder?.past_due);
  const upcoming = reminders.filter(reminder => !reminder?.past_due);
  const upcomingHighlights = upcoming.slice(0, 3).map(summarizeReminder).filter(Boolean);
  const pastDueHighlights = pastDue.slice(0, 3).map(summarizeReminder).filter(Boolean);

  const subject = `Jobbot Weekly Summary — ${formatIsoDate(periodEnd)}`;
  const summaryRange = `${formatIsoDate(periodStart)} – ${formatIsoDate(periodEnd)}`;
  const lines = [];
  lines.push(`Here is your job search summary for ${summaryRange}.`);
  lines.push('');
  lines.push(`Tracked jobs: ${trackedJobs}`);
  lines.push(`Outreach logged: ${outreach}`);
  if (stageLines.length > 0) {
    lines.push('');
    lines.push('Stage breakdown:');
    for (const stageLine of stageLines) {
      lines.push(stageLine);
    }
  }
  if (dropOffLine) {
    lines.push('');
    lines.push(dropOffLine);
  }
  lines.push('');
  lines.push(`Upcoming follow-ups: ${upcoming.length}`);
  for (const entry of upcomingHighlights) {
    lines.push(entry);
  }
  lines.push('');
  lines.push(`Past-due follow-ups: ${pastDue.length}`);
  for (const entry of pastDueHighlights) {
    lines.push(entry);
  }
  lines.push('');
  lines.push('Keep the momentum going!');
  lines.push('');
  lines.push('— jobbot3000');

  const body = lines.join('\n');
  const headers = [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    `Date: ${periodEnd.toUTCString()}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
  ];
  const payload = `${headers.join('\n')}${body}`;

  const targetDir = resolveOutboxDir(outboxDir);
  await fs.mkdir(targetDir, { recursive: true });
  const filename = createEmailFilename(recipient, periodEnd);
  const filePath = path.join(targetDir, filename);
  await fs.writeFile(filePath, payload, 'utf8');

  return {
    subject,
    body,
    path: filePath,
    stats: {
      trackedJobs,
      outreach,
      upcoming: upcoming.length,
      pastDue: pastDue.length,
    },
  };
}

export default {
  normalizeRecipientEmail,
  sendWeeklySummaryEmail,
};
