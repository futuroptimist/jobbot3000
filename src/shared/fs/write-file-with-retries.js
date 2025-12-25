import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 50;
const RETRIABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/**
 * @typedef {Object} WriteFileRetryOptions
 * @property {number} [attempts]
 * @property {number} [retryDelayMs]
 * @property {(filePath: import('node:fs').PathLike,
 *   data: string | Buffer,
 *   options?: any
 * ) => Promise<void>} [writer]
 * @property {import('node:fs').WriteFileOptions | NodeJS.BufferEncoding} [writerOptions]
 * @property {(details: {
 *   attempt: number;
 *   remaining: number;
 *   code?: string;
 *   filePath: import('node:fs').PathLike;
 * }) => void} [onRetry]
 */

async function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await delay(ms);
}

/**
 * @param {import('node:fs').PathLike} filePath
 * @param {string | Buffer} contents
 * @param {WriteFileRetryOptions} [options]
 */
export async function writeFileWithRetries(
  filePath,
  contents,
  {
    attempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    writer = fs.writeFile,
    writerOptions = 'utf8',
    onRetry,
  } = {},
) {
  const maxAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1;
  let attempt = 0;
  let lastError;

  while (attempt < maxAttempts) {
    try {
      await writer(filePath, contents, writerOptions);
      return;
    } catch (error) {
      lastError = error;
      const code = error?.code;
      const remaining = maxAttempts - attempt - 1;
      const retriable = remaining > 0 && RETRIABLE_CODES.has(code);

      if (!retriable) {
        throw error;
      }

      if (typeof onRetry === 'function') {
        try {
          onRetry({
            attempt: attempt + 1,
            remaining,
            code,
            filePath,
          });
        } catch {
          // Swallow logging failures to avoid masking the original error.
        }
      }

      await sleep(retryDelayMs);
    } finally {
      attempt += 1;
    }
  }

  throw lastError;
}
