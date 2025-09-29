import { describe, expect, it } from 'vitest';

import {
  createCliInvocation,
  listAllowedCommands,
} from '../src/services/command-allowlist.js';

describe('command allowlist', () => {
  it('lists allowed commands', () => {
    const commands = listAllowedCommands();
    expect(commands).toContain('shortlist.list');
    expect(commands).toContain('track.reminders');
  });

  it('builds a shortlist list invocation with filters and JSON output', () => {
    const invocation = createCliInvocation({
      command: ['shortlist', 'list'],
      filters: { location: 'Remote', tags: ['remote', 'dream'] },
      json: true,
    });

    expect(invocation).toEqual({
      command: 'shortlist',
      args: ['list', '--location', 'Remote', '--tag', 'remote', '--tag', 'dream', '--json'],
    });
  });

  it('rejects commands not present in the allowlist', () => {
    expect(() =>
      createCliInvocation({
        command: ['shortlist', 'remove'],
      }),
    ).toThrow(/unsupported command/i);
  });

  it('requires shortlist sync requests to include a job id', () => {
    expect(() => createCliInvocation({ command: ['shortlist', 'sync'] })).toThrow(/job id/i);
  });

  it('requires --json when an output path is supplied for shortlist list', () => {
    expect(() =>
      createCliInvocation({
        command: ['shortlist', 'list'],
        out: 'snapshot.json',
      }),
    ).toThrow(/--json/);
  });

  it('validates date-like fields and converts them to ISO timestamps', () => {
    const invocation = createCliInvocation({
      command: ['shortlist', 'discard'],
      jobId: 'job-123',
      reason: 'No longer relevant',
      date: '2025-02-03T04:05:06Z',
      tags: ['Remote', 'focus'],
    });

    expect(invocation).toEqual({
      command: 'shortlist',
      args: [
        'discard',
        'job-123',
        '--reason',
        'No longer relevant',
        '--date',
        '2025-02-03T04:05:06.000Z',
        '--tags',
        'Remote,focus',
      ],
    });
  });

  it('builds track reminders invocations with optional filters', () => {
    const invocation = createCliInvocation({
      command: ['track', 'reminders'],
      json: true,
      upcomingOnly: true,
      now: '2025-03-07T12:00:00Z',
    });

    expect(invocation).toEqual({
      command: 'track',
      args: [
        'reminders',
        '--json',
        '--upcoming-only',
        '--now',
        '2025-03-07T12:00:00.000Z',
      ],
    });
  });
});
