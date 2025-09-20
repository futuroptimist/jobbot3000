import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir;

describe('profile init', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-profile-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
  });

  it('creates a resume skeleton when none exists', async () => {
    const { initProfile } = await import('../src/profile.js');
    const result = await initProfile();
    expect(result.created).toBe(true);
    const resumePath = path.join(dataDir, 'profile', 'resume.json');
    const raw = await fs.readFile(resumePath, 'utf8');
    const resume = JSON.parse(raw);
    expect(Array.isArray(resume.work)).toBe(true);
    expect(resume.basics).toBeDefined();
  });

  it('does not overwrite an existing resume file', async () => {
    const resumePath = path.join(dataDir, 'profile', 'resume.json');
    await fs.mkdir(path.dirname(resumePath), { recursive: true });
    await fs.writeFile(
      resumePath,
      JSON.stringify({ basics: { name: 'Existing' } }, null, 2),
      'utf8'
    );

    const { initProfile } = await import('../src/profile.js');
    const result = await initProfile();
    expect(result.created).toBe(false);
    const raw = await fs.readFile(resumePath, 'utf8');
    expect(JSON.parse(raw)).toEqual({ basics: { name: 'Existing' } });
  });
});
