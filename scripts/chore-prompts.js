#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const SUMMARY_PATH = path.join(DOCS_DIR, 'prompt-docs-summary.md');
const PROMPTS_DIR = path.join(DOCS_DIR, 'prompts');
const CLI_ARGS = process.argv.slice(2);

const wantsWrite = CLI_ARGS.includes('--write') || CLI_ARGS.includes('--fix');
const formattingMode = wantsWrite ? 'write' : 'check';

function resolveBin(name) {
  const binName = process.platform === 'win32' ? `${name}.cmd` : name;
  return path.join(ROOT_DIR, 'node_modules', '.bin', binName);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env },
      ...options,
    });
    child.on('error', err => {
      reject(err);
    });
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function runSpellcheck() {
  const cspellBin = resolveBin('cspell');
  try {
    await fs.access(cspellBin);
  } catch {
    throw new Error('cspell binary not found. Run `npm ci` to install dev dependencies.');
  }

  const patterns = ['docs/prompts/**/*.md', 'docs/prompt-docs-summary.md'];
  const args = ['--no-progress', '--no-summary', '--relative', ...patterns];
  await runCommand(cspellBin, args, { cwd: ROOT_DIR });
  console.log('Spellcheck completed for prompt docs.');
}

function listChangedPromptDocs() {
  const targets = new Set();

  const collect = output => {
    if (!output) return;
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const normalized = path
        .normalize(trimmed.split(' -> ').pop())
        .replace(/\\/g, '/');
      const lower = normalized.toLowerCase();
      const isPromptDoc =
        normalized.startsWith('docs/prompts/') && lower.endsWith('.md');
      if (isPromptDoc || normalized === 'docs/prompt-docs-summary.md') {
        targets.add(normalized);
      }
    }
  };

  const diff = spawnSync(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=ACMR',
      '--relative',
      'HEAD',
      '--',
      'docs/prompts',
      'docs/prompt-docs-summary.md',
    ],
    { cwd: ROOT_DIR, encoding: 'utf8' },
  );
  if (diff.status === 0) collect(diff.stdout);

  const untracked = spawnSync(
    'git',
    [
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      'docs/prompts',
      'docs/prompt-docs-summary.md',
    ],
    { cwd: ROOT_DIR, encoding: 'utf8' },
  );
  if (untracked.status === 0) collect(untracked.stdout);

  return [...targets];
}

async function filterExistingPaths(paths) {
  const results = [];
  for (const target of paths) {
    const absolute = path.resolve(ROOT_DIR, target);
    try {
      const stat = await fs.stat(absolute);
      if (stat.isFile()) {
        results.push(target);
      }
    } catch {
      // Ignore paths that no longer exist (e.g., deleted prompt docs).
    }
  }
  return results;
}

async function runFormatting(mode = 'check') {
  const prettierBin = resolveBin('prettier');
  try {
    await fs.access(prettierBin);
  } catch {
    throw new Error('prettier binary not found. Run `npm ci` to install dev dependencies.');
  }

  const wantsAll = CLI_ARGS.includes('--all');
  let targets = wantsAll
    ? ['docs/prompts/**/*.md', 'docs/prompt-docs-summary.md']
    : await filterExistingPaths(listChangedPromptDocs());

  if (targets.length === 0) {
    console.log('No prompt doc formatting changes detected; skipping formatting check.');
    return;
  }

  const args = [mode === 'write' ? '--write' : '--check', ...targets];
  try {
    await runCommand(prettierBin, args, { cwd: ROOT_DIR });
  } catch {
    const suggestion = [
      'Prompt doc formatting check failed.',
      'Run `npx prettier --write "docs/prompts/**/*.md" "docs/prompt-docs-summary.md"`.',
    ].join('\n');
    throw new Error(suggestion);
  }

  if (mode === 'write') {
    console.log('Prompt doc formatting normalized.');
  } else {
    console.log('Prompt doc formatting check passed.');
  }
}

