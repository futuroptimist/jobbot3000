#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const SUMMARY_PATH = path.join(DOCS_DIR, 'prompt-docs-summary.md');

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

async function main() {
  await runSpellcheck();
  await validatePromptSummaryLinks();
  console.log('Prompt docs chore completed successfully.');
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
