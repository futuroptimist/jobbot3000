import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');

function runChorePrompts() {
  const result = spawnSync('npm', ['run', 'chore:prompts', '--', '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Ensure consistent output without npm color codes during tests.
      NPM_CONFIG_COLOR: 'false',
    },
  });
  return result;
}

describe('chore:prompts', () => {
  // cspell scans the entire prompt docs tree; give CI ample time before declaring a timeout.
  it('runs the prompts chore script successfully', () => {
    const { status, stdout, stderr } = runChorePrompts();
    if (status !== 0) {
      const combined = `${stdout}\n${stderr}`;
      throw new Error(`chore:prompts exited with code ${status}:\n${combined}`);
    }
    expect(stdout).toContain('Prompt docs chore completed');
  }, 20000);

  it('fails when prompt docs contain broken local links', () => {
    const brokenFile = path.join(repoRoot, 'docs', 'prompts', 'broken-link.md');
    const cleanup = () => {
      if (fs.existsSync(brokenFile)) {
        fs.unlinkSync(brokenFile);
      }
    };

    const content = '# Broken link example\n\nSee [missing](./does-not-exist.md).\n';
    fs.writeFileSync(brokenFile, content, 'utf8');

    try {
      const { status, stderr, stdout } = runChorePrompts();
      expect(status).not.toBe(0);
      const combined = `${stdout}\n${stderr}`;
      expect(combined).toMatch(/broken Markdown link/i);
      expect(combined).toContain('broken-link.md');
    } finally {
      cleanup();
    }
  }, 20000);

  it('fails when prompt docs are not formatted consistently', () => {
    const unformattedFile = path.join(repoRoot, 'docs', 'prompts', 'unformatted.md');
    const cleanup = () => {
      if (fs.existsSync(unformattedFile)) {
        fs.unlinkSync(unformattedFile);
      }
    };

    fs.writeFileSync(unformattedFile, '-    Item one\n', 'utf8');

    try {
      const { status, stderr, stdout } = runChorePrompts();
      expect(status).not.toBe(0);
      const combined = `${stdout}\n${stderr}`;
      expect(combined).toMatch(/format/i);
      expect(combined).toContain('unformatted.md');
    } finally {
      cleanup();
    }
  }, 20000);

  it('passes when a prompt doc deletion is staged', () => {
    const docPath = path.join(repoRoot, 'docs', 'prompts', 'codex', 'automation.md');
    const backupPath = `${docPath}.bak`;
    const summaryPath = path.join(repoRoot, 'docs', 'prompt-docs-summary.md');
    const originalSummary = fs.readFileSync(summaryPath, 'utf8');
    const sanitizedSummary = originalSummary
      .split(/\r?\n/)
      .filter(line => !line.toLowerCase().includes('automation'))
      .join('\n');

    const formatSummary = () => {
      const prettierBin = path.join(
        repoRoot,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'prettier.cmd' : 'prettier',
      );
      const result = spawnSync(prettierBin, ['--write', summaryPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'ignore',
      });
      if (result.status !== 0) {
        throw new Error(`prettier --write ${summaryPath} failed`);
      }
    };

    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    const createdDoc = !fs.existsSync(docPath);
    if (createdDoc) {
      const placeholderDoc = [
        '---',
        'title: "Codex Automation Prompt"',
        'slug: "codex-automation"',
        '---',
        '',
        '# Codex Automation Prompt',
        '',
      ].join('\n');
      fs.writeFileSync(docPath, `${placeholderDoc}\n`, 'utf8');
    }

    fs.writeFileSync(summaryPath, `${sanitizedSummary}\n`, 'utf8');
    formatSummary();
    fs.renameSync(docPath, backupPath);

    try {
      const { status, stdout, stderr } = runChorePrompts();
      if (status !== 0) {
        const combined = `${stdout}\n${stderr}`;
        throw new Error(`chore:prompts exited with code ${status}:\n${combined}`);
      }
    } finally {
      if (fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, docPath);
      }
      if (createdDoc && fs.existsSync(docPath)) {
        fs.unlinkSync(docPath);
      }
      fs.writeFileSync(summaryPath, originalSummary, 'utf8');
    }
  }, 20000);
});
