import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

export function setDeliverablesDataDir(dir) {
  overrideDir = dir || undefined;
}

function sanitizeString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function ensureSafeIdentifier(value, label) {
  if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')) {
    throw new Error(`${label} cannot contain path separators`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`${label} cannot reference parent directories`);
  }
  return value;
}

function requireIdentifier(value, label) {
  const sanitized = sanitizeString(value);
  if (!sanitized) {
    throw new Error(`${label} is required`);
  }
  return ensureSafeIdentifier(sanitized, label);
}

async function ensureJobDirectory(jobId) {
  const baseDir = path.join(resolveDataDir(), 'deliverables', jobId);
  try {
    const stats = await fs.stat(baseDir);
    if (!stats.isDirectory()) {
      throw new Error(`Deliverables path for ${jobId} is not a directory`);
    }
    return baseDir;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(`No deliverables found for ${jobId}`);
    }
    throw err;
  }
}

async function resolveBundleRoot(jobId, timestamp) {
  const jobDir = await ensureJobDirectory(jobId);
  if (timestamp) {
    const target = path.join(jobDir, timestamp);
    try {
      const stats = await fs.stat(target);
      if (!stats.isDirectory()) {
        throw new Error(`Deliverables run ${timestamp} for ${jobId} is not a directory`);
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw new Error(`No deliverables run ${timestamp} found for ${jobId}`);
      }
      throw err;
    }
    return { root: target, label: timestamp };
  }

  const entries = await fs.readdir(jobDir, { withFileTypes: true });
  const directories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (directories.length > 0) {
    const latest = directories[directories.length - 1];
    return { root: path.join(jobDir, latest), label: latest };
  }

  const hasFiles = entries.some(entry => entry.isFile());
  if (!hasFiles) {
    throw new Error(`No deliverables files found for ${jobId}`);
  }
  return { root: jobDir, label: null };
}

async function addEntries(zip, directory, relative = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      zip.folder(entryRelative);
      count += await addEntries(zip, entryPath, entryRelative);
    } else if (entry.isFile()) {
      const content = await fs.readFile(entryPath);
      zip.file(entryRelative, content);
      count += 1;
    }
  }
  return count;
}

export async function bundleDeliverables(jobId, options = {}) {
  const normalizedId = requireIdentifier(jobId, 'job id');
  const timestamp = options.timestamp
    ? requireIdentifier(options.timestamp, 'timestamp')
    : undefined;

  const selection = await resolveBundleRoot(normalizedId, timestamp);
  const zip = new JSZip();
  const filesAdded = await addEntries(zip, selection.root);
  if (filesAdded === 0) {
    throw new Error(`No deliverables files found for ${normalizedId}`);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}
