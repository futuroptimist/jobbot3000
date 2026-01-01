import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAuditLogger } from '../src/shared/security/audit-log.js';

async function readAuditEntries(logPath) {
  const raw = await fs.readFile(logPath, 'utf8');
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe('tamper-resistant audit log', () => {
  let tmpDir;
  let logPath;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-audit-log-'));
    logPath = path.join(tmpDir, 'audit.log');
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
      logPath = undefined;
    }
  });

  it('hash-chains audit entries when an integrity key is configured', async () => {
    const logger = createAuditLogger({ logPath, integrityKey: 'secret-key' });
    await logger.record({ action: 'first', actor: 'cli' });
    await logger.record({ action: 'second', actor: 'cli' });

    const entries = await readAuditEntries(logPath);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      action: 'first',
      hash: expect.any(String),
    });
    expect(entries[0].prevHash ?? null).toBeNull();
    expect(entries[1]).toMatchObject({
      action: 'second',
      prevHash: entries[0].hash,
      hash: expect.any(String),
    });

    const verifyingLogger = createAuditLogger({
      logPath,
      integrityKey: 'secret-key',
    });
    await verifyingLogger.record({ action: 'third', actor: 'cli' });

    const refreshed = await readAuditEntries(logPath);
    expect(refreshed[2].prevHash).toBe(refreshed[1].hash);
  });

  it('rejects tampered history before appending new entries', async () => {
    const logger = createAuditLogger({ logPath, integrityKey: 'secret-key' });
    await logger.record({ action: 'legit', actor: 'cli' });

    const [first] = await readAuditEntries(logPath);
    const tampered = { ...first, actor: 'intruder' };
    await fs.writeFile(logPath, `${JSON.stringify(tampered)}\n`, 'utf8');

    await expect(
      logger.record({ action: 'next', actor: 'cli' }),
    ).rejects.toThrow(/integrity/i);
  });

  it('verifies integrity on demand with the configured key', async () => {
    const logger = createAuditLogger({ logPath, integrityKey: 'secret-key' });
    await logger.record({ action: 'first', actor: 'cli' });
    await logger.record({ action: 'second', actor: 'cli' });

    const verifier = createAuditLogger({ logPath, integrityKey: 'secret-key' });
    const result = await verifier.verify();

    expect(result).toMatchObject({
      lastHash: expect.any(String),
      lines: 2,
      mtimeMs: expect.any(Number),
    });
  });

  it('throws when verifying without an integrity key', async () => {
    const logger = createAuditLogger({ logPath });
    await expect(logger.verify()).rejects.toThrow(/integrityKey/i);
  });

  it('rejects verification with an incorrect integrity key', async () => {
    const logger = createAuditLogger({ logPath, integrityKey: 'secret-key' });
    await logger.record({ action: 'first', actor: 'cli' });

    const verifier = createAuditLogger({ logPath, integrityKey: 'other-key' });
    await expect(verifier.verify()).rejects.toThrow(/integrity/i);
  });

  it('fails verification when history has been tampered', async () => {
    const logger = createAuditLogger({ logPath, integrityKey: 'secret-key' });
    await logger.record({ action: 'first', actor: 'cli' });

    const [entry] = await readAuditEntries(logPath);
    const modified = { ...entry, hash: '0000' };
    await fs.writeFile(logPath, `${JSON.stringify(modified)}\n`, 'utf8');

    const verifier = createAuditLogger({ logPath, integrityKey: 'secret-key' });
    await expect(verifier.verify()).rejects.toThrow(/integrity/i);
  });
});
