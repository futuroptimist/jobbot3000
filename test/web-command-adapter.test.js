vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return { ...actual, spawn: vi.fn() };
});

vi.mock('../src/application-events.js', () => ({
  getApplicationReminders: vi.fn(),
  snoozeApplicationReminder: vi.fn(),
  completeApplicationReminder: vi.fn(),
}));

vi.mock('../src/reminders-calendar.js', () => ({
  createReminderCalendar: vi.fn(),
}));

vi.mock('../src/ingest/recruiterEmail.js', () => ({
  ingestRecruiterEmail: vi.fn(),
}));

vi.mock('../src/services/opportunitiesRepo.js', () => ({
  OpportunitiesRepo: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
  })),
}));

vi.mock('../src/services/audit.js', () => ({
  AuditLog: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
  })),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import * as childProcess from 'node:child_process';

import { createCommandAdapter } from '../src/web/command-adapter.js';
import {
  getApplicationReminders,
  snoozeApplicationReminder,
  completeApplicationReminder,
} from '../src/application-events.js';
import { createReminderCalendar } from '../src/reminders-calendar.js';
import { ingestRecruiterEmail } from '../src/ingest/recruiterEmail.js';
import { OpportunitiesRepo } from '../src/services/opportunitiesRepo.js';
import { AuditLog } from '../src/services/audit.js';

