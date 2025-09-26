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
});
