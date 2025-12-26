import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { OpportunitiesRepo } from '../src/services/opportunitiesRepo.js';
import { AuditLog } from '../src/services/audit.js';

const execFileAsync = promisify(execFile);

describe('opportunities backup and restore scripts', () => {
  let sourceDir;
  let targetDir;

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-source-'));
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-target-'));
  });

  afterEach(async () => {
    if (sourceDir) {
      await fs.rm(sourceDir, { recursive: true, force: true });
      sourceDir = undefined;
    }
    if (targetDir) {
      await fs.rm(targetDir, { recursive: true, force: true });
      targetDir = undefined;
    }
  });

  it('exports and imports SQLite opportunities data', async () => {
    const repo = new OpportunitiesRepo({ dataDir: sourceDir });
    const audit = new AuditLog({ dataDir: sourceDir });

    const opportunity = repo.upsertOpportunity({
      company: 'Future Works',
      roleHint: 'Platform Engineer',
      contactEmail: 'casey@futureworks.example',
      lifecycleState: 'recruiter_outreach',
      subject: 'Platform Engineer, Core Systems',
      source: 'recruiter_email',
      firstSeenAt: '2025-01-02T03:04:05.000Z',
    });

    const event = repo.appendEvent({
      opportunityUid: opportunity.uid,
      type: 'recruiter_outreach_received',
      occurredAt: '2025-01-03T04:05:06.000Z',
      payload: { note: 'Resume sent via recruiter portal' },
    });

    audit.append({
      opportunityUid: opportunity.uid,
      action: 'ingest',
      occurredAt: '2025-01-03T04:05:07.000Z',
      payload: { source: 'email' },
    });

    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const db = new BetterSqlite3(path.join(sourceDir, 'opportunities.db'));
    db.prepare(
      [
        'INSERT OR IGNORE INTO contacts',
        '(opportunity_uid, name, email, phone)',
        'VALUES (?, ?, ?, ?)',
      ].join(' '),
    ).run(opportunity.uid, 'Pat Recruiter', 'pat.recruiter@example.com', '+1-555-0100');
    db.prepare(
      [
        'INSERT OR IGNORE INTO attachments',
        '(opportunity_uid, name, mime_type, uri)',
        'VALUES (?, ?, ?, ?)',
      ].join(' '),
    ).run(opportunity.uid, 'resume.pdf', 'application/pdf', 'file:///tmp/resume.pdf');
    db.close();

    repo.close();
    audit.close();

    const exportResult = await execFileAsync('node', ['scripts/export-data.js'], {
      env: { ...process.env, JOBBOT_DATA_DIR: sourceDir },
      encoding: 'utf8',
    });

    expect(exportResult.stdout).toContain('"table":"opportunities"');
    expect(exportResult.stdout).toContain('"table":"events"');
    expect(exportResult.stdout).toContain('"table":"audit_log"');

    const exportPath = path.join(sourceDir, 'opportunities.ndjson');
    await fs.writeFile(exportPath, exportResult.stdout, 'utf8');

    await execFileAsync('node', ['scripts/import-data.js', '--source', exportPath], {
      env: { ...process.env, JOBBOT_DATA_DIR: targetDir },
      encoding: 'utf8',
    });

    const restoredRepo = new OpportunitiesRepo({ dataDir: targetDir });
    const restoredAudit = new AuditLog({ dataDir: targetDir });

    const [restoredOpportunity] = restoredRepo.listOpportunities();
    expect(restoredOpportunity).toMatchObject({
      company: 'Future Works',
      roleHint: 'Platform Engineer',
      contactEmail: 'casey@futureworks.example',
      lifecycleState: 'recruiter_outreach',
      subject: 'Platform Engineer, Core Systems',
      source: 'recruiter_email',
      firstSeenAt: '2025-01-02T03:04:05.000Z',
      lastEventAt: event.occurredAt,
    });

    const restoredEvents = restoredRepo.listEvents(restoredOpportunity.uid);
    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0]).toMatchObject({
      opportunityUid: restoredOpportunity.uid,
      type: 'recruiter_outreach_received',
      payload: { note: 'Resume sent via recruiter portal' },
      occurredAt: '2025-01-03T04:05:06.000Z',
    });

    const restoredAuditEntries = restoredAudit.list({ opportunityUid: restoredOpportunity.uid });
    expect(restoredAuditEntries).toHaveLength(1);
    expect(restoredAuditEntries[0]).toMatchObject({
      action: 'ingest',
      payload: { source: 'email' },
    });

    const dbRestored = new BetterSqlite3(path.join(targetDir, 'opportunities.db'));
    const contacts = dbRestored
      .prepare('SELECT name, email, phone FROM contacts ORDER BY name')
      .all();
    const attachments = dbRestored
      .prepare('SELECT name, mime_type, uri FROM attachments ORDER BY name')
      .all();
    dbRestored.close();

    expect(contacts).toEqual([
      {
        name: null,
        email: 'casey@futureworks.example',
        phone: null,
      },
      {
        name: 'Pat Recruiter',
        email: 'pat.recruiter@example.com',
        phone: '+1-555-0100',
      },
    ]);
    expect(attachments).toEqual([
      {
        name: 'resume.pdf',
        mime_type: 'application/pdf',
        uri: 'file:///tmp/resume.pdf',
      },
    ]);

    restoredRepo.close();
    restoredAudit.close();
  });
});
