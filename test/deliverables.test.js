import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundleDeliverables, setDeliverablesDataDir } from '../src/deliverables.js';

let dataDir;

describe('deliverables bundling', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-deliverables-'));
    setDeliverablesDataDir(dataDir);
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    setDeliverablesDataDir(undefined);
  });

  it('bundles the most recent deliverables run when no timestamp is provided', async () => {
    const latestDir = path.join(
      dataDir,
      'deliverables',
      'job-123',
      '2025-05-02T08-00-00Z'
    );
    const previousDir = path.join(
      dataDir,
      'deliverables',
      'job-123',
      '2025-04-30T17-30-00Z'
    );
    await fs.mkdir(latestDir, { recursive: true });
    await fs.mkdir(previousDir, { recursive: true });

    await fs.writeFile(path.join(previousDir, 'resume.pdf'), 'outdated resume');

    await fs.writeFile(path.join(latestDir, 'resume.pdf'), 'latest resume');
    await fs.writeFile(path.join(latestDir, 'cover_letter.md'), '# Cover Letter');
    await fs.mkdir(path.join(latestDir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(latestDir, 'notes', 'interview.txt'), 'Prep notes');

    const buffer = await bundleDeliverables('job-123');
    const zip = await JSZip.loadAsync(buffer);

    const entries = Object.keys(zip.files).sort();
    expect(entries).toEqual([
      'cover_letter.md',
      'notes/',
      'notes/interview.txt',
      'resume.pdf',
    ]);
    await expect(zip.file('resume.pdf').async('string')).resolves.toBe('latest resume');
    await expect(zip.file('notes/interview.txt').async('string')).resolves.toBe(
      'Prep notes'
    );
  });

  it('bundles a specific timestamp when provided', async () => {
    const root = path.join(dataDir, 'deliverables', 'job-789', '2025-03-15T12-00-00Z');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'report.txt'), 'Status report');

    const buffer = await bundleDeliverables('job-789', { timestamp: '2025-03-15T12-00-00Z' });
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files).sort();
    expect(entries).toEqual(['report.txt']);
    await expect(zip.file('report.txt').async('string')).resolves.toBe('Status report');
  });
});
