import fs from 'node:fs/promises';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const lastRetentionRun = new Map();

async function enforceRetention(logPath, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const absolute = path.resolve(logPath);
  const now = Date.now();
  const last = lastRetentionRun.get(absolute) || 0;
  if (now - last < DAY_MS) {
    return;
  }
  lastRetentionRun.set(absolute, now);
  try {
    const stats = await fs.stat(absolute);
    if (now - stats.mtimeMs <= retentionDays * DAY_MS) {
      return;
    }
    const timestamp = new Date(stats.mtime).toISOString().replace(/[:]/g, '-');
    const archiveName = `${absolute}.${timestamp}.bak`;
    await fs.rename(absolute, archiveName);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
}

export function createAuditLogger({ logPath, retentionDays = 30 } = {}) {
  if (!logPath) {
    throw new Error('audit log path is required');
  }
  const absolute = path.resolve(logPath);

  return {
    async record(event) {
      if (!event || typeof event !== 'object') {
        throw new Error('audit event must be an object');
      }
      const entry = {
        ...event,
        timestamp: new Date().toISOString(),
      };
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await enforceRetention(absolute, retentionDays);
      await fs.appendFile(absolute, `${JSON.stringify(entry)}\n`, 'utf8');
      return entry;
    },
  };
}
