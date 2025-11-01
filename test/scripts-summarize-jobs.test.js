import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');

function runSummaries(args = [], options = {}) {
  const result = spawnSync('node', ['scripts/summarize-jobs.js', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  return result;
}

describe('summarize-jobs script', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-summarize-jobs-'));
    const jobsDir = path.join(tmpDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(
      path.join(jobsDir, 'job-one.json'),
      JSON.stringify(
        {
          parsed: {
            title: 'Staff Engineer',
            description:
              'Join the platform team to scale multi-tenant infrastructure. ' +
              'Focus on reliability and developer experience.',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(jobsDir, 'job-two.json'),
      JSON.stringify(
        {
          parsed: {
            title: 'Analytics Lead',
            body:
              'Drive funnel instrumentation and stakeholder reporting. ' +
              'Mentor analysts while shaping the roadmap.',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('summarizes all job snapshots as JSON by default', () => {
    const { status, stdout, stderr } = runSummaries(['--json', '--sentences', '1'], {
      env: { JOBBOT_DATA_DIR: tmpDir },
    });
    if (status !== 0) {
      throw new Error(`summarize-jobs exited with ${status}: ${stderr}`);
    }
    const payload = JSON.parse(stdout);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({
      jobId: 'job-one',
      title: 'Staff Engineer',
    });
    expect(payload[0].summary).toContain('Join the platform team');
    expect(payload[1]).toMatchObject({
      jobId: 'job-two',
      title: 'Analytics Lead',
    });
    expect(payload[1].summary).toContain('Drive funnel instrumentation');
  });

  it('filters summaries when --job is supplied', () => {
    const { status, stdout, stderr } = runSummaries(
      ['--json', '--job', 'job-two', '--sentences', '2'],
      { env: { JOBBOT_DATA_DIR: tmpDir } },
    );
    if (status !== 0) {
      throw new Error(`summarize-jobs exited with ${status}: ${stderr}`);
    }
    const payload = JSON.parse(stdout);
    expect(payload).toEqual([
      expect.objectContaining({ jobId: 'job-two', title: 'Analytics Lead' }),
    ]);
    expect(payload[0].summary.split('.').length).toBeGreaterThan(1);
  });

  it('fails with a helpful error when a job snapshot is missing', () => {
    const { status, stderr } = runSummaries(
      ['--job', 'missing-job'],
      { env: { JOBBOT_DATA_DIR: tmpDir } },
    );
    expect(status).not.toBe(0);
    expect(stderr).toContain('Job snapshot not found: missing-job');
  });
});
