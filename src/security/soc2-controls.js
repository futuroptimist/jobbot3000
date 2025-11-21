import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let overrideDir;
const fileLocks = new Map();

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setComplianceDataDir(dir) {
  overrideDir = dir || undefined;
}

function changeLogPath() {
  return path.join(resolveDataDir(), 'compliance', 'change-log.json');
}

function incidentLogPath() {
  return path.join(resolveDataDir(), 'compliance', 'incident-reports.json');
}

function withFileLock(file, task) {
  const previous = fileLocks.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const guarded = next.finally(() => {
    if (fileLocks.get(file) === guarded) {
      fileLocks.delete(file);
    }
  });
  fileLocks.set(file, guarded);
  return guarded;
}

async function readEntries(file, key) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const list = parsed[key];
    if (!Array.isArray(list)) return [];
    return list.filter(entry => entry && typeof entry === 'object');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeEntries(file, key, entries) {
  const payload = { [key]: entries };
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const text = typeof value === 'string' ? value : String(value);
  const trimmed = text.trim();
  return trimmed || undefined;
}

function assertRequired(value, name) {
  if (!sanitizeString(value)) {
    throw new Error(`${name} is required`);
  }
}

function normalizeStringArray(input) {
  if (!input) return undefined;
  const values = Array.isArray(input) ? input : [input];
  const normalized = values
    .map(value => sanitizeString(value))
    .filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

export async function listChangeEvents() {
  const file = changeLogPath();
  return readEntries(file, 'changes');
}

export async function recordChangeEvent(input = {}) {
  assertRequired(input.title, 'title');
  assertRequired(input.description, 'description');

  const title = sanitizeString(input.title);
  const description = sanitizeString(input.description);
  const approver = sanitizeString(input.approver);
  const ticket = sanitizeString(input.ticket);
  const deployedBy = sanitizeString(input.deployedBy);
  const deployedAt = sanitizeString(input.deployedAt);

  const file = changeLogPath();
  return withFileLock(file, async () => {
    const entries = await readEntries(file, 'changes');
    const entry = {
      id: randomUUID(),
      title,
      description,
      approver,
      ticket,
      deployed_by: deployedBy,
      deployed_at: deployedAt,
      recorded_at: new Date().toISOString(),
    };
    entries.push(entry);
    await writeEntries(file, 'changes', entries);
    return entry;
  });
}

const SEVERITY = ['low', 'medium', 'high', 'critical'];

function normalizeSeverity(value) {
  if (!value) return 'medium';
  const normalized = String(value).trim().toLowerCase();
  if (!SEVERITY.includes(normalized)) {
    throw new Error(`severity must be one of: ${SEVERITY.join(', ')}`);
  }
  return normalized;
}

export async function listIncidentReports() {
  const file = incidentLogPath();
  return readEntries(file, 'incidents');
}

export async function recordIncidentReport(input = {}) {
  assertRequired(input.title, 'title');
  assertRequired(input.summary, 'summary');

  const severity = normalizeSeverity(input.severity);
  const impactedSystems = normalizeStringArray(input.impactedSystems);
  const responder = sanitizeString(input.responder);
  const detectedAt = sanitizeString(input.detectedAt);
  const resolvedAt = sanitizeString(input.resolvedAt);

  const file = incidentLogPath();
  return withFileLock(file, async () => {
    const entries = await readEntries(file, 'incidents');
    const entry = {
      id: randomUUID(),
      title: sanitizeString(input.title),
      summary: sanitizeString(input.summary),
      severity,
      impacted_systems: impactedSystems,
      responder,
      detected_at: detectedAt,
      resolved_at: resolvedAt,
      recorded_at: new Date().toISOString(),
    };
    entries.push(entry);
    await writeEntries(file, 'incidents', entries);
    return entry;
  });
}
