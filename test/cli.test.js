import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarize } from '../src/index.js';
import JSZip from 'jszip';
import { STATUSES } from '../src/lifecycle.js';

let dataDir;

function runCli(args, input) {
  const bin = path.resolve('bin', 'jobbot.js');
  if (!dataDir) throw new Error('CLI data directory was not initialised');
  const opts = {
    encoding: 'utf8',
    env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
  };
  if (input !== undefined) opts.input = input;
  return execFileSync('node', [bin, ...args], opts);
}

describe('jobbot CLI', () => {
  beforeEach(() => {
    // Allocate an isolated workspace for each test
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-cli-'));
  });

  afterEach(() => {
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it('initializes a resume skeleton with init command', () => {
    const output = runCli(['init']);
    expect(output.trim()).toMatch(/Initialized profile at/);

    const profileDir = path.join(dataDir, 'profile');
    const resumePath = path.join(profileDir, 'resume.json');
    const raw = fs.readFileSync(resumePath, 'utf8');
    const resume = JSON.parse(raw);

    expect(resume).toMatchObject({
      $schema:
        'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
      basics: {
        name: '',
        label: '',
        email: '',
        phone: '',
        website: '',
        summary: '',
        location: {
          city: '',
          region: '',
          country: '',
        },
      },
      work: [],
      education: [],
      projects: [],
      skills: [],
      certificates: [],
      languages: [],
    });

    expect(typeof resume.meta?.generatedAt).toBe('string');
    expect(resume.meta?.generator).toBe('jobbot3000');
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

  it('writes DOCX summaries when --docx is provided', async () => {
    const target = path.join(dataDir, 'summary.docx');
    const input = [
      'Title: Engineer',
      'Company: ACME',
      'Location: Remote',
      'First sentence. Second.',
    ].join('\n');
    const out = runCli(['summarize', '-', '--docx', target], input);
    expect(out).toContain('## Summary');
    const buffer = fs.readFileSync(target);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Engineer');
    expect(xml).toContain('Company');
    expect(xml).toContain('Summary');
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

  it('writes DOCX match reports without breaking JSON output', async () => {
    const job = 'Title: Engineer\nCompany: ACME\nRequirements\n- JavaScript\n- Node.js\n';
    const resume = 'I am an engineer with JavaScript experience.';
    const jobPath = path.resolve('test', 'fixtures', 'job-docx.txt');
    const resumePath = path.resolve('test', 'fixtures', 'resume-docx.txt');
    fs.mkdirSync(path.dirname(jobPath), { recursive: true });
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resume);
    const target = path.join(dataDir, 'match.docx');
    const out = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--json',
      '--docx',
      target,
    ]);
    const payload = JSON.parse(out);
    expect(payload.score).toBeGreaterThanOrEqual(50);
    const buffer = fs.readFileSync(target);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Engineer');
    expect(xml).toContain('Fit Score');
    expect(xml).toContain('Matched');
  });

  it('explains hits and gaps with match --explain', () => {
    const job = [
      'Title: Staff Engineer',
      'Company: ExampleCorp',
      'Requirements',
      '- Distributed systems experience',
      '- Certified Kubernetes administrator',
      '- Mentors senior engineers',
    ].join('\n');
    const resume = [
      'Led distributed systems design and migrations to cloud-native stacks.',
      'Managed mentoring programs for staff engineers.',
    ].join('\n');
    const jobPath = path.resolve('test', 'fixtures', 'job-explain.txt');
    const resumePath = path.resolve('test', 'fixtures', 'resume-explain.txt');
    fs.mkdirSync(path.dirname(jobPath), { recursive: true });
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resume);

    const out = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--explain',
    ]);

    expect(out).toContain('## Explanation');
    expect(out).toMatch(/Matched 2 of 3 requirements/);
    expect(out).toMatch(/Gaps: Certified Kubernetes administrator/);
  });

  it('records application status with track add', () => {
    const status = STATUSES[0]; // pick a valid status
    const output = runCli(['track', 'add', 'job-123', '--status', status]);
    expect(output.trim()).toBe(`Recorded job-123 as ${status}`);
    const raw = fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed['job-123'].status).toBe(status);
    expect(parsed['job-123'].note).toBeUndefined();
    expect(parsed['job-123'].updated_at).toEqual(
      new Date(parsed['job-123'].updated_at).toISOString()
    );
  });

  it('records application status notes with track add --note', () => {
    const output = runCli([
      'track',
      'add',
      'job-456',
      '--status',
      'screening',
      '--note',
      'Emailed hiring manager',
    ]);
    expect(output.trim()).toBe('Recorded job-456 as screening');
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8')
    );
    expect(raw['job-456']).toMatchObject({
      status: 'screening',
      note: 'Emailed hiring manager',
    });
    expect(raw['job-456'].updated_at).toEqual(
      new Date(raw['job-456'].updated_at).toISOString()
    );
  });

  it('logs application events with track log', () => {
    const output = runCli([
      'track',
      'log',
      'job-xyz',
      '--channel',
      'applied',
      '--date',
      '2025-03-04',
      '--contact',
      'Jordan Hiring Manager',
      '--documents',
      'resume.pdf,cover-letter.pdf',
      '--note',
      'Submitted via referral portal',
      '--remind-at',
      '2025-03-11T09:00:00Z',
    ]);
    expect(output.trim()).toBe('Logged job-xyz event applied');
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'application_events.json'), 'utf8')
    );
    expect(raw['job-xyz']).toEqual([
      {
        channel: 'applied',
        date: '2025-03-04T00:00:00.000Z',
        contact: 'Jordan Hiring Manager',
        documents: ['resume.pdf', 'cover-letter.pdf'],
        note: 'Submitted via referral portal',
        remind_at: '2025-03-11T09:00:00.000Z',
      },
    ]);
  });

  it('keeps shortlist discard history in sync when using track discard', () => {
    const output = runCli([
      'track',
      'discard',
      'job-track',
      '--reason',
      'Not a fit right now',
      '--tags',
      'Remote,onsite',
      '--date',
      '2025-04-05T12:00:00Z',
    ]);

    expect(output.trim()).toBe('Discarded job-track: Not a fit right now');

    const shortlistPath = path.join(dataDir, 'shortlist.json');
    const shortlist = JSON.parse(fs.readFileSync(shortlistPath, 'utf8'));
    expect(shortlist.jobs['job-track']).toBeDefined();
    expect(shortlist.jobs['job-track'].discarded).toEqual([
      {
        reason: 'Not a fit right now',
        discarded_at: '2025-04-05T12:00:00.000Z',
        tags: ['Remote', 'onsite'],
      },
    ]);

    const archivePath = path.join(dataDir, 'discarded_jobs.json');
    const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    expect(archive['job-track']).toEqual([
      {
        reason: 'Not a fit right now',
        discarded_at: '2025-04-05T12:00:00.000Z',
        tags: ['Remote', 'onsite'],
      },
    ]);
  });

  it('shows application history with track history --json', () => {
    runCli([
      'track',
      'log',
      'job-xyz',
      '--channel',
      'applied',
      '--date',
      '2025-03-04',
      '--contact',
      'Jordan Hiring Manager',
      '--documents',
      'resume.pdf,cover-letter.pdf',
      '--note',
      'Submitted via referral portal',
      '--remind-at',
      '2025-03-11T09:00:00Z',
    ]);

    runCli([
      'track',
      'log',
      'job-xyz',
      '--channel',
      'follow_up',
      '--date',
      '2025-03-12T09:15:00Z',
      '--note',
      'Sent thank-you follow-up',
    ]);

    const textHistory = runCli(['track', 'history', 'job-xyz']);
    expect(textHistory).toContain('job-xyz');
    expect(textHistory).toContain('- applied (2025-03-04T00:00:00.000Z)');
    expect(textHistory).toContain('Contact: Jordan Hiring Manager');
    expect(textHistory).toContain('Documents: resume.pdf, cover-letter.pdf');
    expect(textHistory).toContain('Note: Submitted via referral portal');
    expect(textHistory).toContain('Reminder: 2025-03-11T09:00:00.000Z');
    expect(textHistory).toContain('- follow_up (2025-03-12T09:15:00.000Z)');
    expect(textHistory).toContain('Note: Sent thank-you follow-up');

    const jsonHistory = runCli(['track', 'history', 'job-xyz', '--json']);
    const parsed = JSON.parse(jsonHistory);
    expect(parsed.job_id).toBe('job-xyz');
    expect(parsed.events).toEqual([
      {
        channel: 'applied',
        date: '2025-03-04T00:00:00.000Z',
        contact: 'Jordan Hiring Manager',
        documents: ['resume.pdf', 'cover-letter.pdf'],
        note: 'Submitted via referral portal',
        remind_at: '2025-03-11T09:00:00.000Z',
      },
      {
        channel: 'follow_up',
        date: '2025-03-12T09:15:00.000Z',
        note: 'Sent thank-you follow-up',
      },
    ]);
  });

  it('notifies when application history is empty', () => {
    const output = runCli(['track', 'history', 'job-missing']);
    expect(output.trim()).toBe('No history for job-missing');
  });

  it('lists reminders with track reminders --json', () => {
    runCli([
      'track',
      'log',
      'job-1',
      '--channel',
      'follow_up',
      '--date',
      '2025-03-01T08:00:00Z',
      '--note',
      'Send status update',
      '--remind-at',
      '2025-03-05T09:00:00Z',
    ]);
    runCli([
      'track',
      'log',
      'job-2',
      '--channel',
      'call',
      '--date',
      '2025-03-02T10:00:00Z',
      '--contact',
      'Avery Hiring Manager',
      '--remind-at',
      '2025-03-07T15:00:00Z',
    ]);

    const output = runCli([
      'track',
      'reminders',
      '--json',
      '--now',
      '2025-03-06T00:00:00Z',
    ]);

    const payload = JSON.parse(output);
    expect(payload).toEqual({
      reminders: [
        {
          job_id: 'job-1',
          remind_at: '2025-03-05T09:00:00.000Z',
          channel: 'follow_up',
          note: 'Send status update',
          past_due: true,
        },
        {
          job_id: 'job-2',
          remind_at: '2025-03-07T15:00:00.000Z',
          channel: 'call',
          contact: 'Avery Hiring Manager',
          past_due: false,
        },
      ],
    });
  });

  it('formats reminder summaries and respects --upcoming-only', () => {
    runCli([
      'track',
      'log',
      'job-1',
      '--channel',
      'follow_up',
      '--date',
      '2025-03-01T08:00:00Z',
      '--note',
      'Send status update',
      '--remind-at',
      '2025-03-05T09:00:00Z',
    ]);
    runCli([
      'track',
      'log',
      'job-2',
      '--channel',
      'call',
      '--date',
      '2025-03-02T10:00:00Z',
      '--contact',
      'Avery Hiring Manager',
      '--remind-at',
      '2025-03-07T15:00:00Z',
    ]);

    const fullOutput = runCli([
      'track',
      'reminders',
      '--now',
      '2025-03-06T00:00:00Z',
    ]);

    expect(fullOutput).toContain(
      'job-1 — 2025-03-05T09:00:00.000Z (follow_up, past due)'
    );
    expect(fullOutput).toContain('  Note: Send status update');
    expect(fullOutput).toContain(
      'job-2 — 2025-03-07T15:00:00.000Z (call, upcoming)'
    );
    expect(fullOutput).toContain('  Contact: Avery Hiring Manager');

    const upcomingOnly = runCli([
      'track',
      'reminders',
      '--now',
      '2025-03-06T00:00:00Z',
      '--upcoming-only',
    ]);

    expect(upcomingOnly).not.toContain('job-1');
    expect(upcomingOnly).toContain(
      'job-2 — 2025-03-07T15:00:00.000Z (call, upcoming)'
    );
  });

  it('archives discarded jobs with reasons', () => {
    const output = runCli([
      'track',
      'discard',
      'job-789',
      '--reason',
      'Below compensation range',
    ]);
    expect(output.trim()).toBe('Discarded job-789: Below compensation range');
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'discarded_jobs.json'), 'utf8')
    );
    expect(raw['job-789']).toHaveLength(1);
    const entry = raw['job-789'][0];
    expect(entry.reason).toBe('Below compensation range');
    expect(entry.discarded_at).toEqual(new Date(entry.discarded_at).toISOString());
  });

  it('updates shortlist history when discarding via track command', () => {
    runCli([
      'track',
      'discard',
      'job-shortlist-sync',
      '--reason',
      'Not aligned with goals',
      '--tags',
      'remote,onsite',
    ]);

    const shortlistPath = path.join(dataDir, 'shortlist.json');
    expect(fs.existsSync(shortlistPath)).toBe(true);
    const shortlist = JSON.parse(fs.readFileSync(shortlistPath, 'utf8'));
    expect(shortlist.jobs['job-shortlist-sync']).toBeDefined();
    const [entry] = shortlist.jobs['job-shortlist-sync'].discarded;
    expect(entry).toMatchObject({
      reason: 'Not aligned with goals',
      tags: ['remote', 'onsite'],
    });
    expect(typeof entry.discarded_at).toBe('string');
  });

  it('surfaces discard archive snapshots with shortlist archive', () => {
    runCli([
      'shortlist',
      'discard',
      'job-1',
      '--reason',
      'Not remote',
      '--tags',
      'remote,onsite',
      '--date',
      '2025-03-05T12:00:00Z',
    ]);
    runCli([
      'shortlist',
      'discard',
      'job-1',
      '--reason',
      'Changed priorities',
      '--date',
      '2025-03-08T09:30:00Z',
    ]);
    runCli([
      'shortlist',
      'discard',
      'job-2',
      '--reason',
      'Compensation mismatch',
      '--tags',
      'compensation',
      '--date',
      '2025-04-01T14:45:00Z',
    ]);

    const archiveText = runCli(['shortlist', 'archive']);
    expect(archiveText).toContain('job-1');
    expect(archiveText).toContain('2025-03-05T12:00:00.000Z — Not remote');
    expect(archiveText).toContain('Tags: remote, onsite');
    expect(archiveText).toContain('job-2');
    expect(archiveText).toContain('2025-04-01T14:45:00.000Z — Compensation mismatch');

    const singleJob = runCli(['shortlist', 'archive', 'job-1']);
    expect(singleJob).toContain('job-1');
    expect(singleJob).toContain('2025-03-08T09:30:00.000Z — Changed priorities');
    expect(singleJob).not.toContain('job-2');

    const asJson = JSON.parse(runCli(['shortlist', 'archive', '--json']));
    expect(Object.keys(asJson.discarded)).toContain('job-1');
    expect(asJson.discarded['job-1']).toHaveLength(2);
    expect(asJson.discarded['job-2'][0]).toMatchObject({
      reason: 'Compensation mismatch',
      discarded_at: '2025-04-01T14:45:00.000Z',
      tags: ['compensation'],
    });

    const jobJson = JSON.parse(runCli(['shortlist', 'archive', 'job-2', '--json']));
    expect(jobJson).toEqual({
      job_id: 'job-2',
      history: [
        {
          reason: 'Compensation mismatch',
          discarded_at: '2025-04-01T14:45:00.000Z',
          tags: ['compensation'],
        },
      ],
    });
  });

  it('reports when discard archive is empty', () => {
    const emptyAll = runCli(['shortlist', 'archive']);
    expect(emptyAll.trim()).toBe('No discarded jobs found');

    const emptyJob = runCli(['shortlist', 'archive', 'job-missing']);
    expect(emptyJob.trim()).toBe('No discard history for job-missing');
  });

  it('records intake responses and lists them', () => {
    const output = runCli([
      'intake',
      'record',
      '--question',
      'What motivates you?',
      '--answer',
      'Building accessible tools',
      '--tags',
      'growth,mission',
      '--notes',
      'Prefers collaborative teams',
      '--asked-at',
      '2025-02-01T12:34:56Z',
    ]);
    expect(output.trim()).toMatch(/^Recorded intake response /);

    const list = runCli(['intake', 'list']);
    expect(list).toContain('What motivates you?');
    expect(list).toContain('Answer: Building accessible tools');
    expect(list).toContain('Tags: growth, mission');

    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'profile', 'intake.json'), 'utf8')
    );
    expect(raw.responses).toHaveLength(1);
    expect(raw.responses[0]).toMatchObject({
      question: 'What motivates you?',
      answer: 'Building accessible tools',
      tags: ['growth', 'mission'],
      notes: 'Prefers collaborative teams',
      asked_at: '2025-02-01T12:34:56.000Z',
    });
  });

  it('tags shortlist entries and persists labels', () => {
    const output = runCli(['shortlist', 'tag', 'job-abc', 'dream', 'remote']);
    expect(output.trim()).toBe('Tagged job-abc with dream, remote');
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(raw.jobs['job-abc'].tags).toEqual(['dream', 'remote']);
  });

  it('archives discard reasons for shortlist entries', () => {
    runCli(['shortlist', 'tag', 'job-def', 'onsite']);
    const output = runCli([
      'shortlist',
      'discard',
      'job-def',
      '--reason',
      'Not remote friendly',
    ]);
    expect(output.trim()).toBe('Discarded job-def: Not remote friendly');
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(raw.jobs['job-def'].discarded).toHaveLength(1);
    const [entry] = raw.jobs['job-def'].discarded;
    expect(entry.reason).toBe('Not remote friendly');
    expect(entry.discarded_at).toMatch(/T.*Z$/);
  });

  it('captures optional tags when discarding shortlist entries', () => {
    runCli([
      'shortlist',
      'discard',
      'job-tags',
      '--reason',
      'Location mismatch',
      '--tags',
      'Remote,onsite,remote',
    ]);

    const shortlist = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    const [entry] = shortlist.jobs['job-tags'].discarded;
    expect(entry.tags).toEqual(['Remote', 'onsite']);

    const archive = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'discarded_jobs.json'), 'utf8')
    );
    expect(archive['job-tags'][0].tags).toEqual(['Remote', 'onsite']);
  });

  it('syncs shortlist metadata and filters entries by location', () => {
    const syncOutput = runCli([
      'shortlist',
      'sync',
      'job-sync',
      '--location',
      'Remote',
      '--level',
      'Senior',
      '--compensation',
      '$200k',
      '--synced-at',
      '2025-04-05T06:07:08Z',
    ]);
    expect(syncOutput.trim()).toBe('Synced job-sync metadata');

    const store = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(store.jobs['job-sync'].metadata).toMatchObject({
      location: 'Remote',
      level: 'Senior',
      compensation: '$200k',
      synced_at: '2025-04-05T06:07:08.000Z',
    });

    const listOutput = runCli(['shortlist', 'list', '--location', 'remote']);
    expect(listOutput).toContain('job-sync');
    expect(listOutput).toContain('Remote');
  });

  it('lists shortlist entries as JSON with --json', () => {
    runCli([
      'shortlist',
      'sync',
      'job-json',
      '--location',
      'Remote',
      '--level',
      'Senior',
      '--compensation',
      '$200k',
      '--synced-at',
      '2025-06-01T10:00:00Z',
    ]);
    runCli(['shortlist', 'tag', 'job-json', 'Remote']);
    runCli([
      'shortlist',
      'discard',
      'job-json',
      '--reason',
      'Paused search',
      '--tags',
      'Paused,paused',
      '--date',
      '2025-06-02T09:30:00Z',
    ]);

    const output = runCli(['shortlist', 'list', '--json']);
    const payload = JSON.parse(output);

    expect(payload).toEqual({
      jobs: {
        'job-json': {
          tags: ['Remote'],
          metadata: {
            location: 'Remote',
            level: 'Senior',
            compensation: '$200k',
            synced_at: '2025-06-01T10:00:00.000Z',
          },
          discarded: [
            {
              reason: 'Paused search',
              discarded_at: '2025-06-02T09:30:00.000Z',
              tags: ['Paused'],
            },
          ],
        },
      },
    });
  });

  it('restores currency symbols when sync invoked via shell quoting', () => {
    const bin = path.resolve('bin', 'jobbot.js');
    const command = [
      `${process.execPath} ${bin} shortlist sync job-shell`,
      '--location Remote',
      '--level Senior',
      '--compensation "$185k"',
    ].join(' ');
    execFileSync('bash', ['-lc', command], {
      encoding: 'utf8',
      env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
    });

    const shortlist = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(shortlist.jobs['job-shell'].metadata.compensation).toBe('$85k');
  });

  it('uses JOBBOT_SHORTLIST_CURRENCY when restoring compensation', () => {
    const bin = path.resolve('bin', 'jobbot.js');
    const command = [
      `${process.execPath} ${bin} shortlist sync job-euro`,
      '--location Remote',
      '--level Mid',
      '--compensation "120k"',
    ].join(' ');
    execFileSync('bash', ['-lc', command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        JOBBOT_DATA_DIR: dataDir,
        JOBBOT_SHORTLIST_CURRENCY: '€',
      },
    });

    const shortlist = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(shortlist.jobs['job-euro'].metadata).toMatchObject({
      compensation: '€120k',
      level: 'Mid',
      location: 'Remote',
    });
  });

  it('summarizes conversion funnel analytics', () => {
    runCli(['track', 'log', 'job-1', '--channel', 'email', '--date', '2025-01-02']);
    runCli(['track', 'add', 'job-1', '--status', 'screening']);

    runCli(['track', 'log', 'job-2', '--channel', 'referral', '--date', '2025-01-03']);
    runCli(['track', 'add', 'job-2', '--status', 'onsite']);

    runCli(['track', 'log', 'job-3', '--channel', 'email', '--date', '2025-01-04']);
    runCli(['track', 'add', 'job-3', '--status', 'offer']);
    runCli(['track', 'log', 'job-3', '--channel', 'offer_accepted', '--date', '2025-02-01']);

    runCli(['track', 'log', 'job-4', '--channel', 'email', '--date', '2025-01-05']);
    runCli(['track', 'add', 'job-4', '--status', 'rejected']);

    runCli(['track', 'add', 'job-5', '--status', 'withdrawn']);

    const textReport = runCli(['analytics', 'funnel']);
    expect(textReport).toContain('Outreach: 4');
    expect(textReport).toContain('Screening: 1 (25% conversion, 3 drop-off)');
    expect(textReport).toContain('Largest drop-off: Outreach → Screening (3 lost)');

    const jsonReport = runCli(['analytics', 'funnel', '--json']);
    const parsed = JSON.parse(jsonReport);
    expect(parsed.totals).toEqual({ trackedJobs: 5, withEvents: 4 });
    const stagesByKey = Object.fromEntries(parsed.stages.map(stage => [stage.key, stage]));
    expect(stagesByKey.outreach.count).toBe(4);
    expect(stagesByKey.screening.count).toBe(1);
    expect(stagesByKey.acceptance.count).toBe(1);
  }, 15000);

  it('exports anonymized analytics snapshots to disk', () => {
    runCli(['track', 'log', 'job-1', '--channel', 'email', '--date', '2025-03-01']);
    runCli(['track', 'add', 'job-1', '--status', 'screening']);
    runCli(['track', 'log', 'job-2', '--channel', 'referral', '--date', '2025-03-02']);
    runCli(['track', 'add', 'job-2', '--status', 'offer']);
    runCli(['track', 'log', 'job-2', '--channel', 'offer_accepted', '--date', '2025-03-15']);

    const outPath = path.join(dataDir, 'analytics-snapshot.json');
    const result = runCli(['analytics', 'export', '--out', outPath]);
    expect(result.trim()).toBe(`Saved analytics snapshot to ${outPath}`);

    const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    expect(payload.statuses).toMatchObject({ offer: 1, screening: 1 });
    expect(payload.channels).toEqual({ email: 1, offer_accepted: 1, referral: 1 });
    expect(JSON.stringify(payload)).not.toContain('job-1');
    expect(JSON.stringify(payload)).not.toContain('job-2');
  });

  it('records interview sessions with transcripts and notes', () => {
    const transcriptPath = path.join(dataDir, 'transcript.txt');
    fs.writeFileSync(transcriptPath, 'Practiced STAR story\n');

    const reflectionsPath = path.join(dataDir, 'reflections.txt');
    fs.writeFileSync(reflectionsPath, 'Highlight quant impact\nTighter close');

    const output = runCli([
      'interviews',
      'record',
      'job-123',
      'session-1',
      '--transcript-file',
      transcriptPath,
      '--reflections-file',
      reflectionsPath,
      '--feedback',
      'Coach praised clarity',
      '--notes',
      'Follow up with salary research',
      '--stage',
      'Onsite',
      '--mode',
      'Voice',
      '--started-at',
      '2025-02-01T09:00:00Z',
      '--ended-at',
      '2025-02-01T10:30:00Z',
    ]);

    expect(output.trim()).toBe('Recorded session session-1 for job-123');

    const file = path.join(dataDir, 'interviews', 'job-123', 'session-1.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

    expect(stored.transcript).toBe('Practiced STAR story');
    expect(stored.reflections).toEqual(['Highlight quant impact', 'Tighter close']);
    expect(stored.feedback).toEqual(['Coach praised clarity']);
    expect(stored.notes).toBe('Follow up with salary research');
    expect(stored.stage).toBe('Onsite');
    expect(stored.mode).toBe('Voice');
    expect(stored.started_at).toBe('2025-02-01T09:00:00.000Z');
    expect(stored.ended_at).toBe('2025-02-01T10:30:00.000Z');

    const shown = runCli(['interviews', 'show', 'job-123', 'session-1']);
    const parsed = JSON.parse(shown);
    expect(parsed).toEqual(stored);
  });
});
