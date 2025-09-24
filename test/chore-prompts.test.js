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
});
