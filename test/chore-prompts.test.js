import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');

function runChorePrompts(extraArgs = ['--check']) {
  const result = spawnSync('npm', ['run', 'chore:prompts', '--', ...extraArgs], {
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
  const TIMEOUT = 20000;

  it('fails in check mode when prompt docs need formatting', () => {
    const tempFile = path.join(repoRoot, 'docs', 'prompts', 'codex', '__temp-format-test.md');
    fs.writeFileSync(tempFile, '##Heading\ncontent\n');
    try {
      const { status } = runChorePrompts(['--check']);
      expect(status).not.toBe(0);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }, TIMEOUT);

  it('fails in check mode when a prompt doc omits the README link', () => {
    const tempFile = path.join(repoRoot, 'docs', 'prompts', 'codex', '__temp-readme-link.md');
    fs.writeFileSync(tempFile, '# Temp prompt\n\nThis placeholder omits the README reference.\n');
    try {
      const { status, stdout, stderr } = runChorePrompts(['--check']);
      expect(status).not.toBe(0);
      const combined = `${stdout}\n${stderr}`;
      expect(combined).toMatch(/README/i);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }, TIMEOUT);

  // cspell scans the entire prompt docs tree; give CI ample time before declaring a timeout.
  it('runs the prompts chore script successfully', () => {
    const { status, stdout, stderr } = runChorePrompts();
    if (status !== 0) {
      const combined = `${stdout}\n${stderr}`;
      throw new Error(`chore:prompts exited with code ${status}:\n${combined}`);
    }
    expect(stdout).toContain('Prompt docs chore completed');
  }, TIMEOUT);
});
