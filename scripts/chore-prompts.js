#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const SUMMARY_PATH = path.join(DOCS_DIR, 'prompt-docs-summary.md');
const ARGS = process.argv.slice(2);
const CHECK_MODE = ARGS.includes('--check');

async function listMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listMarkdownFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

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

async function runFormatting({ check } = {}) {
  const prettierBin = resolveBin('prettier');
  try {
    await fs.access(prettierBin);
  } catch {
    throw new Error('prettier binary not found. Run `npm ci` to install dev dependencies.');
  }

  const patterns = ['docs/prompts/**/*.md', 'docs/prompt-docs-summary.md'];
  const modeArgs = check ? ['--check'] : ['--write'];
  const args = ['--log-level', 'warn', ...modeArgs, ...patterns];
  console.log(check ? 'Checking prompt doc formatting...' : 'Formatting prompt docs...');
  try {
    await runCommand(prettierBin, args, { cwd: ROOT_DIR });
  } catch (err) {
    if (check) {
      throw new Error(
        'Prompt doc formatting check failed. Run `npm run chore:prompts` to apply fixes.',
      );
    }
    throw err;
  }
  if (check) console.log('Prompt docs formatting check passed.');
  else console.log('Prompt docs formatted.');
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

async function ensurePromptDocsReferenceReadme() {
  const promptRoot = path.join(DOCS_DIR, 'prompts');
  const readmePath = path.join(ROOT_DIR, 'README.md');
  let files = [];
  try {
    files = await listMarkdownFiles(promptRoot);
  } catch (err) {
    const message = err && typeof err.message === 'string' ? err.message : String(err);
    throw new Error(`Failed to read prompt docs: ${message}`);
  }

  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  const missing = [];
  for (const file of files) {
    const relativeDir = path.dirname(file);
    const relativeToReadme = path.relative(relativeDir, readmePath);
    const normalized = relativeToReadme.split(path.sep).join('/');
    const contents = await fs.readFile(file, 'utf8');

    let hasReadmeLink = false;
    for (const match of contents.matchAll(linkPattern)) {
      const target = match[1].trim();
      if (!target) continue;
      if (!target.toLowerCase().includes('readme')) continue;
      const [pathPart] = target.split('#');
      const cleaned = pathPart.trim().replace(/\\+/g, '/');
      if (cleaned === normalized) {
        hasReadmeLink = true;
        break;
      }
    }

    if (!hasReadmeLink) {
      missing.push(path.relative(ROOT_DIR, file));
    }
  }

  if (missing.length > 0) {
    const details = missing.map(item => ` - ${item}`).join('\n');
    throw new Error(`Prompt docs missing README reference:\n${details}`);
  }

  console.log('Prompt docs reference README.md.');
}

async function main() {
  await runFormatting({ check: CHECK_MODE });
  await runSpellcheck();
  await validatePromptSummaryLinks();
  await ensurePromptDocsReferenceReadme();
  console.log('Prompt docs chore completed successfully.');
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
