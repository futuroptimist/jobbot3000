import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

describe('allowlisted CLI runner', () => {
  let runAllowlistedCommand;
  let CliInvocationError;

  beforeEach(async () => {
    spawnMock.mockReset();
    vi.resetModules();
    ({ runAllowlistedCommand, CliInvocationError } = await import(
      '../src/services/cli-runner.js'
    ));
  });

  function createChildProcess({
    stdoutChunks = [],
    stderrChunks = [],
    exitCode = 0,
    autoClose = true,
  } = {}) {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    };
    child.kill = vi.fn(() => {
      setImmediate(() => child.emit('close', null, 'SIGTERM'));
      return true;
    });

    queueMicrotask(() => {
      for (const chunk of stdoutChunks) {
        stdout.emit('data', Buffer.from(chunk));
      }
      for (const chunk of stderrChunks) {
        stderr.emit('data', Buffer.from(chunk));
      }
      if (autoClose) {
        child.emit('close', exitCode, null);
      }
    });

    return child;
  }

  it('spawns jobbot commands without using a shell', async () => {
    const child = createChildProcess({ stdoutChunks: ['{"ok":true}\n'] });
    spawnMock.mockReturnValue(child);

    const result = await runAllowlistedCommand({
      command: ['shortlist', 'list'],
      filters: { tags: ['Remote', 'Remote'] },
      json: 'true',
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args, options] = spawnMock.mock.calls[0];
    expect(bin).toBe('jobbot');
    expect(args).toEqual(['shortlist', 'list', '--tag', 'Remote', '--json']);
    expect(options).toMatchObject({ shell: false, stdio: 'pipe' });

    expect(child.stdin.end).toHaveBeenCalled();
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: '{"ok":true}\n',
      stderr: '',
      invocation: {
        bin: 'jobbot',
        command: 'shortlist',
        args: ['list', '--tag', 'Remote', '--json'],
      },
    });
  });

  it('throws when the command is not allowlisted', async () => {
    await expect(
      runAllowlistedCommand({
        command: ['shortlist', 'remove'],
      }),
    ).rejects.toThrow(/unsupported command/i);

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects with detailed errors when the CLI exits unsuccessfully', async () => {
    const child = createChildProcess({ stderrChunks: ['boom'], exitCode: 2 });
    spawnMock.mockReturnValue(child);

    await runAllowlistedCommand({
      command: ['track', 'board'],
    }).catch(error => {
      expect(error).toBeInstanceOf(CliInvocationError);
      expect(error).toMatchObject({
        exitCode: 2,
        stderr: 'boom',
      });
    });
  });

  it('terminates the process if a timeout is reached', async () => {
    const child = createChildProcess({ autoClose: false });
    spawnMock.mockReturnValue(child);

    await runAllowlistedCommand(
      {
        command: ['shortlist', 'list'],
      },
      { timeout: 5 },
    ).catch(error => {
      expect(error).toBeInstanceOf(CliInvocationError);
      expect(error).toMatchObject({ timedOut: true });
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