async function validatePromptSummaryLinks() {
  const contents = await fs.readFile(SUMMARY_PATH, 'utf8');
  const lines = contents.split(/\r?\n/);
  const referencePattern = /^\[([^\]]+)\]:\s+(.+)$/;
  const missing = [];

  for (const line of lines) {
    const match = referencePattern.exec(line.trim());
    if (!match) continue;
    const target = match[2].trim();
    if (/^https?:\/\//i.test(target)) continue;
    const [fileTarget] = target.split('#');
    if (!fileTarget) continue;
    const resolved = path.resolve(path.dirname(SUMMARY_PATH), fileTarget);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        missing.push(target);
      }
    } catch {
      missing.push(target);
    }
  }

  if (missing.length > 0) {
    const list = missing.map(item => ` - ${item}`).join('\n');
    throw new Error(`Prompt doc summary references missing files:\n${list}`);
  }

  console.log('Prompt doc summary references are valid.');
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMarkdownFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractLinkTarget(raw) {
  if (!raw) return '';
  let target = raw.trim();
  if (!target) return '';
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  }
  if (!target) return '';
  const spaceIndex = target.search(/\s/);
  if (spaceIndex !== -1) {
    target = target.slice(0, spaceIndex);
  }
  return target.trim();
}

function shouldCheckTarget(target) {
  if (!target) return false;
  if (target.startsWith('#')) return false;
  const lower = target.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('data:')) {
    return false;
  }
  if (/^[a-z]+:/.test(lower) && !lower.startsWith('./') && !lower.startsWith('../')) {
    return false;
  }
  return true;
}

function normalizeTargetPath(target) {
  const [withoutFragment] = target.split('#');
  const [withoutQuery] = withoutFragment.split('?');
  return withoutQuery.trim();
}

async function checkLinkTarget(filePath, target, cache) {
  const normalized = normalizeTargetPath(target);
  if (!normalized) return true;
  const cacheKey = `${filePath}::${normalized}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const resolved = path.resolve(path.dirname(filePath), normalized);
  try {
    const stat = await fs.stat(resolved);
    const exists = stat.isFile() || stat.isDirectory();
    cache.set(cacheKey, exists);
    return exists;
  } catch {
    cache.set(cacheKey, false);
    return false;
  }
}

async function findBrokenLinks(filePath) {
  const contents = await fs.readFile(filePath, 'utf8');
  const broken = [];
  const cache = new Map();
  const referenceDefs = new Map();
  const seen = new Set();
  const referencePattern = /^\s{0,3}\[([^\]]+)\]:\s+(.+)$/gm;
  let match;
  while ((match = referencePattern.exec(contents)) !== null) {
    const label = match[1]?.trim();
    const rawTarget = match[2] ?? '';
    const target = extractLinkTarget(rawTarget);
    if (!label || !target) continue;
    referenceDefs.set(label.toLowerCase(), target);
    if (!shouldCheckTarget(target)) continue;
    const ok = await checkLinkTarget(filePath, target, cache);
    if (!ok) {
      const key = `${filePath}::${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        broken.push({ file: filePath, target });
      }
    }
  }

  const inlinePattern = /!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((match = inlinePattern.exec(contents)) !== null) {
    const target = extractLinkTarget(match[1]);
    if (!shouldCheckTarget(target)) continue;
    const ok = await checkLinkTarget(filePath, target, cache);
    if (!ok) {
      const key = `${filePath}::${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        broken.push({ file: filePath, target });
      }
    }
  }

  const referenceUsePattern = /!?\[([^\]]*)\]\[([^\]]*)\]/g;
  while ((match = referenceUsePattern.exec(contents)) !== null) {
    const labelRaw = match[2]?.trim();
    const fallback = match[1]?.trim();
    const key = (labelRaw || fallback || '').toLowerCase();
    if (!key) continue;
    const target = referenceDefs.get(key);
    if (!target || !shouldCheckTarget(target)) continue;
    const ok = await checkLinkTarget(filePath, target, cache);
    if (!ok) {
      const seenKey = `${filePath}::${target}`;
      if (!seen.has(seenKey)) {
        seen.add(seenKey);
        broken.push({ file: filePath, target });
      }
    }
  }

  return broken;
}

async function validatePromptDocLinks() {
  const files = await collectMarkdownFiles(PROMPTS_DIR);
  files.push(SUMMARY_PATH);
  const issues = [];
  for (const file of files) {
    const broken = await findBrokenLinks(file);
    if (broken.length > 0) {
      for (const entry of broken) {
        const relative = path.relative(ROOT_DIR, entry.file);
        issues.push(`${relative} -> ${entry.target}`);
      }
    }
  }

  if (issues.length > 0) {
    const details = issues.map(item => ` - ${item}`).join('\n');
    throw new Error(`Broken Markdown links found in prompt docs:\n${details}`);
  }

  console.log('Prompt doc Markdown links are valid.');
}

async function main() {
  await runFormatting(formattingMode);
  await runSpellcheck();
  await validatePromptSummaryLinks();
  await validatePromptDocLinks();
  console.log('Prompt docs chore completed successfully.');
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
