import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 3000;

function sanitizeMessage(message) {
  if (typeof message !== 'string') return 'Unknown error';
  const normalized = message.replace(/[\r\n]+/g, ' ').trim();
  return normalized || 'Unknown error';
}

function resolveCliPath(cliPath) {
  if (cliPath) {
    return path.resolve(cliPath);
  }
  return fileURLToPath(new URL('../../bin/jobbot.js', import.meta.url));
}

function resolveDataDirectory(dataDir) {
  if (dataDir) {
    return path.resolve(dataDir);
  }
  if (process.env.JOBBOT_DATA_DIR) {
    return path.resolve(process.env.JOBBOT_DATA_DIR);
  }
  return path.resolve('data');
}

export function createCliAvailabilityCheck({
  cliPath,
  nodePath = process.execPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dataDir,
} = {}) {
  const resolvedCliPath = resolveCliPath(cliPath);
  const resolvedNodePath = nodePath ? path.resolve(nodePath) : process.execPath;
  const resolvedDataDir = resolveDataDirectory(dataDir);

  return {
    name: 'cli-availability',
    async run() {
      try {
        await execFileAsync(
          resolvedNodePath,
          [resolvedCliPath, 'track', 'list', '--json', '--limit', '1'],
          {
            env: {
              ...process.env,
              JOBBOT_DATA_DIR: resolvedDataDir,
            },
            signal: typeof AbortSignal?.timeout === 'function'
              ? AbortSignal.timeout(timeoutMs)
              : undefined,
          },
        );
        return { status: 'ok' };
      } catch (err) {
        const details = {
          path: resolvedCliPath,
          message: sanitizeMessage(err?.code === 'ABORT_ERR'
            ? `Timed out after ${timeoutMs}ms`
            : err?.message ?? 'CLI health check failed'),
        };
        if (err?.code && err.code !== 'ABORT_ERR') {
          details.code = String(err.code);
        }
        if (err?.signal) {
          details.signal = String(err.signal);
        }
        if (err?.name === 'AbortError' && !details.code) {
          details.code = 'TIMEOUT';
        }
        return { status: 'error', details };
      }
    },
  };
}

export function createDataDirectoryCheck({ dataDir } = {}) {
  const resolvedDir = resolveDataDirectory(dataDir);

  return {
    name: 'data-directory',
    async run() {
      const details = { path: resolvedDir };
      try {
        const stat = await fs.stat(resolvedDir);
        if (!stat.isDirectory()) {
          details.message = 'Path exists but is not a directory';
          return { status: 'error', details };
        }
        await fs.access(resolvedDir, fsConstants.R_OK | fsConstants.W_OK);
        details.message = 'Accessible';
        return { status: 'ok', details };
      } catch (err) {
        if (err?.code) {
          details.code = String(err.code);
        }
        if (err?.code === 'ENOENT') {
          details.message = 'Data directory not found';
        } else if (err?.code === 'EACCES' || err?.code === 'EPERM') {
          details.message = 'Data directory is not writable';
        } else {
          details.message = sanitizeMessage(err?.message ?? 'Failed to access data directory');
        }
        return { status: 'error', details };
      }
    },
  };
}

export function createDefaultHealthChecks(options = {}) {
  return [
    createCliAvailabilityCheck(options),
    createDataDirectoryCheck(options),
  ];
}
