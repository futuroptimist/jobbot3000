vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return { ...actual, spawn: vi.fn() };
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import * as childProcess from 'node:child_process';

import { createCommandAdapter } from '../src/web/command-adapter.js';

describe('createCommandAdapter', () => {
  let originalEnableNativeCli;

  beforeEach(() => {
    originalEnableNativeCli = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
  });

  afterEach(() => {
    childProcess.spawn.mockReset();
    if (originalEnableNativeCli === undefined) {
      delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    } else {
      process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = originalEnableNativeCli;
    }
  });

  function createTempJobFile(contents = 'Role: Example Engineer') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-web-adapter-'));
    const filePath = path.join(dir, 'posting.txt');
    fs.writeFileSync(filePath, `${contents}\n`, 'utf8');
    return {
      dir,
      filePath,
      cleanup() {
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  function createSpawnedProcess({ stdout = '', stderr = '', exitCode = 0, signal = null } = {}) {
    const child = new EventEmitter();
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    stdoutStream.setEncoding('utf8');
    stderrStream.setEncoding('utf8');

    child.stdout = stdoutStream;
    child.stderr = stderrStream;
    child.kill = vi.fn();

    setImmediate(() => {
      if (stdout) stdoutStream.write(stdout);
      stdoutStream.end();
      if (stderr) stderrStream.write(stderr);
      stderrStream.end();
      child.emit('close', exitCode, signal);
    });

    return child;
  }

  it('runs summarize with json format and parses output', async () => {
    const cli = {
      cmdSummarize: vi.fn(async args => {
        expect(args).toEqual([
          'job.txt',
          '--json',
          '--sentences',
          '3',
          '--locale',
          'es',
          '--timeout',
          '20000',
          '--max-bytes',
          '4096',
        ]);
        console.log('{"summary":"ok"}');
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter.summarize({
      input: 'job.txt',
      format: 'json',
      sentences: 3,
      locale: 'es',
      timeoutMs: 20000,
      maxBytes: 4096,
    });

    expect(result).toMatchObject({
      command: 'summarize',
      format: 'json',
      stdout: '{"summary":"ok"}',
      stderr: '',
      data: { summary: 'ok' },
    });
    expect(cli.cmdSummarize).toHaveBeenCalledTimes(1);
  });

  it('redacts secrets from parsed JSON payloads', async () => {
    const cli = {
      cmdSummarize: vi.fn(async () => {
        console.log('{"token":"abcd1234secret","details":{"client_secret":"supersecret"}}');
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter.summarize({ input: 'job.txt', format: 'json' });

    expect(result.stdout).toBe('{"token":"***","details":{"client_secret":"***"}}');
    expect(result.data).toEqual({ token: '***', details: { client_secret: '***' } });
  });

  it('runs match with optional flags and parses json output', async () => {
    const cli = {
      cmdMatch: vi.fn(async args => {
        expect(args).toEqual([
          '--resume',
          'resume.txt',
          '--job',
          'job.txt',
          '--json',
          '--explain',
          '--locale',
          'fr',
          '--role',
          'Engineer',
          '--location',
          'Remote',
          '--profile',
          'profile.json',
          '--timeout',
          '10000',
          '--max-bytes',
          '5120',
        ]);
        console.log('{"score":95}');
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter.match({
      resume: 'resume.txt',
      job: 'job.txt',
      format: 'json',
      explain: true,
      locale: 'fr',
      role: 'Engineer',
      location: 'Remote',
      profile: 'profile.json',
      timeoutMs: 10000,
      maxBytes: 5120,
    });

    expect(result).toMatchObject({
      command: 'match',
      format: 'json',
      stdout: '{"score":95}',
      stderr: '',
      data: { score: 95 },
    });
    expect(cli.cmdMatch).toHaveBeenCalledTimes(1);
  });

  it('throws when required summarize input is missing', async () => {
    const cli = { cmdSummarize: vi.fn() };
    const adapter = createCommandAdapter({ cli });
    await expect(adapter.summarize({})).rejects.toThrow('input is required');
    expect(cli.cmdSummarize).not.toHaveBeenCalled();
  });

  it('rejects unsupported summarize formats', async () => {
    const cli = { cmdSummarize: vi.fn() };
    const adapter = createCommandAdapter({ cli });

    await expect(
      adapter.summarize({ input: 'job.txt', format: 'xml' }),
    ).rejects.toThrow("format must be one of: markdown, text, json");

    expect(cli.cmdSummarize).not.toHaveBeenCalled();
  });

  it('rejects summarize requests with non-positive sentence counts', async () => {
    const cli = { cmdSummarize: vi.fn() };
    const adapter = createCommandAdapter({ cli });

    await expect(
      adapter.summarize({ input: 'job.txt', sentences: 0 }),
    ).rejects.toThrow('sentences must be a positive integer');

    expect(cli.cmdSummarize).not.toHaveBeenCalled();
  });

  it('treats non-finite numeric enableNativeCli options as disabled', async () => {
    const adapter = createCommandAdapter({ enableNativeCli: Number(undefined) });

    await expect(
      adapter.summarize({ input: 'job.txt' }),
    ).rejects.toMatchObject({ code: 'NATIVE_CLI_DISABLED' });
  });

  it('treats non-finite numeric enableNativeCli options as disabled', async () => {
    const adapter = createCommandAdapter({ enableNativeCli: Number(undefined) });

    await expect(
      adapter.summarize({ input: 'job.txt' }),
    ).rejects.toMatchObject({ code: 'NATIVE_CLI_DISABLED' });
  });

  it('throws when required match arguments are missing', async () => {
    const cli = { cmdMatch: vi.fn() };
    const adapter = createCommandAdapter({ cli });
    await expect(adapter.match({ job: 'job.txt' })).rejects.toThrow('resume is required');
    await expect(adapter.match({ resume: 'resume.txt' })).rejects.toThrow('job is required');
    expect(cli.cmdMatch).not.toHaveBeenCalled();
  });

  it('rejects unsupported match formats', async () => {
    const cli = { cmdMatch: vi.fn() };
    const adapter = createCommandAdapter({ cli });

    await expect(
      adapter.match({ resume: 'resume.txt', job: 'job.txt', format: 'xml' }),
    ).rejects.toThrow("format must be one of: markdown, text, json");

    expect(cli.cmdMatch).not.toHaveBeenCalled();
  });

  it('wraps CLI errors with captured stderr output', async () => {
    const cli = {
      cmdSummarize: vi.fn(async () => {
        console.error('boom');
        throw new Error('failed');
      }),
    };
    const adapter = createCommandAdapter({ cli });
    await expect(adapter.summarize({ input: 'job.txt' })).rejects.toMatchObject({
      message: 'summarize command failed: failed',
      stderr: 'boom',
    });
  });

  it('logs structured telemetry for successful commands', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const cli = {
      cmdSummarize: vi.fn(async () => {
        console.log('{"status":"ok"}');
      }),
    };

    const adapter = createCommandAdapter({
      cli,
      logger: { info, error },
      generateCorrelationId: () => 'corr-success',
    });

    const result = await adapter.summarize({ input: 'job.txt', format: 'json' });

    expect(result.correlationId).toBe('corr-success');
    expect(result.traceId).toBe('corr-success');
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    const entry = info.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: 'cli.command',
      command: 'summarize',
      status: 'success',
      exitCode: 0,
      correlationId: 'corr-success',
    });
    expect(entry.traceId).toBe('corr-success');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs structured telemetry for failed commands', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const cli = {
      cmdSummarize: vi.fn(async () => {
        console.error('bad');
        throw new Error('boom');
      }),
    };

    const adapter = createCommandAdapter({
      cli,
      logger: { info, error },
      generateCorrelationId: () => 'corr-fail',
    });

    await expect(adapter.summarize({ input: 'job.txt' })).rejects.toMatchObject({
      message: 'summarize command failed: boom',
      stderr: 'bad',
      correlationId: 'corr-fail',
      traceId: 'corr-fail',
    });

    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);

    const entry = error.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: 'cli.command',
      command: 'summarize',
      status: 'error',
      exitCode: 1,
      correlationId: 'corr-fail',
      errorMessage: 'boom',
    });
    expect(entry.traceId).toBe('corr-fail');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws when CLI method is missing', async () => {
    const adapter = createCommandAdapter({ cli: {} });
    await expect(adapter.summarize({ input: 'job.txt' })).rejects.toThrow(
      'unknown CLI command method: cmdSummarize',
    );
  });

  it('redacts secret-like tokens in telemetry logs and error messages', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const cli = {
      cmdSummarize: vi.fn(async () => {
        console.error('API_KEY=abcd1234secret');
        throw new Error('Request failed with API_KEY=abcd1234secret');
      }),
    };

    const adapter = createCommandAdapter({
      cli,
      logger: { info, error },
      generateCorrelationId: () => 'trace-secret',
    });

    await expect(adapter.summarize({ input: 'job.txt' })).rejects.toMatchObject({
      message: 'summarize command failed: Request failed with API_KEY=***',
      correlationId: 'trace-secret',
      traceId: 'trace-secret',
      stderr: 'API_KEY=***',
    });

    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const entry = error.mock.calls[0][0];
    expect(entry.correlationId).toBe('trace-secret');
    expect(entry.traceId).toBe('trace-secret');
    expect(entry.errorMessage).toBe('Request failed with API_KEY=***');
  });

  it('sanitizes stdout, stderr, and return values for inline CLI adapters', async () => {
    const cli = {
      cmdSummarize: vi.fn(async () => {
        console.log('API_KEY=abcd1234secret');
        console.error('Bearer sk_live_1234567890');
        return { token: 'abcd1234secret', nested: { client_secret: 'supersecret' } };
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter.summarize({ input: 'job.txt' });

    expect(result.stdout).toBe('API_KEY=***');
    expect(result.stderr).toBe('Bearer ***');
    expect(result.returnValue).toEqual({ token: '***', nested: { client_secret: '***' } });
  });

  it('runs shortlist list with filters and paginates CLI output', async () => {
    const cli = {
      cmdShortlistList: vi.fn(async args => {
        expect(args).toEqual([
          '--json',
          '--location',
          'Remote',
          '--level',
          'Senior',
          '--compensation',
          '$185k',
          '--tag',
          'remote',
          '--tag',
          'dream',
        ]);
        console.log(
          JSON.stringify({
            jobs: {
              'job-1': {
                metadata: {
                  location: 'Remote',
                  level: 'Senior',
                  compensation: '$185k',
                  synced_at: '2025-03-06T08:00:00.000Z',
                },
                tags: ['remote', 'dream'],
                discard_count: 1,
                last_discard: {
                  reason: 'Paused hiring',
                  discarded_at: '2025-03-05T12:00:00.000Z',
                  tags: ['paused'],
                },
              },
              'job-2': {
                metadata: {
                  location: 'Remote',
                  level: 'Senior',
                  compensation: '$185k',
                  synced_at: '2025-03-04T09:00:00.000Z',
                },
                tags: ['remote'],
                discard_count: 0,
              },
            },
          }),
        );
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['shortlist-list']({
      location: 'Remote',
      level: 'Senior',
      compensation: '$185k',
      tags: ['remote', 'dream'],
      limit: 1,
      offset: 1,
    });

    expect(cli.cmdShortlistList).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'shortlist-list',
      format: 'json',
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        filters: {
          location: 'Remote',
          level: 'Senior',
          compensation: '$185k',
          tags: ['remote', 'dream'],
        },
        hasMore: false,
      },
    });
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0]).toMatchObject({ id: 'job-2' });
  });

  it('loads shortlist show details with sanitized output', async () => {
    const cli = {
      cmdShortlistShow: vi.fn(async args => {
        expect(args).toEqual(['job-7', '--json']);
        console.log(
          JSON.stringify({
            job_id: 'job-7',
            metadata: { location: 'Remote' },
            tags: ['remote'],
            discard_count: 1,
            last_discard: { reason: 'Paused', discarded_at: '2025-03-05T12:00:00.000Z' },
            events: [
              {
                channel: 'email',
                note: 'Sent resume',
                documents: ['resume.pdf'],
                remind_at: '2025-03-06T15:00:00.000Z',
              },
            ],
          }),
        );
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['shortlist-show']({ jobId: 'job-7' });

    expect(cli.cmdShortlistShow).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'shortlist-show',
      format: 'json',
      data: {
        job_id: 'job-7',
        metadata: { location: 'Remote' },
        tags: ['remote'],
      },
    });
    expect(result.data.events).toEqual([
      {
        channel: 'email',
        note: 'Sent resume',
        documents: ['resume.pdf'],
        remind_at: '2025-03-06T15:00:00.000Z',
      },
    ]);
  });

  it('spawns the CLI without shell interpolation when no cli module is provided', async () => {
    process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = '1';
    const spawnMock = childProcess.spawn;
    spawnMock.mockImplementation((command, args, options) => {
      expect(command).toBe(process.execPath);
      expect(options).toMatchObject({
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return createSpawnedProcess({ stdout: '{"summary":"ok"}\n' });
    });

    const temp = createTempJobFile('We are hiring a senior engineer.');

    try {
      const adapter = createCommandAdapter();
      const result = await adapter.summarize({ input: temp.filePath, format: 'json' });

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [spawnCommand, spawnArgs] = spawnMock.mock.calls[0];
      expect(spawnCommand).toBe(process.execPath);
      const expectedCliPath = fs.realpathSync(path.join(process.cwd(), 'bin', 'jobbot.js'));
      expect(spawnArgs[0]).toBe(expectedCliPath);
      expect(spawnArgs.slice(1)).toEqual(['summarize', temp.filePath, '--json']);
      expect(result).toMatchObject({
        command: 'summarize',
        format: 'json',
        stdout: '{"summary":"ok"}\n',
        data: { summary: 'ok' },
      });
    } finally {
      temp.cleanup();
    }
  });

  it('propagates stderr when the spawned CLI exits with a non-zero code', async () => {
    process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = 'true';
    const spawnMock = childProcess.spawn;
    spawnMock.mockImplementation(() =>
      createSpawnedProcess({ stdout: '', stderr: 'boom\n', exitCode: 2 }),
    );

    const temp = createTempJobFile('The role requires leadership.');

    try {
      const adapter = createCommandAdapter();
      await expect(adapter.summarize({ input: temp.filePath })).rejects.toMatchObject({
        message: expect.stringContaining('summarize command failed'),
        stderr: 'boom\n',
      });
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      temp.cleanup();
    }
  });

  it('requires enabling native CLI execution when no inline adapter is provided', async () => {
    const adapter = createCommandAdapter({ enableNativeCli: false });

    await expect(adapter.summarize({ input: 'job.txt' })).rejects.toThrow(
      /native cli execution is disabled/i,
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});
