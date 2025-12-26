import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const guidePath = new URL('../docs/backup-restore-guide.md', import.meta.url);

describe('backup and restore guide', () => {
  it('documents backup steps for the data directory and audit log', () => {
    const contents = readFileSync(guidePath, 'utf8');
    expect(contents).toContain('## Backup');
    expect(contents).toContain('JOBBOT_DATA_DIR');
    expect(contents).toContain('JOBBOT_AUDIT_LOG');
    expect(contents).toMatch(/node scripts\/export-data\.js/);
    expect(contents).toMatch(/tar -czf .*jobbot-backup\.tgz/);
    expect(contents).toMatch(/Compress-Archive/);
  });

  it('documents restore steps using the import script and archive extraction', () => {
    const contents = readFileSync(guidePath, 'utf8');
    expect(contents).toContain('## Restore');
    expect(contents).toMatch(/tar -xzf .*jobbot-backup\.tgz/);
    expect(contents).toMatch(/node scripts\/import-data\.js --source/);
    expect(contents).toMatch(/--dry-run/);
  });

  it('explains verification commands for restored environments', () => {
    const contents = readFileSync(guidePath, 'utf8');
    expect(contents).toContain('## Verify');
    expect(contents).toMatch(/jobbot analytics health --json/);
    expect(contents).toMatch(/node scripts\/export-data\.js > \/tmp\/restore-check\.ndjson/);
  });
});
