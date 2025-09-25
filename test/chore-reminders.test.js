import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');

function runChoreReminders(...args) {
  return spawnSync('node', ['scripts/chore-reminders.js', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('chore reminders script', () => {
  it('emits structured JSON when --json is provided', () => {
    const { status, stdout, stderr } = runChoreReminders('--json');
    if (status !== 0) {
      throw new Error(`chore-reminders exited with ${status}: ${stderr}`);
    }
    const payload = JSON.parse(stdout);
    expect(Array.isArray(payload.tasks)).toBe(true);
    expect(payload.tasks.length).toBeGreaterThan(0);
    const lintSweep = payload.tasks.find(task => task.task.includes('Lint'));
    expect(lintSweep?.commands).toContain('npm run lint');
    expect(lintSweep?.commands).toContain('npm run test:ci');
  });
});
