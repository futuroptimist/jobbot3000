import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  recordChangeEvent,
  listChangeEvents,
  recordIncidentReport,
  listIncidentReports,
  setComplianceDataDir,
} from '../src/security/soc2-controls.js';

describe('SOC 2 control coverage', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-soc2-'));
    setComplianceDataDir(dataDir);
  });

  afterEach(() => {
    setComplianceDataDir(undefined);
  });

  it('records change management events with sanitized metadata', async () => {
    const event = await recordChangeEvent({
      title: '  Deploy reminders  ',
      description: 'Enabled ICS download for shortlist reminders',
      approver: 'Pat Ops ',
      ticket: 'CHG-1234 ',
      deployedBy: 'Casey',
      deployedAt: '2025-01-05T12:00:00Z',
    });

    expect(event).toMatchObject({
      title: 'Deploy reminders',
      description: 'Enabled ICS download for shortlist reminders',
      approver: 'Pat Ops',
      ticket: 'CHG-1234',
      deployed_by: 'Casey',
      deployed_at: '2025-01-05T12:00:00Z',
    });
    expect(event.id).toMatch(/[0-9a-f-]{36}/i);
    expect(event.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const stored = await listChangeEvents();
    expect(stored).toEqual([event]);
  });

  it('rejects change events without a title or description', async () => {
    await expect(
      recordChangeEvent({ title: ' ', description: 'Missing title' }),
    ).rejects.toThrow(/title is required/i);

    await expect(
      recordChangeEvent({ title: 'Release notes', description: '  ' }),
    ).rejects.toThrow(/description is required/i);
  });

  it('records incident reports with severity normalization', async () => {
    const report = await recordIncidentReport({
      title: 'Status hub outage',
      summary: 'Web sockets failed during deploy',
      severity: 'HIGH',
      impactedSystems: ['web ', 'cli'],
      responder: 'Jordan',
      detectedAt: '2025-01-10T09:00:00Z',
      resolvedAt: '2025-01-10T09:30:00Z',
    });

    expect(report).toMatchObject({
      title: 'Status hub outage',
      summary: 'Web sockets failed during deploy',
      severity: 'high',
      impacted_systems: ['web', 'cli'],
      responder: 'Jordan',
      detected_at: '2025-01-10T09:00:00Z',
      resolved_at: '2025-01-10T09:30:00Z',
    });
    expect(report.id).toMatch(/[0-9a-f-]{36}/i);

    const stored = await listIncidentReports();
    expect(stored).toEqual([report]);
  });
});
