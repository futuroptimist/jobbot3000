import { describe, expect, it, vi } from 'vitest';

import { createCommandAdapter } from '../src/web/command-adapter.js';

describe('createCommandAdapter', () => {
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

  it('throws when required match arguments are missing', async () => {
    const cli = { cmdMatch: vi.fn() };
    const adapter = createCommandAdapter({ cli });
    await expect(adapter.match({ job: 'job.txt' })).rejects.toThrow('resume is required');
    await expect(adapter.match({ resume: 'resume.txt' })).rejects.toThrow('job is required');
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

  it('throws when CLI method is missing', async () => {
    const adapter = createCommandAdapter({ cli: {} });
    await expect(adapter.summarize({ input: 'job.txt' })).rejects.toThrow(
      'unknown CLI command method: cmdSummarize',
    );
  });
});
