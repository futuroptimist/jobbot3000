import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { test, expect } from 'vitest';

test('postinstall script installs default console font', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-'));
  const fallback = path.join(dir, 'Lat15-TerminusBold14.psf.gz');
  fs.writeFileSync(fallback, 'x');
  const result = spawnSync('node', ['scripts/install-console-font.js'], {
    env: { ...process.env, CONSOLE_FONT_DIR: dir }
  });
  expect(result.status).toBe(0);
  const def = path.join(dir, 'default.psf.gz');
  expect(fs.readFileSync(def, 'utf-8')).toBe('x');
  fs.rmSync(dir, { recursive: true, force: true });
});
