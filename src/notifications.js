import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  computeFunnel,
  formatFunnelReport,
  computeAnalyticsHealth,
  formatAnalyticsHealthReport,
} from './analytics.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function endOfUtcDay(date) {
  const result = new Date(date);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function ensureDate(input, label) {
  if (input == null) return new Date();
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new Error(`Invalid ${label || 'date'}: ${input}`);
    }
    return input;
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label || 'date'}: ${input}`);
  }
  return parsed;
}

function normalizeRangeDays(value) {
  if (value == null) return 7;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('rangeDays must be a positive number');
  }
  return Math.max(1, Math.floor(number));
}

function normalizeEmailList(list) {
  const raw = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : [];
  const emails = raw
    .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  if (emails.length === 0) {
    throw new Error('At least one recipient is required');
  }
  return emails;
}

function normalizeSender(value) {
  if (value == null) return 'jobbot3000 <jobbot@localhost>';
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error('Sender address must be a non-empty string');
  }
  return trimmed;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatMissingStatuses(missing) {
  const count = Number.isFinite(missing?.count) ? missing.count : 0;
  if (count <= 0) return 'none';
  const ids = Array.isArray(missing?.ids) ? missing.ids.filter(Boolean) : [];
  const noun = count === 1 ? 'job' : 'jobs';
  if (ids.length === 0) return `${count} ${noun}`;
  const preview = ids.slice(0, 5);
  const suffix = ids.length > preview.length ? '…' : '';
  return `${count} ${noun} (${preview.join(', ')}${suffix})`;
}

function formatDropOff(largestDropOff) {
  if (!largestDropOff || !Number.isFinite(largestDropOff.dropOff)) return 'none';
  if (largestDropOff.dropOff <= 0) return 'none';
  const from = largestDropOff.fromLabel || largestDropOff.from || 'previous stage';
  const to = largestDropOff.toLabel || largestDropOff.to || 'next stage';
  const suffix = largestDropOff.dropOff === 1 ? 'lost' : 'lost';
  return `${from} → ${to} (${largestDropOff.dropOff} ${suffix})`;
}

function formatHealthLines(report) {
  if (!report) return ['No analytics health data available'];
  return report
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function buildEmailBody({
  fromDate,
  toDate,
  funnel,
  funnelReport,
  healthReport,
}) {
  const tracked = funnel?.totals?.trackedJobs ?? 0;
  const outreach = funnel?.totals?.withEvents ?? 0;
  const missingStatuses = formatMissingStatuses(funnel?.missing?.statuslessJobs);
  const dropOff = formatDropOff(funnel?.largestDropOff);
  const healthLines = formatHealthLines(healthReport);

  const lines = [];
  lines.push('jobbot3000 Weekly Summary');
  lines.push(`Range: ${formatIsoDate(fromDate)} → ${formatIsoDate(toDate)}`);
  lines.push('');
  lines.push('Pipeline overview:');
  lines.push(`- Tracked jobs touched: ${tracked}`);
  lines.push(`- Outreach recorded: ${outreach}`);
  lines.push(`- Largest drop-off: ${dropOff}`);
  lines.push(`- Missing statuses: ${missingStatuses}`);
  lines.push('');
  lines.push('Health checks:');
  if (healthLines.length === 0) {
    lines.push('- None reported');
  } else {
    for (const line of healthLines) {
      lines.push(`- ${line}`);
    }
  }
  lines.push('');
  lines.push('Detailed funnel:');
  if (funnelReport) {
    lines.push(funnelReport);
  } else {
    lines.push('No analytics data available');
  }
  lines.push('');
  lines.push('Stay focused and close the loop on outstanding follow-ups.');
  lines.push('');
  lines.push('— jobbot3000');
  return lines.join('\n');
}

function formatMessageId(timestamp) {
  const random = crypto.randomBytes(6).toString('hex');
  return `<jobbot-weekly-summary-${timestamp}-${random}@jobbot.local>`;
}

function formatEmailPayload({ subject, from, to, text, now }) {
  const recipients = Array.isArray(to) ? to.join(', ') : String(to);
  const dateHeader = ensureDate(now, 'email timestamp').toUTCString();
  const timestamp = ensureDate(now, 'email timestamp').toISOString().replace(/[:.]/g, '');
  const headers = [
    `From: ${from}`,
    `To: ${recipients}`,
    `Subject: ${subject}`,
    `Date: ${dateHeader}`,
    `Message-ID: ${formatMessageId(timestamp)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
  ].join('\r\n');
  const body = text.replace(/\r?\n/g, '\r\n');
  return `${headers}\r\n\r\n${body}\r\n`;
}

