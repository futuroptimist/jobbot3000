import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/greenhouse.js', () => ({
  ingestGreenhouseBoard: vi.fn(async () => ({ saved: 3 })),
}));

vi.mock('../src/scoring.js', () => ({
  computeFitScore: vi.fn(() => ({
    score: 0.75,
    matched: ['Team leadership'],
    missing: [],
    must_haves_missed: [],
    keyword_overlap: [],
    evidence: [{ text: 'Team leadership', source: 'requirements' }],
  })),
}));

import { loadScheduleConfig, buildScheduledTasks } from '../src/schedule.js';
import { ingestGreenhouseBoard } from '../src/greenhouse.js';
import { computeFitScore } from '../src/scoring.js';

describe('schedule config', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-schedule-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('parses ingestion tasks with minute-based intervals', async () => {
    const configPath = path.join(tmpDir, 'schedule.json');
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          tasks: [
            {
              id: 'greenhouse-hourly',
              type: 'ingest',
              provider: 'greenhouse',
              company: 'acme',
              intervalMinutes: 60,
              initialDelayMinutes: 5,
            },
          ],
        },
        null,
        2,
      ),
    );

    const definitions = await loadScheduleConfig(configPath);
    expect(definitions).toEqual([
      expect.objectContaining({
        id: 'greenhouse-hourly',
        type: 'ingest',
        provider: 'greenhouse',
        params: expect.objectContaining({ board: 'acme' }),
        intervalMs: 60 * 60 * 1000,
        initialDelayMs: 5 * 60 * 1000,
      }),
    ]);
  });

  it('builds runnable tasks that invoke ingestion and matching workflows', async () => {
    const resumePath = path.join(tmpDir, 'resume.txt');
    await fs.writeFile(resumePath, 'Experienced engineer with leadership experience.');

    const jobPath = path.join(tmpDir, 'job.json');
    await fs.writeFile(
      jobPath,
      JSON.stringify({ parsed: { requirements: ['leadership', 'collaboration'] } }, null, 2),
    );

    const definitions = [
      {
        id: 'greenhouse-hourly',
        type: 'ingest',
        provider: 'greenhouse',
        params: { board: 'acme' },
        intervalMs: 1000,
      },
      {
        id: 'match-sample',
        type: 'match',
        params: {
          resume: resumePath,
          jobFile: jobPath,
        },
        intervalMs: 2000,
      },
    ];

    const logger = { info: vi.fn(), error: vi.fn() };
    const tasks = buildScheduledTasks(definitions, { logger, cycles: 1 });

    expect(tasks).toHaveLength(2);

    const ingestTask = tasks.find(task => task.id === 'greenhouse-hourly');
    const matchTask = tasks.find(task => task.id === 'match-sample');

    const ingestMessage = await ingestTask.run();
    ingestTask.onSuccess?.(ingestMessage, ingestTask);
    expect(ingestGreenhouseBoard).toHaveBeenCalledWith(
      expect.objectContaining({ board: 'acme' }),
    );

    const matchMessage = await matchTask.run();
    matchTask.onSuccess?.(matchMessage, matchTask);
    expect(computeFitScore).toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('greenhouse-hourly'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('match-sample'));

    expect(ingestTask.maxRuns).toBe(1);
    expect(matchTask.maxRuns).toBe(1);
  });

  it('throws when required interval metadata is missing', async () => {
    const configPath = path.join(tmpDir, 'invalid.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        tasks: [{ id: 'bad', type: 'ingest', provider: 'greenhouse', company: 'acme' }],
      }),
    );

    await expect(loadScheduleConfig(configPath)).rejects.toThrow(/interval/i);
  });

  it('surfaces an actionable error when a match job snapshot is missing', async () => {
    const resumePath = path.join(tmpDir, 'resume.txt');
    await fs.writeFile(resumePath, 'Seasoned engineer.');

    const definitions = [
      {
        id: 'match-missing-job',
        type: 'match',
        params: {
          resume: resumePath,
          jobId: 'job-999',
        },
        intervalMs: 1000,
      },
    ];

    const logger = { info: vi.fn(), error: vi.fn() };

    const originalDataDir = process.env.JOBBOT_DATA_DIR;
    process.env.JOBBOT_DATA_DIR = tmpDir;

    try {
      const tasks = buildScheduledTasks(definitions, { logger });
      const matchTask = tasks.find(task => task.id === 'match-missing-job');
      await expect(matchTask.run()).rejects.toThrow(
        /match task match-missing-job could not find job snapshot job-999/i,
      );
    } finally {
      if (originalDataDir === undefined) {
        delete process.env.JOBBOT_DATA_DIR;
      } else {
        process.env.JOBBOT_DATA_DIR = originalDataDir;
      }
    }
  });
});
