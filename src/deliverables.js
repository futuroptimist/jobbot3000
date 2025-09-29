import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

import { renderResumeTextPreview } from './resume-preview.js';
import { renderResumePdf } from './resume-pdf.js';

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

function flattenResumeValue(value, pathKey, target) {
  if (Array.isArray(value)) {
    if (value.length === 0 && pathKey) {
      target[pathKey] = [];
    }
    value.forEach((item, index) => {
      const nextPath = pathKey ? `${pathKey}[${index}]` : `[${index}]`;
      flattenResumeValue(item, nextPath, target);
    });
    return;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0 && pathKey) {
      target[pathKey] = {};
    }
    for (const key of keys) {
      const nextPath = pathKey ? `${pathKey}.${key}` : key;
      flattenResumeValue(value[key], nextPath, target);
    }
    return;
  }

  const finalPath = pathKey || '$';
  let normalized = value;
  if (normalized === undefined) normalized = null;
  if (typeof normalized === 'number' && !Number.isFinite(normalized)) {
    normalized = String(normalized);
  }
  target[finalPath] = normalized;
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return Number.isNaN(a) && Number.isNaN(b);
}

function computeResumeDiff(base, tailored) {
  if (!base || !tailored || typeof base !== 'object' || typeof tailored !== 'object') {
    return null;
  }

  const baseFlat = {};
  const tailoredFlat = {};
  flattenResumeValue(base, '', baseFlat);
  flattenResumeValue(tailored, '', tailoredFlat);

  const added = {};
  const removed = {};
  const changed = {};

  const keys = new Set([...Object.keys(baseFlat), ...Object.keys(tailoredFlat)]);
  for (const key of keys) {
    const inBase = Object.prototype.hasOwnProperty.call(baseFlat, key);
    const inTailored = Object.prototype.hasOwnProperty.call(tailoredFlat, key);
    if (inBase && inTailored) {
      const before = baseFlat[key];
      const after = tailoredFlat[key];
      if (!valuesEqual(before, after)) {
        changed[key] = { before, after };
      }
    } else if (inTailored) {
      added[key] = tailoredFlat[key];
    } else {
      removed[key] = baseFlat[key];
    }
  }

  const summary = {
    added: Object.keys(added).length,
    removed: Object.keys(removed).length,
    changed: Object.keys(changed).length,
  };

  if (summary.added === 0 && summary.removed === 0 && summary.changed === 0) {
    return null;
  }

  return { summary, added, removed, changed };
}

async function readTailoredResume(selectionRoot) {
  const tailoredPath = path.join(selectionRoot, 'resume.json');
  let tailoredRaw;
  try {
    tailoredRaw = await fs.readFile(tailoredPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  try {
    const json = JSON.parse(tailoredRaw);
    return { json, path: tailoredPath };
  } catch {
    return null;
  }
}

async function buildResumeDiffPayload(selectionRoot, tailoredResume) {
  if (!tailoredResume) {
    tailoredResume = await readTailoredResume(selectionRoot);
  }
  if (!tailoredResume) return null;

  const dataDir = resolveDataDir();
  const basePath = path.join(dataDir, 'profile', 'resume.json');

  let baseRaw;
  try {
    baseRaw = await fs.readFile(basePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  let baseJson;
  try {
    baseJson = JSON.parse(baseRaw);
  } catch {
    return null;
  }

  const diff = computeResumeDiff(baseJson, tailoredResume.json);
  if (!diff) return null;

  const baseLabel = path.relative(dataDir, basePath) || path.basename(basePath);
  const tailoredLabel =
    path.relative(selectionRoot, tailoredResume.path) || path.basename(tailoredResume.path);

  return {
    generated_at: new Date().toISOString(),
    base_resume: baseLabel,
    tailored_resume: tailoredLabel,
    summary: diff.summary,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
  };
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
  const tailoredResume = await readTailoredResume(selection.root);
  if (tailoredResume) {
    const preview = renderResumeTextPreview(tailoredResume.json);
    if (preview && !zip.file('resume.txt')) {
      const content = preview.endsWith('\n') ? preview : `${preview}\n`;
      zip.file('resume.txt', content);
    }
    if (!zip.file('resume.pdf')) {
      try {
        const pdfBuffer = await renderResumePdf(tailoredResume.json);
        if (pdfBuffer && pdfBuffer.length > 0) {
          zip.file('resume.pdf', pdfBuffer);
        }
      } catch (err) {
        if (process.env.JOBBOT_DEBUG) {
          const reason = err?.message || String(err);
          console.warn(`jobbot: failed to synthesize resume.pdf during bundling: ${reason}`);
        }
      }
    }
  }
  const diffPayload = await buildResumeDiffPayload(selection.root, tailoredResume);
  if (diffPayload) {
    zip.file('resume.diff.json', `${JSON.stringify(diffPayload, null, 2)}\n`);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}