function buildOutboxPath(outboxDir) {
  if (outboxDir) {
    return path.isAbsolute(outboxDir) ? outboxDir : path.resolve(outboxDir);
  }
  return path.join(resolveDataDir(), 'notifications', 'outbox');
}

function buildOutboxFileName({ fromDate, toDate, now }) {
  const start = formatIsoDate(fromDate).replace(/-/g, '');
  const end = formatIsoDate(toDate).replace(/-/g, '');
  const stamp = ensureDate(now, 'email timestamp').toISOString().replace(/[:.]/g, '');
  return `weekly-summary-${start}-${end}-${stamp}.eml`;
}

export async function composeWeeklySummaryEmail(options = {}) {
  const now = ensureDate(options.now, 'reference timestamp');
  const rangeDays = normalizeRangeDays(options.rangeDays);
  const toDate = endOfUtcDay(now);
  const rawFromDate = new Date(toDate.getTime() - (rangeDays - 1) * MS_PER_DAY);
  const fromDate = startOfUtcDay(rawFromDate);

  const funnel = await computeFunnel({ from: fromDate.toISOString(), to: toDate.toISOString() });
  const funnelReport = formatFunnelReport(funnel);
  const health = await computeAnalyticsHealth({ now: toDate });
  const healthReport = formatAnalyticsHealthReport(health);

  const subjectPrefix = typeof options.subjectPrefix === 'string' && options.subjectPrefix.trim()
    ? options.subjectPrefix.trim()
    : 'jobbot3000 Weekly Summary';
  const subject = `${subjectPrefix} (${formatIsoDate(fromDate)} → ${formatIsoDate(toDate)})`;

  const text = buildEmailBody({ fromDate, toDate, funnel, funnelReport, healthReport });
  const to = normalizeEmailList(options.to);
  const from = normalizeSender(options.from);

  return {
    subject,
    text,
    to,
    from,
    range: { from: fromDate.toISOString(), to: toDate.toISOString() },
    stats: {
      trackedJobs: funnel?.totals?.trackedJobs ?? 0,
      outreach: funnel?.totals?.withEvents ?? 0,
      missingStatuses: funnel?.missing?.statuslessJobs?.count ?? 0,
      largestDropOff: funnel?.largestDropOff?.dropOff ?? 0,
    },
    funnelReport,
    healthReport,
    now,
  };
}

export async function sendWeeklySummaryEmail(options = {}) {
  const email = await composeWeeklySummaryEmail(options);
  const now = email.now ?? ensureDate(options.now, 'reference timestamp');
  const outboxDir = buildOutboxPath(options.outboxDir);
  const fileName = buildOutboxFileName({
    fromDate: new Date(email.range.from),
    toDate: new Date(email.range.to),
    now,
  });
  const filePath = path.join(outboxDir, fileName);
  const payload = formatEmailPayload({
    subject: email.subject,
    from: email.from,
    to: email.to,
    text: email.text,
    now,
  });

  await fs.mkdir(outboxDir, { recursive: true });
  await fs.writeFile(filePath, payload, 'utf8');

  return {
    ...email,
    outboxPath: filePath,
    payload,
  };
}

export default {
  composeWeeklySummaryEmail,
  sendWeeklySummaryEmail,
};
