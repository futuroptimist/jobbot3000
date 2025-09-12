import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { ensureDefaultConsoleFont } from '../src/console-font.js';

describe('ensureDefaultConsoleFont', () => {
  it('creates default font from fallback when missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'font-'));
    const fallback = path.join(dir, 'Lat15-TerminusBold14.psf.gz');
    await fs.writeFile(fallback, 'fontdata');
    const defaultPath = await ensureDefaultConsoleFont(dir);
    const data = await fs.readFile(defaultPath, 'utf8');
    expect(defaultPath).toBe(path.join(dir, 'default.psf.gz'));
    expect(data).toBe('fontdata');
  });

  it('keeps existing default font', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'font-'));
    const fallback = path.join(dir, 'Lat15-TerminusBold14.psf.gz');
    await fs.writeFile(fallback, 'fallback');
    const defaultFile = path.join(dir, 'default.psf.gz');
    await fs.writeFile(defaultFile, 'original');
    await ensureDefaultConsoleFont(dir);
    const data = await fs.readFile(defaultFile, 'utf8');
    expect(data).toBe('original');
  });
});
