import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeResumePdfArtifact } from '../bin/jobbot.js';
import * as resumePdf from '../src/resume-pdf.js';

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'resume-pdf-artifact-'));
}

describe('writeResumePdfArtifact', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    vi.restoreAllMocks();
  });

  it('writes a resume.pdf file when rendering succeeds', async () => {
    const resume = {
      basics: { name: 'Ada Example', email: 'ada@example.com' },
      summary: 'Systems engineer',
    };

    const result = await writeResumePdfArtifact({ runDir: tmpDir, resume });

    expect(result).toMatchObject({ wrote: true, bytes: expect.any(Number) });
    expect(result.bytes).toBeGreaterThan(100);

    const pdfPath = path.join(tmpDir, 'resume.pdf');
    const stat = await fs.stat(pdfPath);
    expect(stat.size).toBe(result.bytes);

    const header = (await fs.readFile(pdfPath)).subarray(0, 4).toString();
    expect(header).toBe('%PDF');
  });

  it('skips writing when renderer returns an empty buffer', async () => {
    vi.spyOn(resumePdf, 'renderResumePdf').mockResolvedValue(Buffer.alloc(0));

    const result = await writeResumePdfArtifact({
      runDir: tmpDir,
      resume: {},
    });

    expect(result).toEqual({ wrote: false, path: path.join(tmpDir, 'resume.pdf'), bytes: 0 });
    await expect(fs.stat(path.join(tmpDir, 'resume.pdf'))).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('logs a warning when rendering fails and debug logging is enabled', async () => {
    const error = new Error('boom');
    vi.spyOn(resumePdf, 'renderResumePdf').mockRejectedValue(error);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await writeResumePdfArtifact({
      runDir: tmpDir,
      resume: {},
      logDebug: true,
    });

    expect(result).toMatchObject({ wrote: false, error });
    expect(warn).toHaveBeenCalledWith('jobbot: failed to synthesize resume.pdf: boom');
  });
});
