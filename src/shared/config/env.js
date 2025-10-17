import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config as loadDotenv } from 'dotenv';

const DEFAULT_ENV_ORDER = ['.env'];
const DEFAULT_LOCAL_SUFFIXES = ['local'];

/**
 * @typedef {{ envName?: string, files?: string[] }} CandidateOptions
 */

/**
 * @param {CandidateOptions} [options]
 * @returns {string[]}
 */
function createCandidateList({ envName, files } = {}) {
  if (Array.isArray(files) && files.length > 0) {
    return files.filter(file => typeof file === 'string' && file.trim());
  }

  const candidates = [...DEFAULT_ENV_ORDER];

  if (envName) {
    candidates.push(`.env.${envName}`);
  }

  for (const suffix of DEFAULT_LOCAL_SUFFIXES) {
    candidates.push(`.env.${suffix}`);
    if (envName) {
      candidates.push(`.env.${envName}.${suffix}`);
    }
  }

  return candidates;
}

function normalizeEnvName(rawEnv) {
  if (typeof rawEnv !== 'string') return undefined;
  const trimmed = rawEnv.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function loadFile(pathname) {
  const result = loadDotenv({ path: pathname, override: true });
  if (result.error) {
    throw result.error;
  }
}

/**
 * @param {{ cwd: string, candidates: string[] }} options
 * @returns {string[]}
 */
function resolveExistingFiles({ cwd, candidates }) {
  const seen = new Set();
  const existing = [];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(cwd, candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!fs.existsSync(resolved)) continue;
    existing.push(resolved);
  }

  return existing;
}

/** @type {string[] | null} */
let cachedDefaultFiles = null;

/**
 * @typedef {{ cwd?: string, env?: string, files?: string[] }} LoadEnvironmentOptions
 */

/**
 * @param {LoadEnvironmentOptions} [options]
 */
export function loadEnvironment({ cwd = process.cwd(), env, files } = {}) {
  const normalizedEnv = normalizeEnvName(env);
  const resolvedCwd = path.resolve(cwd);
  const candidates = createCandidateList({ envName: normalizedEnv, files });
  const existingFiles = resolveExistingFiles({ cwd: resolvedCwd, candidates });

  for (const filePath of existingFiles) {
    loadFile(filePath);
  }

  return { files: existingFiles };
}

/**
 * @param {LoadEnvironmentOptions} [options]
 */
export function ensureEnvironmentLoaded(options = {}) {
  const isDefaultInvocation =
    options.cwd === undefined && options.env === undefined && options.files === undefined;

  if (isDefaultInvocation && cachedDefaultFiles) {
    return { files: [...cachedDefaultFiles] };
  }

  const { files } = loadEnvironment(options);

  if (isDefaultInvocation) {
    cachedDefaultFiles = [...files];
  }

  return { files: [...files] };
}

export function getLoadedEnvironmentFiles() {
  if (!cachedDefaultFiles) return [];
  return [...cachedDefaultFiles];
}
