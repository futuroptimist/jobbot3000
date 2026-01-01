import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const lastRetentionRun = new Map();

/**
 * @param {string} logPath
 * @param {number} retentionDays
 * @returns {Promise<boolean>}
 */
async function enforceRetention(logPath, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return false;
  const absolute = path.resolve(logPath);
  const now = Date.now();
  const last = lastRetentionRun.get(absolute) || 0;
  if (now - last < DAY_MS) {
    return false;
  }
  lastRetentionRun.set(absolute, now);
  try {
    const stats = await fs.stat(absolute);
    if (now - stats.mtimeMs <= retentionDays * DAY_MS) {
      return false;
    }
    const timestamp = new Date(stats.mtime).toISOString().replace(/[:]/g, '-');
    const archiveName = `${absolute}.${timestamp}.bak`;
    await fs.rename(absolute, archiveName);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function stableStringify(value) {
  return JSON.stringify(value, (key, val) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    return Object.keys(val)
      .sort()
      .reduce((acc, current) => {
        acc[current] = val[current];
        return acc;
      }, {});
  });
}

function computeIntegrityHash(entry, integrityKey) {
  const payload = stableStringify(entry);
  return createHmac('sha256', integrityKey).update(payload).digest('hex');
}

async function verifyExistingLog(logPath, integrityKey) {
  let previousHash = null;
  let lineNumber = 0;
  let mtimeMs = null;

  try {
    const [raw, stats] = await Promise.all([fs.readFile(logPath, 'utf8'), fs.stat(logPath)]);
    mtimeMs = stats.mtimeMs;
    const lines = raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      lineNumber += 1;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (error) {
        const reason = error?.message ?? 'unknown error';
        throw new Error(
          `Audit log integrity check failed on line ${lineNumber}: invalid JSON (${reason})`,
        );
      }
      const recordedHash = entry.hash;
      const recordedPrevHash = entry.prevHash ?? null;
      if (recordedPrevHash !== previousHash) {
        throw new Error(
          `Audit log integrity check failed on line ${lineNumber}: unexpected prevHash value`,
        );
      }
      if (!recordedHash) {
        throw new Error(
          `Audit log integrity check failed on line ${lineNumber}: missing hash value`,
        );
      }
      const rest = { ...entry };
      delete rest.hash;
      const expectedHash = computeIntegrityHash(rest, integrityKey);
      if (expectedHash !== recordedHash) {
        throw new Error(
          `Audit log integrity check failed on line ${lineNumber}: hash mismatch`,
        );
      }
      previousHash = recordedHash;
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { lastHash: null, lines: 0, mtimeMs: null };
    }
    throw error;
  }

  return { lastHash: previousHash, lines: lineNumber, mtimeMs };
}

async function getMtimeMs(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtimeMs;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * @typedef {{ logPath: string, retentionDays?: number, integrityKey?: string }} AuditLoggerOptions
 */

/**
 * @param {AuditLoggerOptions} [options]
 */
export function createAuditLogger(options) {
  const { logPath, retentionDays = 30, integrityKey } =
    /** @type {AuditLoggerOptions} */ (options ?? {});
  if (!logPath) {
    throw new Error('audit log path is required');
  }
  const absolute = path.resolve(logPath);
  const trimmedIntegrityKey =
    typeof integrityKey === 'string' && integrityKey.trim() ? integrityKey.trim() : null;
  let chainHead = null;
  let lastObservedMtime = null;
  /** @type {Promise<unknown>} */
  let writeChain = Promise.resolve();

  return {
    /**
     * @param {Record<string, unknown>} event
     * @returns {Promise<Record<string, unknown>>}
     */
    async record(event) {
      if (!event || typeof event !== 'object') {
        throw new Error('audit event must be an object');
      }

      const performWrite = async () => {
        const rotated = await enforceRetention(absolute, retentionDays);
        if (rotated) {
          chainHead = null;
          lastObservedMtime = null;
        }
        let currentMtimeMs = null;
        if (trimmedIntegrityKey) {
          currentMtimeMs = await getMtimeMs(absolute);
          if (chainHead === null || rotated || currentMtimeMs !== lastObservedMtime) {
            const { lastHash, mtimeMs } = await verifyExistingLog(absolute, trimmedIntegrityKey);
            chainHead = lastHash;
            lastObservedMtime = mtimeMs;
          }
        }

        const baseEntry = Object.fromEntries(
          Object.entries({
            ...event,
            timestamp: new Date().toISOString(),
          }).filter(([, value]) => value !== undefined),
        );

        let entryToPersist = baseEntry;
        if (trimmedIntegrityKey) {
          const prevHash = chainHead;
          const entryForHash = { ...baseEntry, prevHash };
          const hash = computeIntegrityHash(entryForHash, trimmedIntegrityKey);
          entryToPersist = { ...entryForHash, hash };
          chainHead = hash;
        }

        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.appendFile(absolute, `${JSON.stringify(entryToPersist)}\n`, 'utf8');
        if (trimmedIntegrityKey) {
          lastObservedMtime = await getMtimeMs(absolute);
        }
        return entryToPersist;
      };

      const pendingWrite = writeChain.then(performWrite, performWrite);
      writeChain = pendingWrite.catch(() => {});
      return pendingWrite;
    },

    async verify() {
      if (!trimmedIntegrityKey) {
        throw new Error('audit log integrity requires an integrityKey option');
      }
      return verifyExistingLog(absolute, trimmedIntegrityKey);
    },
  };
}
