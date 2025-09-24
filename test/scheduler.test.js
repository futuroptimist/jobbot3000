import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createTaskScheduler } from '../src/schedule.js';

describe('task scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs tasks after the initial delay and reschedules using the interval', async () => {
    const start = Date.now();
    const ticks = [];

    const scheduler = createTaskScheduler([
      {
        id: 'ingest-hourly',
        intervalMs: 1000,
        initialDelayMs: 500,
        run: async () => {
          ticks.push(Date.now() - start);
        },
      },
    ]);

    scheduler.start();

    await vi.advanceTimersByTimeAsync(500);
    expect(ticks).toEqual([500]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks).toEqual([500, 1500]);

    scheduler.stop();
  });

  it('never overlaps runs even when the task duration exceeds the interval', async () => {
    const start = Date.now();
    const launches = [];

    const scheduler = createTaskScheduler([
      {
        id: 'slow-task',
        intervalMs: 300,
        initialDelayMs: 0,
        run: () => {
          launches.push(Date.now() - start);
          return new Promise(resolve => {
            setTimeout(() => resolve(), 1000);
          });
        },
      },
    ]);

    scheduler.start();

    await vi.advanceTimersByTimeAsync(300);
    expect(launches).toEqual([0]);

    await vi.advanceTimersByTimeAsync(600);
    expect(launches).toEqual([0]);

    await vi.advanceTimersByTimeAsync(400);
    expect(launches).toEqual([0, 1300]);

    scheduler.stop();
  });

  it('resolves when all finite tasks finish their allotted runs', async () => {
    let runs = 0;

    const scheduler = createTaskScheduler([
      {
        id: 'finite-task',
        intervalMs: 200,
        maxRuns: 2,
        run: async () => {
          runs += 1;
        },
      },
    ]);

    const idle = scheduler.whenIdle();
    scheduler.start();

    await vi.advanceTimersByTimeAsync(500);
    await idle;

    expect(runs).toBe(2);
  });

  it('invokes onError hooks and keeps scheduling after failures', async () => {
    const errors = [];
    let attempts = 0;

    const scheduler = createTaskScheduler([
      {
        id: 'flaky-task',
        intervalMs: 200,
        onError: err => errors.push(err.message),
        run: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('boom');
          }
        },
      },
    ]);

    scheduler.start();

    await vi.advanceTimersByTimeAsync(200);
    expect(errors).toEqual(['boom']);

    await vi.advanceTimersByTimeAsync(200);
    expect(attempts).toBe(2);

    scheduler.stop();
  });
});
