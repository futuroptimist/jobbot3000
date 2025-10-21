import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exportAnalyticsSnapshotMock = vi.fn();
const getIntakeResponsesMock = vi.fn();
const exportInterviewSessionsMock = vi.fn();

vi.mock('../src/analytics.js', async () => {
  const actual = await vi.importActual('../src/analytics.js');
  return {
    ...actual,
    exportAnalyticsSnapshot: exportAnalyticsSnapshotMock,
  };
});

vi.mock('../src/intake.js', async () => {
  const actual = await vi.importActual('../src/intake.js');
  return {
    ...actual,
    getIntakeResponses: getIntakeResponsesMock,
  };
});

vi.mock('../src/interviews.js', async () => {
  const actual = await vi.importActual('../src/interviews.js');
  return {
    ...actual,
    exportInterviewSessions: exportInterviewSessionsMock,
  };
});

async function readAuditEntries(logPath) {
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

const originalAuditLogPath = process.env.JOBBOT_AUDIT_LOG;
const originalAuditRetention = process.env.JOBBOT_AUDIT_RETENTION_DAYS;
let tmpDir;

beforeEach(async () => {
  vi.resetModules();
  exportAnalyticsSnapshotMock.mockReset().mockResolvedValue({
    generated_at: '2025-01-01T00:00:00Z',
    totals: {},
  });
  getIntakeResponsesMock.mockReset().mockResolvedValue([]);
  exportInterviewSessionsMock.mockReset().mockResolvedValue(Buffer.from('zip'));
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-cli-audit-'));
  process.env.JOBBOT_AUDIT_LOG = path.join(tmpDir, 'audit.log');
  delete process.env.JOBBOT_AUDIT_RETENTION_DAYS;
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
  if (originalAuditLogPath === undefined) {
    delete process.env.JOBBOT_AUDIT_LOG;
  } else {
    process.env.JOBBOT_AUDIT_LOG = originalAuditLogPath;
  }
  if (originalAuditRetention === undefined) {
    delete process.env.JOBBOT_AUDIT_RETENTION_DAYS;
  } else {
    process.env.JOBBOT_AUDIT_RETENTION_DAYS = originalAuditRetention;
  }
});

describe('CLI data export audit logging', () => {
  it('records audit entries for analytics export', async () => {
    exportAnalyticsSnapshotMock.mockResolvedValueOnce({
      generated_at: '2025-01-02T00:00:00Z',
      totals: {},
    });
    const outputPath = path.join(tmpDir, 'analytics.json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { cmdAnalyticsExport } = await import('../bin/jobbot.js');
    await cmdAnalyticsExport(['--out', outputPath, '--redact']);
    const entries = await readAuditEntries(process.env.JOBBOT_AUDIT_LOG);
    expect(entries.length).toBeGreaterThan(0);
    const last = entries.at(-1);
    expect(last).toMatchObject({
      action: 'analytics_export',
      command: 'analytics export',
      status: 'success',
      outputTargets: ['file'],
      outputPath,
      format: 'json',
      redacted: true,
      actor: 'cli',
      source: 'cli',
    });
    expect(typeof last.timestamp).toBe('string');
    expect(last.timestamp.length).toBeGreaterThan(0);
    logSpy.mockRestore();
  });

  it('captures stdout metadata for intake exports', async () => {
    getIntakeResponsesMock.mockResolvedValueOnce([
      { id: 'resp-1', status: 'answered', question: 'Q1', answer: 'Answer' },
    ]);
    const outputPath = path.join(tmpDir, 'intake.json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { cmdIntakeExport } = await import('../bin/jobbot.js');
    await cmdIntakeExport(['--out', outputPath, '--json', '--redact']);
    const entries = await readAuditEntries(process.env.JOBBOT_AUDIT_LOG);
    const last = entries.at(-1);
    expect(last).toMatchObject({
      action: 'intake_export',
      command: 'intake export',
      status: 'success',
      outputTargets: ['file', 'stdout'],
      outputPath,
      format: 'json',
      redacted: true,
      actor: 'cli',
      source: 'cli',
    });
    logSpy.mockRestore();
  });

  it('logs interview archive exports with job metadata', async () => {
    exportInterviewSessionsMock.mockResolvedValueOnce(Buffer.from('zip data'));
    const outputPath = path.join(tmpDir, 'interviews.zip');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { cmdInterviewsExport } = await import('../bin/jobbot.js');
    await cmdInterviewsExport(['--job', 'job-123', '--out', outputPath]);
    const entries = await readAuditEntries(process.env.JOBBOT_AUDIT_LOG);
    const last = entries.at(-1);
    expect(last).toMatchObject({
      action: 'interviews_export',
      command: 'interviews export',
      status: 'success',
      outputTargets: ['file'],
      outputPath,
      format: 'zip',
      jobId: 'job-123',
      actor: 'cli',
      source: 'cli',
    });
    logSpy.mockRestore();
  });
});
