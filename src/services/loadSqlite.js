import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function sqliteUnavailableError(error) {
  const detail =
    error instanceof Error ? error.message.split('\n')[0] : String(error);
  return new Error(
    `SQLite support is unavailable (${detail}). ` +
      'Run npm ci under the supported Node.js version or rebuild better-sqlite3.',
    { cause: error },
  );
}

/**
 * Load the native SQLite driver with an actionable error for scripts that
 * cannot operate without a persistent database.
 *
 * @param {{ required?: boolean }} [options]
 * @returns {typeof import('better-sqlite3') | null}
 */
export function loadBetterSqlite3({ required = false } = {}) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (error) {
    if (!required) return null;
    throw sqliteUnavailableError(error);
  }

  if (required) {
    try {
      const db = new Database(':memory:');
      db.close();
    } catch (error) {
      throw sqliteUnavailableError(error);
    }
  }
  return Database;
}

export function hasUsableBetterSqlite3() {
  try {
    loadBetterSqlite3({ required: true });
    return true;
  } catch {
    return false;
  }
}

export function isNativeSqliteFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'compiled against a different Node.js version',
    'NODE_MODULE_VERSION',
    'Could not locate the bindings file',
    'Module did not self-register',
    'invalid ELF header',
    'wrong architecture',
    'dlopen',
  ].some(marker => message.includes(marker));
}
