import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_FONT = 'default.psf.gz';
const FALLBACK_FONT = 'Lat15-TerminusBold14.psf.gz';

export async function ensureDefaultConsoleFont(dir, fallback = FALLBACK_FONT) {
  const defaultPath = path.join(dir, DEFAULT_FONT);
  try {
    await fs.access(defaultPath);
    return defaultPath;
  } catch {
    const fallbackPath = path.join(dir, fallback);
    await fs.access(fallbackPath);
    await fs.copyFile(fallbackPath, defaultPath);
    return defaultPath;
  }
}
