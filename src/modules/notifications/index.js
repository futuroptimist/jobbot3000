import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  computeAnalyticsHealth,
  computeFunnel,
  formatAnalyticsHealthReport,
  formatFunnelReport,
} from '../../analytics.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let overrideRoot;
let featureOverride;
let configFeatureFlag;

function resolveDataDir() {
  if (overrideRoot) return overrideRoot;
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function resolveNotificationsRoot() {
  return path.join(resolveDataDir(), 'notifications');
}

function resolveSubscriptionsFile() {
  return path.join(resolveNotificationsRoot(), 'subscriptions.json');
}

function resolveOutboxDir(outbox) {
  if (outbox) {
    if (path.isAbsolute(outbox)) return outbox;
    return path.resolve(resolveDataDir(), outbox);
  }
  return path.join(resolveNotificationsRoot(), 'outbox');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function coerceBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return undefined;
    if (value === 0) return false;
    return true;
  }
  return undefined;
}

function createWeeklySummaryDisabledError() {
  const error = new Error(
    'Weekly summary notifications are disabled via JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY.',
  );
  error.code = 'NOTIFICATIONS_WEEKLY_DISABLED';
  error.disabled = true;
  return error;
}

function isWeeklySummaryEnabled() {
  if (featureOverride !== undefined) {
    return Boolean(featureOverride);
  }
  if (configFeatureFlag !== undefined) {
    return Boolean(configFeatureFlag);
  }
  const envValue = coerceBoolean(process.env.JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY);
  if (envValue === undefined) return true;
  return envValue;
}

function assertWeeklySummaryEnabled() {
  if (!isWeeklySummaryEnabled()) {
    throw createWeeklySummaryDisabledError();
  }
}

async function readSubscriptions() {
  const file = resolveSubscriptionsFile();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { weeklySummary: [] };
    const weekly = Array.isArray(parsed.weeklySummary) ? parsed.weeklySummary : [];
    return { weeklySummary: weekly };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { weeklySummary: [] };
    }
    throw err;
  }
}

async function writeSubscriptions(contents) {
  const file = resolveSubscriptionsFile();
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
}

function normalizeEmail(email) {
  if (email == null) return '';
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function assertValidEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !EMAIL_RE.test(normalized)) {
    throw new Error(`invalid email address: ${email}`);
  }
  return normalized;
}

function resolveNow(now) {
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) {
      throw new Error(`invalid notification timestamp: ${now}`);
    }
    return now;
  }
  if (typeof now === 'string') {
    const parsed = new Date(now);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`invalid notification timestamp: ${now}`);
    }
    return parsed;
  }
  if (now != null) {
    throw new Error(`invalid notification timestamp: ${now}`);
  }
  return new Date();
}

function formatRangeSummary(fromDate, toDate) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
  const from = formatter.format(fromDate);
  const to = formatter.format(toDate);
  if (from === to) return from;
  return `${from} — ${to}`;
}

function createFileName(now, email) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const slug = normalizeEmail(email)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = slug || 'recipient';
  return `${timestamp}-${suffix}.eml`;
}

function resolveLookbackDays(value) {
  if (value == null) return 7;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('lookbackDays must be a positive number');
  }
  return Math.round(num);
}

export function setNotificationsDataDir(dir) {
  overrideRoot = dir || undefined;
}

export function isWeeklySummaryNotificationsEnabled() {
  return isWeeklySummaryEnabled();
}

export function __setNotificationsFeatureOverrideForTest(value) {
  featureOverride = value;
}

export function __resetNotificationsFeatureOverrideForTest() {
  featureOverride = undefined;
}

export async function listWeeklySummarySubscriptions() {
  const { weeklySummary } = await readSubscriptions();
  return weeklySummary.slice();
}

export async function subscribeWeeklySummary(email, { lookbackDays, now } = {}) {
  assertWeeklySummaryEnabled();
  const normalizedEmail = assertValidEmail(email);
  const resolvedLookback = resolveLookbackDays(lookbackDays);
  const timestamp = resolveNow(now).toISOString();

  const subscriptions = await readSubscriptions();
  const existingIndex = subscriptions.weeklySummary.findIndex(
    entry => normalizeEmail(entry.email) === normalizedEmail,
  );

  if (existingIndex >= 0) {
    const updated = {
      ...subscriptions.weeklySummary[existingIndex],
      email: normalizedEmail,
      lookbackDays: resolvedLookback,
      updatedAt: timestamp,
    };
    subscriptions.weeklySummary[existingIndex] = updated;
    await writeSubscriptions(subscriptions);
    return updated;
  }

  const record = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    lookbackDays: resolvedLookback,
    createdAt: timestamp,
  };
  subscriptions.weeklySummary.push(record);
  await writeSubscriptions(subscriptions);
  return record;
}

