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

vi.mock('../src/notifications.js', () => ({
  isWeeklySummaryNotificationsEnabled: vi.fn(() => true),
  runWeeklySummaryNotifications: vi.fn(async () => ({
    sent: 1,
    results: [{ email: 'ada@example.com', file: '/tmp/subscriber.eml' }],
  })),
  sendWeeklySummaryNotification: vi.fn(async () => ({ filePath: '/tmp/direct.eml' })),
}));

import { loadScheduleConfig, buildScheduledTasks } from '../src/schedule.js';
import { ingestGreenhouseBoard } from '../src/greenhouse.js';
import { computeFitScore } from '../src/scoring.js';
import {
  runWeeklySummaryNotifications,
  sendWeeklySummaryNotification,
} from '../src/notifications.js';
import { createModuleEventBus } from '../src/shared/events/bus.js';
import { registerScrapingModule } from '../src/modules/scraping/index.js';

describe('schedule config', () => {
  let tmpDir;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  it('parses ingestion tasks from YAML schedule configs', async () => {
    const configPath = path.join(tmpDir, 'shortlist.yml');
    await fs.writeFile(
      configPath,
      [
        'tasks:',
        '  - id: shortlist-nightly',
        '    type: ingest',
        '    provider: greenhouse',
        '    company: acme',
        '    intervalMinutes: 720',
        '    initialDelayMinutes: 30',
      ].join('\n'),
    );

    const definitions = await loadScheduleConfig(configPath);
    expect(definitions).toEqual([
      expect.objectContaining({
        id: 'shortlist-nightly',
        type: 'ingest',
        provider: 'greenhouse',
        params: expect.objectContaining({ board: 'acme' }),
        intervalMs: 720 * 60 * 1000,
        initialDelayMs: 30 * 60 * 1000,
      }),
    ]);
  });

  it('parses notification tasks with optional recipients and outbox overrides', async () => {
    const configPath = path.join(tmpDir, 'notifications.json');
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          tasks: [
            {
              id: 'weekly-summary',
              type: 'notifications',
              intervalMinutes: 60,
              outbox: 'mail/outbox',
              recipients: ['direct@example.com'],
              lookbackDays: 14,
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
        id: 'weekly-summary',
        type: 'notifications',
        params: expect.objectContaining({
          template: 'weekly-summary',
          useSubscriptions: true,
          recipients: ['direct@example.com'],
          lookbackDays: 14,
          outbox: path.join(tmpDir, 'mail', 'outbox'),
        }),
        intervalMs: 60 * 60 * 1000,
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

  it('dispatches ingestion tasks through the module event bus when provided', async () => {
    const bus = createModuleEventBus();
    const mockHandler = vi.fn(async () => ({
      saved: 2,
      jobIds: ['job-1', 'job-2'],
      board: 'acme',
    }));

    const dispose = registerScrapingModule({
      bus,
      config: {
        features: { scraping: { useMocks: true } },
        mocks: { scrapingProvider: mockHandler },
      },
    });

    try {
      const definitions = [
        {
          id: 'greenhouse-hourly',
          type: 'ingest',
          provider: 'greenhouse',
          params: { board: 'acme' },
          intervalMs: 1000,
        },
      ];

      const logger = { info: vi.fn(), error: vi.fn() };
      const tasks = buildScheduledTasks(definitions, {
        logger,
        moduleBus: bus,
        cycles: 1,
      });

      expect(tasks).toHaveLength(1);
      const [ingestTask] = tasks;

      const message = await ingestTask.run();
      ingestTask.onSuccess?.(message, ingestTask);

      expect(mockHandler).toHaveBeenCalledWith({
        provider: 'greenhouse',
        options: { board: 'acme' },
      });
      expect(ingestGreenhouseBoard).not.toHaveBeenCalled();
      expect(message).toBe('Imported 2 jobs from greenhouse acme');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('greenhouse-hourly'));
    } finally {
      dispose();
    }
  });

  it('runs notification tasks and logs recipients', async () => {
    const outboxDir = path.join(tmpDir, 'outbox');
    const nowDate = new Date('2025-02-09T12:00:00.000Z');

    const definitions = [
      {
        id: 'weekly-summary',
        type: 'notifications',
        params: {
          template: 'weekly-summary',
          recipients: ['direct@example.com'],
          useSubscriptions: false,
          outbox: outboxDir,
          lookbackDays: 10,
        },
        intervalMs: 5000,
      },
    ];

    const logger = { info: vi.fn(), error: vi.fn() };
    const tasks = buildScheduledTasks(definitions, { logger, now: () => nowDate });

    expect(tasks).toHaveLength(1);
    const [notificationsTask] = tasks;

    const message = await notificationsTask.run();
    notificationsTask.onSuccess?.(message, notificationsTask);

    expect(sendWeeklySummaryNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'direct@example.com',
        lookbackDays: 10,
        now: nowDate,
        outbox: outboxDir,
      }),
    );
    expect(runWeeklySummaryNotifications).not.toHaveBeenCalled();
    expect(message).toContain('Sent weekly summary to 1 recipient');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('weekly-summary'));
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
