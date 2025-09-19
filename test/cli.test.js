import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { summarize } from '../src/index.js';
import { STATUSES } from '../src/lifecycle.js';

const dataDir = path.resolve('test', 'tmp-cli-data');

function runCli(args, input, envOverrides = {}) {
  const bin = path.resolve('bin', 'jobbot.js');
  const defaultEnv = envOverrides.JOBBOT_DATA_DIR
    ? {}
    : { JOBBOT_DATA_DIR: dataDir };
  const opts = {
    encoding: 'utf8',
    env: { ...process.env, ...defaultEnv, ...envOverrides },
  };
  if (input !== undefined) opts.input = input;
  return execFileSync('node', [bin, ...args], opts);
}

describe('jobbot CLI', () => {
  beforeEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('summarize from stdin', () => {
    const out = runCli(['summarize', '-'], 'First sentence. Second.');
    expect(out).toMatch(/First sentence\./);
  });

  it('summarizes multiple sentences when count provided', () => {
    const out = runCli(
      ['summarize', '-', '--sentences', '2'],
      'First. Second. Third.'
    );
    expect(out.trim()).toBe('## Summary\n\nFirst. Second.');
  });

  it('defaults to one sentence when --sentences is invalid', () => {
    const out = runCli(
      ['summarize', '-', '--sentences', 'foo'],
      'First. Second.'
    );
    expect(out.trim()).toBe('## Summary\n\nFirst.');
  });

  it('outputs plain text summary with --text', () => {
    const input = 'Title: Engineer\nCompany: ACME\nFirst. Second.';
    const out = runCli(['summarize', '-', '--text'], input);
    expect(out.trim()).toBe(summarize(input));
    expect(out).not.toMatch(/#|\*\*/);
  });

  it('match from local files', () => {
    const job = 'Title: Engineer\nCompany: ACME\nRequirements\n- JavaScript\n- Node.js\n';
    const resume = 'I am an engineer with JavaScript experience.';
    const jobPath = path.resolve('test', 'fixtures', 'job.txt');
    const resumePath = path.resolve('test', 'fixtures', 'resume.txt');
    fs.mkdirSync(path.dirname(jobPath), { recursive: true });
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resume);
    const out = runCli(['match', '--resume', resumePath, '--job', jobPath, '--json']);
    const data = JSON.parse(out);
    expect(data.score).toBeGreaterThanOrEqual(50);
  });

  it('records application status with track add', () => {
    const status = STATUSES.find(s => s !== 'next_round');
    const output = runCli(['track', 'add', 'job-123', '--status', status]);
    expect(output.trim()).toBe(`Recorded job-123 as ${status}`);
    const raw = fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8');
    const payload = JSON.parse(raw);
    expect(payload['job-123']).toMatchObject({ status });
    expect(typeof payload['job-123'].updated_at).toBe('string');
  });

  it('records application metadata with track add options', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-track-'));
    try {
      const output = runCli(
        [
          'track',
          'add',
          'job-meta',
          '--status',
          'screening',
          '--channel',
          'referral',
          '--date',
          '2025-09-18',
          '--contact',
          'Alex',
          '--document',
          'resume.pdf',
          '--document',
          'cover-letter.pdf',
          '--notes',
          'Sent follow-up',
        ],
        undefined,
        { JOBBOT_DATA_DIR: dir },
      );
      expect(output.trim()).toBe('Recorded job-meta as screening');
      const raw = fs.readFileSync(path.join(dir, 'applications.json'), 'utf8');
      const payload = JSON.parse(raw);
      expect(payload['job-meta']).toMatchObject({
        status: 'screening',
        channel: 'referral',
        date: '2025-09-18',
        contact: 'Alex',
        documents: ['resume.pdf', 'cover-letter.pdf'],
        notes: 'Sent follow-up',
      });
      expect(typeof payload['job-meta'].updated_at).toBe('string');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});