async function composeWeeklySummary({ lookbackDays, now }) {
  const timestamp = resolveNow(now);
  const endDate = new Date(timestamp.getTime());
  const startDate = new Date(endDate.getTime() - lookbackDays * MS_PER_DAY);

  const funnel = await computeFunnel({
    from: startDate.toISOString(),
    to: endDate.toISOString(),
  });
  const health = await computeAnalyticsHealth({ now: endDate });

  const funnelReport = formatFunnelReport(funnel);
  const healthReport = formatAnalyticsHealthReport(health);

  const rangeSummary = formatRangeSummary(startDate, endDate);
  const subject = `jobbot3000 weekly summary (${rangeSummary})`;

  const sections = [
    'jobbot3000 weekly summary',
    `Range: ${startDate.toISOString()} → ${endDate.toISOString()}`,
    '',
    'Funnel snapshot',
    '--------------',
    funnelReport.trim(),
    '',
    'Health check',
    '-----------',
    healthReport.trim(),
    '',
    `Sent at ${endDate.toISOString()}`,
  ];

  return { subject, body: sections.join('\n') };
}

async function deliverEmail({ to, subject, body, now, outbox }) {
  const timestamp = resolveNow(now);
  const outboxDir = resolveOutboxDir(outbox);
  await ensureDir(outboxDir);
  const fileName = createFileName(timestamp, to);
  const filePath = path.join(outboxDir, fileName);
  const content = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body.trimEnd(),
    '',
  ].join('\n');
  await fs.writeFile(filePath, `${content}\n`, 'utf8');
  return { filePath, subject, body };
}

export async function sendWeeklySummaryNotification({
  email,
  lookbackDays,
  now,
  outbox,
} = {}) {
  assertWeeklySummaryEnabled();
  const normalizedEmail = assertValidEmail(email);
  const resolvedLookback = resolveLookbackDays(lookbackDays);
  const { subject, body } = await composeWeeklySummary({ lookbackDays: resolvedLookback, now });
  return deliverEmail({ to: normalizedEmail, subject, body, now, outbox });
}

export async function runWeeklySummaryNotifications({ now, outbox } = {}) {
  if (!isWeeklySummaryEnabled()) {
    return { sent: 0, results: [], disabled: true };
  }
  const subscriptions = await listWeeklySummarySubscriptions();
  if (!subscriptions.length) return { sent: 0, results: [] };
  const results = [];
  for (const subscription of subscriptions) {
    const delivery = await sendWeeklySummaryNotification({
      email: subscription.email,
      lookbackDays: subscription.lookbackDays,
      now,
      outbox,
    });
    results.push({ email: subscription.email, file: delivery.filePath });
  }
  return { sent: results.length, results };
}

export default {
  setNotificationsDataDir,
  listWeeklySummarySubscriptions,
  subscribeWeeklySummary,
  sendWeeklySummaryNotification,
  runWeeklySummaryNotifications,
};

export function registerNotificationsModule({ bus, config } = {}) {
  if (!bus || typeof bus.registerHandler !== 'function') {
    throw new Error('registerNotificationsModule requires a module event bus');
  }

  const previousConfigFlag = configFeatureFlag;
  configFeatureFlag = coerceBoolean(config?.features?.notifications?.enableWeeklySummary);

  const disposers = [
    bus.registerHandler('notifications:weekly:subscribe', async payload => {
      const { email, lookbackDays } = payload || {};
      return subscribeWeeklySummary(email, { lookbackDays });
    }),
    bus.registerHandler('notifications:weekly:list', async () => listWeeklySummarySubscriptions()),
    bus.registerHandler('notifications:weekly:run', async payload => {
      const { now, outbox } = payload || {};
      return runWeeklySummaryNotifications({ now, outbox });
    }),
  ];

  return () => {
    configFeatureFlag = previousConfigFlag;
    disposers.splice(0).forEach(dispose => dispose?.());
  };
}
