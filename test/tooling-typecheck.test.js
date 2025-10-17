import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

describe('typecheck automation', () => {
  it('exposes a passing npm script for TypeScript checks', async () => {
    const packageJsonPath = path.join(repoRoot, 'package.json');
    const raw = await fs.readFile(packageJsonPath, 'utf8');
    const pkg = JSON.parse(raw);
    expect(pkg.scripts?.typecheck).toBeTruthy();

    await expect(runTypecheck()).resolves.toBeUndefined();
  }, 120_000);
});

function runTypecheck() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'typecheck', '--', '--pretty', 'false'], {
      cwd: repoRoot,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        const output = (stderr || stdout || '').trim();
        reject(new Error(`npm run typecheck exited with code ${code}: ${output}`));
      }
    });
  });
}