describe('createCommandAdapter', () => {
  let originalEnableNativeCli;

  beforeEach(() => {
    originalEnableNativeCli = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
  });

  afterEach(() => {
    childProcess.spawn.mockReset();
    getApplicationReminders.mockReset();
    snoozeApplicationReminder.mockReset();
    completeApplicationReminder.mockReset();
    createReminderCalendar.mockReset();
    ingestRecruiterEmail.mockReset();
    OpportunitiesRepo.mockReset();
    OpportunitiesRepo.mockImplementation(() => ({ close: vi.fn() }));
    AuditLog.mockReset();
    AuditLog.mockImplementation(() => ({ close: vi.fn() }));
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

  it('loads lifecycle detail, timeline, and attachments with track-show', async () => {
    const cli = {
      cmdTrackShow: vi.fn(async args => {
        expect(args).toEqual(['job-42', '--json']);
        console.log(
          JSON.stringify({
            job_id: 'job-42',
            status: {
              status: 'screening',
              note: 'Waiting on recruiter feedback (api_key=supersecret)',
              updated_at: '2025-03-05T16:00:00.000Z',
            },
            attachments: ['resume.pdf', 'cover-letter.pdf'],
            events: [
              {
                channel: 'applied',
                date: '2025-03-01T09:30:00.000Z',
                note: 'Submitted resume (token=abc12345)',
                documents: ['resume.pdf', 'cover-letter.pdf'],
              },
              {
                channel: 'follow_up',
                date: '2025-03-05T10:15:00.000Z',
                note: 'Checked in with recruiter',
              },
            ],
          }),
        );
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['track-show']({ jobId: 'job-42' });

    expect(cli.cmdTrackShow).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'track-show',
      format: 'json',
    });
    expect(result.data).toMatchObject({
      job_id: 'job-42',
      status: {
        status: 'screening',
        updated_at: '2025-03-05T16:00:00.000Z',
      },
    });
    expect(result.data.status?.note).toContain('api_key=***)');
    expect(result.data.events).toEqual([
      {
        channel: 'applied',
        date: '2025-03-01T09:30:00.000Z',
        note: 'Submitted resume (token=***)',
        documents: ['resume.pdf', 'cover-letter.pdf'],
      },
      {
        channel: 'follow_up',
        date: '2025-03-05T10:15:00.000Z',
        note: 'Checked in with recruiter',
      },
    ]);
    expect(result.data.attachments).toEqual(['resume.pdf', 'cover-letter.pdf']);
  });

  it('requires a jobId when invoking track-show', async () => {
    const cli = {
      cmdTrackShow: vi.fn(),
    };

    const adapter = createCommandAdapter({ cli });

    await expect(adapter['track-show']({})).rejects.toThrow('jobId is required');
    expect(cli.cmdTrackShow).not.toHaveBeenCalled();
  });

  it('loads analytics funnel data with sanitized output', async () => {
    const cli = {
      cmdAnalyticsFunnel: vi.fn(async args => {
        expect(args).toEqual(['--json']);
        console.log(
          JSON.stringify({
            totals: { trackedJobs: 5, withEvents: 4 },
            stages: [
              { key: 'outreach', label: 'Outreach', count: 4, conversionRate: 1 },
              {
                key: 'screening',
                label: 'Screening',
                count: 3,
                conversionRate: 0.75,
                dropOff: 1,
              },
            ],
            largestDropOff: {
              from: 'screening',
              fromLabel: 'Screening',
              to: 'onsite',
              toLabel: 'Onsite',
              dropOff: 2,
            },
            missing: {
              statuslessJobs: {
                count: 1,
                ids: ['job-99'],
              },
            },
            sankey: {
              nodes: [
                { key: 'outreach', label: 'Outreach' },
                { key: 'screening', label: 'Screening' },
              ],
              links: [
                { source: 'outreach', target: 'screening', value: 3 },
                { source: 'outreach', target: 'outreach_drop', value: 1, drop: true },
              ],
            },
          }),
        );
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['analytics-funnel']({});

    expect(cli.cmdAnalyticsFunnel).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'analytics-funnel',
      format: 'json',
    });
    expect(result.data).toMatchObject({
      totals: { trackedJobs: 5, withEvents: 4 },
      largestDropOff: { dropOff: 2 },
    });
    expect(result.data.sankey?.links?.[1]?.drop).toBe(true);
  });

  it('exports analytics snapshots for download workflows', async () => {
    const snapshot = {
      generated_at: '2025-03-08T12:00:00.000Z',
      totals: { trackedJobs: 7, withEvents: 5 },
      funnel: {
        stages: [
          { key: 'outreach', label: 'Outreach', count: 7, conversionRate: 1, dropOff: 0 },
          { key: 'screening', label: 'Screening', count: 5, conversionRate: 0.71, dropOff: 2 },
        ],
      },
    };

    const cli = {
      cmdAnalyticsExport: vi.fn(async args => {
        expect(args).toEqual(['--redact']);
        console.log(JSON.stringify(snapshot));
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['analytics-export']({ redact: true });

    expect(cli.cmdAnalyticsExport).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'analytics-export',
      format: 'json',
    });
    expect(result.data).toMatchObject({
      generated_at: '2025-03-08T12:00:00.000Z',
      totals: { trackedJobs: 7 },
      funnel: { stages: expect.any(Array) },
    });
  });

  it('records application status updates via track-record command', async () => {
    const cli = {
      cmdTrackAdd: vi.fn(async args => {
        expect(args).toEqual(['job-7', '--status', 'offer', '--note', 'Signed offer']);
        console.log('Recorded job-7 as offer');
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['track-record']({
      jobId: 'job-7',
      status: 'offer',
      note: 'Signed offer',
    });

    expect(cli.cmdTrackAdd).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'track-record',
      format: 'text',
      data: {
        jobId: 'job-7',
        status: 'offer',
      },
    });
    expect(result.data.message).toContain('Recorded job-7 as offer');
  });

  it('returns reminder digests in json format with sections', async () => {
    const reminders = [
      {
        job_id: 'job-1',
        remind_at: '2025-03-01T09:00:00Z',
        channel: 'email',
        note: 'Follow up with recruiter',
        contact: 'recruiter@example.com',
      },
      {
        job_id: 'job-2',
        remind_at: '2025-02-01T09:00:00Z',
        past_due: true,
        channel: 'phone',
      },
    ];
    getApplicationReminders.mockResolvedValue(reminders);

    const adapter = createCommandAdapter({ cli: {} });
    const result = await adapter['track-reminders']({ format: 'json', upcomingOnly: true });

    expect(getApplicationReminders).toHaveBeenCalledWith({ includePastDue: false });
    expect(result).toMatchObject({
      command: 'track-reminders',
      format: 'json',
    });
    expect(result.data).toMatchObject({
      upcomingOnly: true,
      reminders: expect.any(Array),
      sections: [
        {
          heading: 'Upcoming',
          reminders: [
            expect.objectContaining({
              job_id: 'job-1',
              channel: 'email',
              contact: 'recruiter@example.com',
            }),
          ],
        },
      ],
    });
    expect(result.stdout).toContain('job-1');
    expect(result.stdout).not.toContain('Past Due');
  });

  it('builds calendar exports for reminders when requested', async () => {
    const reminders = [
      {
        job_id: 'job-1',
        remind_at: '2025-03-01T09:00:00Z',
      },
      {
        job_id: 'job-2',
        remind_at: '2025-02-01T09:00:00Z',
        past_due: true,
      },
    ];
    getApplicationReminders.mockResolvedValue(reminders);
    createReminderCalendar.mockReturnValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');

    const adapter = createCommandAdapter({ cli: {} });
    const result = await adapter['track-reminders']({
      format: 'ics',
      now: '2025-02-15T10:00:00Z',
      calendarName: 'Follow-ups',
    });

    expect(getApplicationReminders).toHaveBeenCalledWith({
      includePastDue: true,
      now: '2025-02-15T10:00:00.000Z',
    });
    expect(createReminderCalendar).toHaveBeenCalledTimes(1);
    const calendarArgs = createReminderCalendar.mock.calls[0];
    expect(calendarArgs?.[0]).toEqual([expect.objectContaining({ job_id: 'job-1' })]);
    expect(calendarArgs?.[1]).toMatchObject({
      calendarName: 'Follow-ups',
      now: '2025-02-15T10:00:00.000Z',
    });
    expect(result).toMatchObject({
      command: 'track-reminders',
      format: 'ics',
      stdout: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    });
    expect(result.data).toMatchObject({
      calendar: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      filename: 'jobbot-reminders.ics',
      calendarName: 'Follow-ups',
      sections: [
        expect.objectContaining({ heading: 'Past Due' }),
        expect.objectContaining({ heading: 'Upcoming' }),
      ],
    });
  });

  it('snoozes reminders through the command adapter', async () => {
    snoozeApplicationReminder.mockResolvedValue({
      job_id: 'job-9',
      remind_at: '2025-03-04T12:00:00.000Z',
      note: 'Follow up later',
    });

    const adapter = createCommandAdapter({ cli: {} });
    const result = await adapter['track-reminders-snooze']({
      jobId: 'job-9',
      until: '2025-03-04T12:00:00Z',
    });

    expect(snoozeApplicationReminder).toHaveBeenCalledWith('job-9', {
      until: '2025-03-04T12:00:00.000Z',
    });
    expect(result).toMatchObject({
      command: 'track-reminders-snooze',
      format: 'json',
      data: {
        jobId: 'job-9',
        remindAt: '2025-03-04T12:00:00.000Z',
      },
    });
    expect(result.stdout).toContain('Snoozed reminder for job-9');
  });

  it('marks reminders done through the command adapter', async () => {
    completeApplicationReminder.mockResolvedValue({
      reminder_completed_at: '2025-03-01T10:00:00.000Z',
    });

    const adapter = createCommandAdapter({ cli: {} });
    const result = await adapter['track-reminders-done']({
      jobId: 'job-11',
      completedAt: '2025-03-01T10:00:00Z',
    });

    expect(completeApplicationReminder).toHaveBeenCalledWith('job-11', {
      completedAt: '2025-03-01T10:00:00.000Z',
    });
    expect(result).toMatchObject({
      command: 'track-reminders-done',
      format: 'json',
      data: {
        jobId: 'job-11',
        reminderCompletedAt: '2025-03-01T10:00:00.000Z',
      },
    });
    expect(result.stdout).toContain('Marked reminder for job-11 as done');
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

  it('filters process environment variables before spawning the CLI', async () => {
    const spawnMock = childProcess.spawn;
    spawnMock.mockImplementation(() =>
      createSpawnedProcess({ stdout: '{"summary":"ok"}\n' }),
    );

    const previousSecret = process.env.SECRET_TOKEN;
    const previousNodeOptions = process.env.NODE_OPTIONS;
    const previousDataDir = process.env.JOBBOT_DATA_DIR;
    const previousProxy = process.env.HTTP_PROXY;

    process.env.SECRET_TOKEN = 'super-secret';
    process.env.NODE_OPTIONS = '--inspect';
    process.env.JOBBOT_DATA_DIR = '/tmp/jobbot-secure';
    process.env.HTTP_PROXY = 'http://127.0.0.1:8080';

    try {
      const adapter = createCommandAdapter({ enableNativeCli: true });
      const result = await adapter.summarize({ input: 'job.txt', format: 'json' });

      expect(result).toMatchObject({ command: 'summarize', format: 'json' });
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const spawnOptions = spawnMock.mock.calls[0][2];
      expect(spawnOptions.env).toHaveProperty('PATH');
      expect(spawnOptions.env.JOBBOT_DATA_DIR).toBe('/tmp/jobbot-secure');
      expect(spawnOptions.env.HTTP_PROXY).toBe('http://127.0.0.1:8080');
      expect(spawnOptions.env).not.toHaveProperty('SECRET_TOKEN');
      expect(spawnOptions.env).not.toHaveProperty('NODE_OPTIONS');
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SECRET_TOKEN;
      } else {
        process.env.SECRET_TOKEN = previousSecret;
      }
      if (previousNodeOptions === undefined) {
        delete process.env.NODE_OPTIONS;
      } else {
        process.env.NODE_OPTIONS = previousNodeOptions;
      }
      if (previousDataDir === undefined) {
        delete process.env.JOBBOT_DATA_DIR;
      } else {
        process.env.JOBBOT_DATA_DIR = previousDataDir;
      }
      if (previousProxy === undefined) {
        delete process.env.HTTP_PROXY;
      } else {
        process.env.HTTP_PROXY = previousProxy;
      }
    }
  });

  it('filters custom env overrides while allowing explicit passthrough keys', async () => {
    const spawnMock = childProcess.spawn;
    spawnMock.mockImplementation(() =>
      createSpawnedProcess({ stdout: '{"summary":"ok"}\n' }),
    );

    const adapter = createCommandAdapter({
      enableNativeCli: true,
      env: {
        JOBBOT_DATA_DIR: '/custom/data',
        CUSTOM_API_KEY: 'abc123',
        SECRET_TOKEN: 'should-not-pass',
        PATH: '/opt/jobbot/bin',
        MYAPP_TOKEN: 'prefix-allowed',
      },
      allowedEnvVars: ['CUSTOM_API_KEY'],
      allowedEnvPrefixes: ['MYAPP_'],
    });

    const result = await adapter.summarize({ input: 'job.txt', format: 'json' });
    expect(result).toMatchObject({ command: 'summarize', format: 'json' });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const spawnOptions = spawnMock.mock.calls[0][2];
    expect(spawnOptions.env).toMatchObject({
      JOBBOT_DATA_DIR: '/custom/data',
      CUSTOM_API_KEY: 'abc123',
      PATH: '/opt/jobbot/bin',
      MYAPP_TOKEN: 'prefix-allowed',
    });
    expect(spawnOptions.env).not.toHaveProperty('SECRET_TOKEN');
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

  it('ingests recruiter outreach emails and sanitizes the result', async () => {
    const repoInstance = { close: vi.fn() };
    const auditInstance = { close: vi.fn() };
    OpportunitiesRepo.mockImplementation(() => repoInstance);
    AuditLog.mockImplementation(() => auditInstance);

    ingestRecruiterEmail.mockImplementation(() => ({
      opportunity: {
        uid: 'abc123',
        company: 'Future Works',
        roleHint: 'Solutions Engineer',
        contactName: 'Casey Recruiter',
        contactEmail: 'casey@futureworks.example',
        lifecycleState: 'phone_screen_scheduled',
      },
      schedule: {
        display: 'Oct 23, 2:00 PM PT',
        iso: '2025-10-23T21:00:00.000Z',
        timezone: 'PT',
      },
      events: [
        {
          type: 'recruiter_outreach_received',
          payload: { snippet: 'api_key=supersecret' },
        },
      ],
      auditEntries: [],
    }));

    const adapter = createCommandAdapter();
    const rawEmail = 'Subject: Future Works opportunity\n\napi_key=supersecret';
    const result = await adapter['recruiter-ingest']({ raw: rawEmail });

    expect(ingestRecruiterEmail).toHaveBeenCalledTimes(1);
    expect(ingestRecruiterEmail).toHaveBeenCalledWith({
      raw: rawEmail,
      repo: repoInstance,
      audit: auditInstance,
    });
    expect(repoInstance.close).toHaveBeenCalledTimes(1);
    expect(auditInstance.close).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({
      command: 'recruiter-ingest',
      format: 'json',
      data: {
        opportunity: expect.objectContaining({
          company: 'Future Works',
          contactEmail: 'casey@futureworks.example',
        }),
        schedule: expect.objectContaining({ display: 'Oct 23, 2:00 PM PT' }),
      },
    });
    expect(result.data.events?.[0]?.payload?.snippet).toBe('api_key=***');
    expect(result.stdout).toContain('Future Works');
    expect(result.stdout).toContain('Oct 23, 2:00 PM PT');
  });

  it('lists intake responses with sanitized output', async () => {
    const cli = {
      cmdIntakeList: vi.fn(async args => {
        expect(args).toEqual(['--json']);
        console.log(
          JSON.stringify([
            {
              id: 'intake-001',
              question: 'What are your career goals?',
              answer: 'Build accessible tools',
              asked_at: '2025-03-01T10:00:00.000Z',
              recorded_at: '2025-03-01T10:05:00.000Z',
              status: 'answered',
              tags: ['career', 'growth'],
            },
            {
              id: 'intake-002',
              question: 'Salary expectations?',
              answer: '[redacted]',
              asked_at: '2025-03-01T10:10:00.000Z',
              recorded_at: '2025-03-01T10:15:00.000Z',
              status: 'answered',
              tags: ['compensation'],
              redacted: true,
            },
          ]),
        );
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['intake-list']({});

    expect(cli.cmdIntakeList).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'intake-list',
      format: 'json',
    });
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id: 'intake-001',
      question: 'What are your career goals?',
      answer: 'Build accessible tools',
      status: 'answered',
    });
    expect(result.data[1]).toMatchObject({
      id: 'intake-002',
      answer: '[redacted]',
      redacted: true,
    });
  });

  it('records intake responses with normalized metadata', async () => {
    const cli = {
      cmdIntakeRecord: vi.fn(async args => {
        expect(args).toEqual([
          '--question',
          'Why this role?',
          '--answer',
          'Mission alignment',
          '--tags',
          'motivation,values',
        ]);
        console.log(
          JSON.stringify({
            id: 'intake-003',
            question: 'Why this role?',
            answer: 'Mission alignment',
            asked_at: '2025-03-05T14:00:00.000Z',
            recorded_at: '2025-03-05T14:00:00.000Z',
            status: 'answered',
            tags: ['motivation', 'values'],
          }),
        );
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['intake-record']({
      question: 'Why this role?',
      answer: 'Mission alignment',
      tags: 'motivation,values',
    });

    expect(cli.cmdIntakeRecord).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      command: 'intake-record',
      format: 'json',
    });
    expect(result.data).toMatchObject({
      id: 'intake-003',
      question: 'Why this role?',
      answer: 'Mission alignment',
      status: 'answered',
      tags: ['motivation', 'values'],
    });
  });

  it('resumes intake drafts and sanitizes control characters', async () => {
    const cli = {
      cmdIntakeResume: vi.fn(async args => {
        expect(args).toEqual(['--json']);
        console.log(
          JSON.stringify({
            draft: {
              id: 'draft-123',
              question: 'Why this team?\u0007',
              answer: 'Because of the mission',
              notes: 'Inline\u0007 notes',
            },
          }),
        );
      }),
    };

    const adapter = createCommandAdapter({ cli });
    const result = await adapter['intake-resume']({});

    expect(result).toMatchObject({
      command: 'intake-resume',
      format: 'json',
    });
    expect(result.data).toEqual({
      draft: {
        id: 'draft-123',
        question: 'Why this team?',
        answer: 'Because of the mission',
        notes: 'Inline notes',
      },
    });
  });

  it('records beta feedback with sanitization', async () => {
    const cli = {
      cmdFeedbackRecord: vi.fn().mockResolvedValue({
        id: 'fb-123',
        message: 'Love the new status hub',
        source: 'beta-form',
        contact: 'casey@example.com',
        rating: 5,
        recorded_at: '2025-11-30T00:00:00.000Z',
      }),
    };
    const adapter = createCommandAdapter({ cli });

    const result = await adapter['feedback-record']({
      message: '  Love the new status hub ',
      source: 'beta-form',
      contact: ' casey@example.com ',
      rating: '5',
    });

    expect(cli.cmdFeedbackRecord).toHaveBeenCalledWith([
      '--message',
      'Love the new status hub',
      '--source',
      'beta-form',
      '--contact',
      'casey@example.com',
      '--rating',
      '5',
    ]);

    expect(result).toMatchObject({
      command: 'feedback-record',
      format: 'json',
      data: {
        id: 'fb-123',
        message: 'Love the new status hub',
        source: 'beta-form',
        contact: 'casey@example.com',
        rating: 5,
        recorded_at: '2025-11-30T00:00:00.000Z',
      },
    });
    expect(result.stdout).toContain('fb-123');
  });

  it('requires question when recording intake response', async () => {
    const cli = {
      cmdIntakeRecord: vi.fn(),
    };

    const adapter = createCommandAdapter({ cli });

    await expect(adapter['intake-record']({ answer: 'Some answer' })).rejects.toThrow(
      'question is required',
    );
    expect(cli.cmdIntakeRecord).not.toHaveBeenCalled();
  });
});
