import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from '../src/index.js';
import JSZip from 'jszip';
import { STATUSES } from '../src/lifecycle.js';
import { jobIdFromSource } from '../src/jobs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  it('initializes a resume skeleton with profile init command', () => {
    const output = runCli(['profile', 'init']);
    expect(output.trim()).toMatch(/Initialized profile at/);

    const profileDir = path.join(dataDir, 'profile');
    const resumePath = path.join(profileDir, 'resume.json');
    const raw = fs.readFileSync(resumePath, 'utf8');
    const resume = JSON.parse(raw);

    expect(resume.basics).toBeDefined();
    expect(Array.isArray(resume.work)).toBe(true);
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

  it('localizes summaries when --locale is provided', async () => {
    const target = path.join(dataDir, 'resumen.docx');
    const input = [
      'Title: Ingeniero',
      'Company: Ejemplo SA',
      'Location: Remoto',
      'Summary',
      'Construir herramientas colaborativas.',
      'Requirements',
      '- Node.js',
    ].join('\n');

    const out = runCli(['summarize', '-', '--locale', 'es', '--docx', target], input);
    expect(out).toContain('**Empresa**: Ejemplo SA');
    expect(out).toContain('## Resumen');
    const buffer = fs.readFileSync(target);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Empresa');
    expect(xml).toContain('Resumen');
    expect(xml).toContain('Requisitos');
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

  it('localizes summaries when --locale is provided', () => {
    const input = [
      'Title: Ingeniero',
      'Company: ACME',
      'Location: Remoto',
      'Summary',
      'Breve descripción.',
      'Requirements',
      '- Diseñar sistemas',
    ].join('\n');
    const out = runCli(['summarize', '-', '--locale', 'es'], input);
    expect(out).toContain('**Empresa**: ACME');
    expect(out).toContain('## Resumen');
    expect(out).toContain('## Requisitos');
  });

  it('imports LinkedIn profile exports with import linkedin', () => {
    const fixture = path.resolve('test', 'fixtures', 'linkedin-profile.json');
    const out = runCli(['import', 'linkedin', fixture]);
    expect(out).toMatch(/Imported LinkedIn profile to/);
    expect(out).toMatch(/work \+1/);

    const resumePath = path.join(dataDir, 'profile', 'resume.json');
    const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8'));

    expect(resume.basics.name).toBe('Casey Taylor');
    expect(resume.work).toHaveLength(1);
    expect(resume.skills.map(skill => skill.name)).toEqual([
      'Kubernetes',
      'AWS',
      'Incident Response',
    ]);
  });

  it('imports LinkedIn profile exports with profile import', () => {
    const fixture = path.resolve('test', 'fixtures', 'linkedin-profile.json');
    const out = runCli(['profile', 'import', 'linkedin', fixture]);
    expect(out).toMatch(/Imported LinkedIn profile to/);

    const resumePath = path.join(dataDir, 'profile', 'resume.json');
    const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8'));

    expect(resume.basics.name).toBe('Casey Taylor');
    expect(resume.work).toHaveLength(1);
    expect(resume.work[0]).toMatchObject({ name: 'ExampleCorp', position: 'Staff SRE' });
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

  it('overrides title and location when flags are provided to match', () => {
    const jobPath = path.join(dataDir, 'job-override.txt');
    const resumePath = path.join(dataDir, 'resume-override.txt');
    fs.writeFileSync(jobPath, 'Requirements\n- Node.js\n');
    fs.writeFileSync(resumePath, 'Experienced Node.js engineer.');

    const out = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--json',
      '--role',
      'Senior SRE',
      '--location',
      'SF Bay Area',
    ]);

    const payload = JSON.parse(out);
    expect(payload.title).toBe('Senior SRE');
    expect(payload.location).toBe('SF Bay Area');
  });

  it('localizes match reports when --locale is provided', () => {
    const job = [
      'Title: Staff Engineer',
      'Company: Globex',
      'Requirements',
      '- JavaScript',
      '- Go',
    ].join('\n');
    const resume = 'Experienced Staff Engineer with deep JavaScript expertise.';
    const jobPath = path.join(dataDir, 'job-locale.txt');
    const resumePath = path.join(dataDir, 'resume-locale.txt');
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resume);
    const out = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--locale',
      'fr',
      '--explain',
    ]);
    expect(out).toContain('**Entreprise**: Globex');
    expect(out).toContain('## Correspondances');
    expect(out).toContain('## Explication');
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

  it('writes cover letters when --cover-letter is provided', () => {
    runCli(['init']);
    const profileDir = path.join(dataDir, 'profile');
    const resumeProfilePath = path.join(profileDir, 'resume.json');
    const profile = JSON.parse(fs.readFileSync(resumeProfilePath, 'utf8'));
    profile.basics.name = 'Ada Lovelace';
    profile.basics.email = 'ada@example.com';
    profile.basics.phone = '+44 20 7946 0958';
    profile.basics.summary =
      'Platform engineer who blends Node.js expertise with collaborative delivery.';
    profile.basics.location = { city: 'London', region: 'UK' };
    profile.work = [
      {
        company: 'Analytical Engines',
        position: 'Lead Engineer',
        highlights: [
          'Scaled Node.js services to support 10x traffic without downtime.',
          'Automated Terraform deployments that cut release cycles in half.',
        ],
      },
    ];
    fs.writeFileSync(resumeProfilePath, `${JSON.stringify(profile, null, 2)}\n`);

    const job = [
      'Title: Platform Engineer',
      'Company: ACME',
      'Requirements',
      '- Node.js',
      '- Terraform',
      '- Mentorship',
    ].join('\n');
    const resumeText = 'Experienced Node.js engineer and mentor focused on Terraform automation.';
    const jobPath = path.join(dataDir, 'job-cover.txt');
    const resumePath = path.join(dataDir, 'resume-cover.txt');
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resumeText);

    const letterPath = path.join(dataDir, 'cover-letter.md');
    const output = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--cover-letter',
      letterPath,
    ]);

    expect(output).toContain('## Matched');
    const letter = fs.readFileSync(letterPath, 'utf8');
    expect(letter).toContain('Ada Lovelace');
    expect(letter).toContain('Hiring Team at ACME');
    expect(letter).toContain('Platform Engineer role at ACME');
    expect(letter).toMatch(/Node\.js, Terraform, and Mentorship matches outcomes/);
    expect(letter).toMatch(/Scaled Node.js services/);
    expect(letter).toMatch(/Sincerely,\nAda Lovelace$/);
  });

  it('localizes match output when --locale is provided', () => {
    const job = [
      'Title: Desarrollador',
      'Company: Ejemplo SA',
      'Requirements',
      '- Node.js',
      '- Trabajo en equipo',
    ].join('\n');
    const resume = 'Experiencia con Node.js y trabajo colaborativo.';
    const jobPath = path.join(dataDir, 'job-locale.txt');
    const resumePath = path.join(dataDir, 'resume-locale.txt');
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resume);

    const out = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--explain',
      '--locale',
      'es',
    ]);

    expect(out).toContain('**Empresa**: Ejemplo SA');
    expect(out).toContain('## Coincidencias');
    expect(out).toContain('## Explicación');
    expect(out).toMatch(/Puntaje de Ajuste/);
  });

  it('surfaces must-have blockers in match --json output', () => {
    const job = [
      'Title: Staff Engineer',
      'Company: ExampleCorp',
      'Requirements',
      '- Must have Kubernetes expertise',
      '- Security clearance required',
      '- Developer experience focus',
      '- Strong communication skills',
    ].join('\n');
    const resume = [
      'Seasoned backend engineer focused on mentoring and developer experience.',
    ].join('\n');
    const jobPath = path.join(dataDir, 'job-blockers.txt');
    const resumePath = path.join(dataDir, 'resume-blockers.txt');
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resume);

    const out = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--json',
    ]);

    const payload = JSON.parse(out);
    expect(payload.must_haves_missed).toEqual([
      'Must have Kubernetes expertise',
      'Security clearance required',
    ]);
    expect(payload.skills_hit).toEqual(['Developer experience focus']);
    expect(payload.skills_gap).toEqual([
      'Must have Kubernetes expertise',
      'Security clearance required',
      'Strong communication skills',
    ]);
    expect(payload.keyword_overlap).toEqual(['developer', 'experience']);
  });

  it('includes prior activity summaries in match output', () => {
    const job = [
      'Title: Staff Engineer',
      'Company: ExampleCorp',
      'Requirements',
      '- Distributed systems experience',
    ].join('\n');
    const resume = 'Built distributed systems and led engineering teams.';
    const jobPath = path.join(dataDir, 'job-activity.txt');
    const resumePath = path.join(dataDir, 'resume-activity.txt');
    fs.writeFileSync(jobPath, job);
    fs.writeFileSync(resumePath, resume);

    const jobId = jobIdFromSource(`file:${path.resolve(jobPath)}`);
    const deliverableDir = path.join(dataDir, 'deliverables', jobId, '2025-02-01T10-00-00Z');
    fs.mkdirSync(deliverableDir, { recursive: true });
    const deliverableFile = path.join(deliverableDir, 'resume.pdf');
    fs.writeFileSync(deliverableFile, 'resume');
    const deliverableTimestamp = new Date('2025-02-01T10:00:00.000Z');
    fs.utimesSync(deliverableFile, deliverableTimestamp, deliverableTimestamp);
    fs.utimesSync(deliverableDir, deliverableTimestamp, deliverableTimestamp);

    const interviewDir = path.join(dataDir, 'interviews', jobId);
    fs.mkdirSync(interviewDir, { recursive: true });
    const sessionPath = path.join(interviewDir, 'session.json');
    fs.writeFileSync(
      sessionPath,
      JSON.stringify(
        {
          session_id: 'session-1',
          recorded_at: '2025-02-02T11:00:00.000Z',
          stage: 'Behavioral',
          mode: 'Voice',
          heuristics: { critique: { tighten_this: ['Tighten this: trim filler words.'] } },
        },
        null,
        2,
      ),
    );

    const jsonOut = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--json',
    ]);
    const payload = JSON.parse(jsonOut);
    expect(payload.prior_activity?.deliverables?.runs).toBe(1);
    expect(payload.prior_activity?.interviews?.sessions).toBe(1);
    expect(payload.prior_activity?.interviews?.last_session?.critique?.tighten_this).toEqual([
      'Tighten this: trim filler words.',
    ]);
    expect(payload.prior_activity?.interviews?.last_session?.recorded_at_source).toBe(
      'recorded_at',
    );
    expect(
      payload.prior_activity?.interviews?.sessions_after_last_deliverable,
    ).toBe(1);

    const mdOut = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
    ]);
    expect(mdOut).toContain('## Prior Activity');
    expect(mdOut).toContain('Deliverables: 1 run');
    expect(mdOut).toContain('Interviews: 1 session');
    expect(mdOut).toContain('Sessions since last deliverable: 1');
    expect(mdOut).toContain('Timestamp source: recorded_at');

    const localizedOut = runCli([
      'match',
      '--resume',
      resumePath,
      '--job',
      jobPath,
      '--locale',
      'es',
    ]);
    expect(localizedOut).toContain('## Actividad previa');
    expect(localizedOut).toContain('Entregables: 1 ejecución');
    expect(localizedOut).toContain('Entrevistas: 1 sesión');
    expect(localizedOut).toContain('  Notas de coaching:');
    expect(localizedOut).toContain('Sesiones desde la última entrega: 1');
    expect(localizedOut).toContain('Fuente de la marca de tiempo: recorded_at');
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
      sections: [
        {
          heading: 'Past Due',
          reminders: [
            {
              job_id: 'job-1',
              remind_at: '2025-03-05T09:00:00.000Z',
              channel: 'follow_up',
              note: 'Send status update',
              past_due: true,
            },
          ],
        },
        {
          heading: 'Upcoming',
          reminders: [
            {
              job_id: 'job-2',
              remind_at: '2025-03-07T15:00:00.000Z',
              channel: 'call',
              contact: 'Avery Hiring Manager',
              past_due: false,
            },
          ],
        },
      ],
    });
  });

  it('exports upcoming reminders to an ICS calendar with --ics', () => {
    runCli([
      'track',
      'log',
      'job-past-due',
      '--channel',
      'follow_up',
      '--date',
      '2025-03-01T08:00:00Z',
      '--note',
      'Past reminder',
      '--remind-at',
      '2025-03-02T09:00:00Z',
    ]);
    runCli([
      'track',
      'log',
      'job-upcoming',
      '--channel',
      'call',
      '--date',
      '2025-03-05T10:00:00Z',
      '--contact',
      'Jordan Recruiter',
      '--note',
      'Schedule check-in',
      '--remind-at',
      '2025-03-10T15:30:00Z',
    ]);

    const calendarPath = path.join(dataDir, 'reminders.ics');
    const output = runCli([
      'track',
      'reminders',
      '--ics',
      calendarPath,
      '--now',
      '2025-03-06T00:00:00Z',
    ]);

    expect(output.trim()).toBe(`Saved reminder calendar to ${calendarPath}`);

    const ics = fs.readFileSync(calendarPath, 'utf8');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:job-upcoming — call');
    expect(ics).toContain('DTSTART:20250310T153000Z');
    expect(ics).toContain('CONTACT:Jordan Recruiter');
    const description = (() => {
      const lines = ics.split('\r\n');
      let buffer = '';
      let capturing = false;
      for (const line of lines) {
        if (!capturing && line.startsWith('DESCRIPTION:')) {
          buffer += line.slice('DESCRIPTION:'.length);
          capturing = true;
          continue;
        }
        if (capturing) {
          if (line.startsWith(' ')) {
            buffer += line.slice(1);
            continue;
          }
          break;
        }
      }
      return buffer;
    })();

    expect(description).toBe(
      'Job ID: job-upcoming\\nChannel: call\\nContact: Jordan Recruiter\\nNote: Schedule check-in',
    );
    expect(ics).not.toContain('job-past-due');
  });

  it('prints headings with (none) when reminders are filtered out', () => {
    runCli([
      'track',
      'log',
      'job-only-past-due',
      '--channel',
      'follow_up',
      '--date',
      '2025-03-01T08:00:00Z',
      '--remind-at',
      '2025-03-02T09:00:00Z',
    ]);

    const output = runCli([
      'track',
      'reminders',
      '--upcoming-only',
      '--now',
      '2025-03-10T00:00:00Z',
    ]);

    const lines = output.trimEnd().split('\n');
    expect(lines).toEqual(['Upcoming', '  (none)']);
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

    const lines = fullOutput.trim().split('\n');
    const pastDueIndex = lines.indexOf('Past Due');
    const upcomingIndex = lines.indexOf('Upcoming');

    expect(pastDueIndex).toBeGreaterThan(-1);
    expect(lines[pastDueIndex + 1]).toBe(
      'job-1 — 2025-03-05T09:00:00.000Z (follow_up)'
    );
    expect(lines[pastDueIndex + 2]).toBe('  Note: Send status update');

    expect(upcomingIndex).toBeGreaterThan(-1);
    expect(lines[upcomingIndex + 1]).toBe(
      'job-2 — 2025-03-07T15:00:00.000Z (call)'
    );
    expect(lines[upcomingIndex + 2]).toBe('  Contact: Avery Hiring Manager');

    const upcomingOnly = runCli([
      'track',
      'reminders',
      '--now',
      '2025-03-06T00:00:00Z',
      '--upcoming-only',
    ]);

    expect(upcomingOnly).not.toContain('Past Due');
    expect(upcomingOnly).toContain('Upcoming');
    expect(upcomingOnly).toContain(
      'job-2 — 2025-03-07T15:00:00.000Z (call)'
    );
  });

  it('keeps reminder section headings when a bucket is empty', () => {
    runCli([
      'track',
      'log',
      'job-3',
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
      '--now',
      '2025-03-03T00:00:00Z',
    ]);

    const lines = output.trim().split('\n');
    const pastDueIndex = lines.indexOf('Past Due');
    const upcomingIndex = lines.indexOf('Upcoming');

    expect(pastDueIndex).toBeGreaterThan(-1);
    expect(lines[pastDueIndex + 1]).toBe('  (none)');

    expect(upcomingIndex).toBeGreaterThan(-1);
    expect(lines[upcomingIndex + 1]).toBe(
      'job-3 — 2025-03-07T15:00:00.000Z (call)'
    );
  });

  it('prints empty reminder sections when none exist', () => {
    const output = runCli(['track', 'reminders']);

    expect(output).not.toContain('No reminders scheduled');

    const lines = output.trim().split('\n');
    const pastDueIndex = lines.indexOf('Past Due');
    const upcomingIndex = lines.indexOf('Upcoming');

    expect(pastDueIndex).toBeGreaterThan(-1);
    expect(lines[pastDueIndex + 1]).toBe('  (none)');

    expect(upcomingIndex).toBeGreaterThan(-1);
    expect(lines[upcomingIndex + 1]).toBe('  (none)');
  });

  it('summarizes lifecycle statuses with track board', () => {
    runCli(['track', 'add', 'job-1', '--status', 'screening', '--note', 'Awaiting recruiter']);
    runCli(['track', 'add', 'job-2', '--status', 'onsite']);
    runCli(['track', 'add', 'job-3', '--status', 'offer', '--note', 'Prep for negotiation']);

    const text = runCli(['track', 'board']);
    expect(text).toContain('Screening');
    expect(text).toMatch(/- job-1 \(/);
    expect(text).toContain('Note: Awaiting recruiter');
    expect(text).toContain('Onsite');
    expect(text).toMatch(/- job-2 \(/);
    expect(text).toContain('Offer');
    expect(text).toContain('Note: Prep for negotiation');

    const json = runCli(['track', 'board', '--json']);
    const parsed = JSON.parse(json);
    const screening = parsed.columns.find(column => column.status === 'screening');
    expect(screening.jobs.map(job => job.job_id)).toContain('job-1');
    const offer = parsed.columns.find(column => column.status === 'offer');
    expect(offer.jobs[0]).toMatchObject({ job_id: 'job-3', note: 'Prep for negotiation' });
  });

  it('surfaces the next reminder for each job in track board output', () => {
    runCli(['track', 'add', 'job-1', '--status', 'screening']);
    runCli([
      'track',
      'log',
      'job-1',
      '--channel',
      'follow_up',
      '--remind-at',
      '2099-01-01T12:00:00Z',
      '--note',
      'Send update',
      '--contact',
      'Avery Hiring Manager',
    ]);

    const text = runCli(['track', 'board']);
    expect(text).toContain('Reminder: 2099-01-01T12:00:00.000Z (follow_up, upcoming)');
    expect(text).toContain('Reminder Note: Send update');
    expect(text).toContain('Reminder Contact: Avery Hiring Manager');

    const json = runCli(['track', 'board', '--json']);
    const parsed = JSON.parse(json);
    const screening = parsed.columns.find(column => column.status === 'screening');
    expect(screening.jobs[0].reminder).toMatchObject({
      job_id: 'job-1',
      remind_at: '2099-01-01T12:00:00.000Z',
      past_due: false,
      channel: 'follow_up',
      note: 'Send update',
      contact: 'Avery Hiring Manager',
    });
  });

  it('prefers upcoming reminders on the board when multiple entries exist', () => {
    runCli(['track', 'add', 'job-42', '--status', 'screening']);
    runCli([
      'track',
      'log',
      'job-42',
      '--channel',
      'email',
      '--remind-at',
      '2020-01-01T00:00:00Z',
    ]);
    runCli([
      'track',
      'log',
      'job-42',
      '--channel',
      'call',
      '--remind-at',
      '2099-01-10T15:00:00Z',
      '--note',
      'Prep next check-in',
    ]);

    const text = runCli(['track', 'board']);
    expect(text).toContain('Reminder: 2099-01-10T15:00:00.000Z (call, upcoming)');
    expect(text).not.toContain('Reminder: 2020-01-01T00:00:00.000Z (email, past due)');

    const json = runCli(['track', 'board', '--json']);
    const parsed = JSON.parse(json);
    const screening = parsed.columns.find(column => column.status === 'screening');
    expect(screening.jobs.find(job => job.job_id === 'job-42').reminder).toMatchObject({
      job_id: 'job-42',
      remind_at: '2099-01-10T15:00:00.000Z',
      past_due: false,
      channel: 'call',
      note: 'Prep next check-in',
    });
  });

  it('shows a reminder placeholder on the board when none are scheduled', () => {
    runCli(['track', 'add', 'job-no-reminder', '--status', 'screening']);

    const text = runCli(['track', 'board']);
    const lines = text.trim().split('\n');
    expect(lines).toContain('  Reminder: (none)');

    const json = runCli(['track', 'board', '--json']);
    const parsed = JSON.parse(json);
    const screening = parsed.columns.find(column => column.status === 'screening');
    const entry = screening.jobs.find(job => job.job_id === 'job-no-reminder');
    expect(entry).toHaveProperty('reminder', null);
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
      'Changed priorities',
      '--date',
      '2025-03-08T09:30:00Z',
    ]);
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
    expect(archiveText).toContain('2025-04-01T14:45:00.000Z — Compensation mismatch');
    expect(archiveText).toContain('2025-03-05T12:00:00.000Z — Not remote');
    expect(archiveText).toContain('Tags: remote, onsite');
    expect(archiveText).toContain('job-2');
    expect(
      archiveText.indexOf('2025-03-08T09:30:00.000Z — Changed priorities') <
        archiveText.indexOf('2025-03-05T12:00:00.000Z — Not remote')
    ).toBe(true);

    const singleJob = runCli(['shortlist', 'archive', 'job-1']);
    expect(singleJob).toContain('job-1');
    expect(singleJob).toContain('2025-03-08T09:30:00.000Z — Changed priorities');
    expect(singleJob).not.toContain('job-2');
    expect(
      singleJob.indexOf('2025-03-08T09:30:00.000Z — Changed priorities') <
        singleJob.indexOf('2025-03-05T12:00:00.000Z — Not remote')
    ).toBe(true);

    const asJson = JSON.parse(runCli(['shortlist', 'archive', '--json']));
    expect(Object.keys(asJson.discarded)).toContain('job-1');
    expect(asJson.discarded['job-1']).toHaveLength(2);
    expect(asJson.discarded['job-1'][0]).toMatchObject({
      reason: 'Changed priorities',
      discarded_at: '2025-03-08T09:30:00.000Z',
    });
    expect(asJson.discarded['job-1'][1]).toMatchObject({
      reason: 'Not remote',
      discarded_at: '2025-03-05T12:00:00.000Z',
    });
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

    const job1Json = JSON.parse(runCli(['shortlist', 'archive', 'job-1', '--json']));
    expect(job1Json.history[0]).toMatchObject({
      reason: 'Changed priorities',
      discarded_at: '2025-03-08T09:30:00.000Z',
    });
  }, 15000);

  it('reports when discard archive is empty', () => {
    const emptyAll = runCli(['shortlist', 'archive']);
    expect(emptyAll.trim()).toBe('No discarded jobs found');

    const emptyJob = runCli(['shortlist', 'archive', 'job-missing']);
    expect(emptyJob.trim()).toBe('No discard history for job-missing');
  });

  it('renders legacy discard timestamps as (unknown time)', () => {
    const archivePath = path.join(dataDir, 'discarded_jobs.json');
    const legacyArchive = {
      'job-legacy': [
        { reason: 'Legacy entry without timestamp' },
        { reason: 'Legacy blank timestamp', discarded_at: '   ' },
      ],
    };
    fs.writeFileSync(archivePath, `${JSON.stringify(legacyArchive, null, 2)}\n`, 'utf8');

    const output = runCli(['shortlist', 'archive', 'job-legacy']);
    expect(output).toContain('- (unknown time) — Legacy entry without timestamp');
    expect(output).toContain('- (unknown time) — Legacy blank timestamp');
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
      status: 'answered',
    });
  });

  it('records skipped intake prompts for later follow-up', () => {
    const output = runCli([
      'intake',
      'record',
      '--question',
      'Which benefits matter most?',
      '--skip',
      '--tags',
      'benefits',
      '--notes',
      'Circle back after research',
      '--asked-at',
      '2025-02-02T08:00:00Z',
    ]);
    expect(output.trim()).toMatch(/^Recorded intake response /);

    const list = runCli(['intake', 'list']);
    expect(list).toContain('Which benefits matter most?');
    expect(list).toContain('Status: Skipped');
    expect(list).toContain('Answer: (skipped)');
    expect(list).toContain('Tags: benefits');

    const asJson = JSON.parse(runCli(['intake', 'list', '--json']));
    expect(asJson.responses).toHaveLength(1);
    expect(asJson.responses[0]).toMatchObject({
      question: 'Which benefits matter most?',
      status: 'skipped',
      answer: '',
      notes: 'Circle back after research',
      tags: ['benefits'],
    });
  });

  it('filters intake list to skipped prompts with --skipped-only', () => {
    runCli([
      'intake',
      'record',
      '--question',
      'What motivates you?',
      '--answer',
      'Building accessible tools',
    ]);

    runCli([
      'intake',
      'record',
      '--question',
      'Which benefits matter most?',
      '--skip',
      '--notes',
      'Circle back after research',
    ]);

    const skipped = runCli(['intake', 'list', '--skipped-only']);
    expect(skipped).toContain('Which benefits matter most?');
    expect(skipped).toContain('Status: Skipped');
    expect(skipped).not.toContain('What motivates you?');

    const skippedJson = JSON.parse(
      runCli(['intake', 'list', '--json', '--skipped-only'])
    );
    expect(skippedJson.responses).toHaveLength(1);
    expect(skippedJson.responses[0]).toMatchObject({
      question: 'Which benefits matter most?',
      status: 'skipped',
    });
  });

  it('surfaces intake bullet suggestions and supports tag filters', () => {
    const leadershipOutput = runCli([
      'intake',
      'record',
      '--question',
      'Tell me about a leadership win',
      '--answer',
      'Led SRE incident response overhaul',
      '--tags',
      'Leadership,SRE',
      '--notes',
      'Focus on coordination',
    ]);
    expect(leadershipOutput.trim()).toMatch(/^Recorded intake response/);

    const metricsOutput = runCli([
      'intake',
      'record',
      '--question',
      'Share a metric-driven accomplishment',
      '--answer',
      'Increased activation by 25%\nReduced churn by 10%',
      '--tags',
      'Metrics',
    ]);
    expect(metricsOutput.trim()).toMatch(/^Recorded intake response/);

    const payload = JSON.parse(runCli(['intake', 'bullets', '--json']));
    expect(payload.bullets).toHaveLength(3);
    expect(payload.bullets[0]).toMatchObject({
      text: 'Led SRE incident response overhaul',
      tags: ['Leadership', 'SRE'],
      source: {
        question: 'Tell me about a leadership win',
        type: 'intake',
      },
    });

    const filtered = JSON.parse(runCli(['intake', 'bullets', '--json', '--tag', 'metrics']));
    expect(filtered.bullets).toHaveLength(2);
    expect(filtered.bullets.map(entry => entry.text)).toEqual([
      'Increased activation by 25%',
      'Reduced churn by 10%',
    ]);

    const textOutput = runCli(['intake', 'bullets']);
    expect(textOutput).toContain('Led SRE incident response overhaul');
    expect(textOutput).toContain('Question: Share a metric-driven accomplishment');
  });

  it('generates an intake question plan when details are missing', () => {
    const planOutput = runCli(['intake', 'plan']);
    expect(planOutput).toContain('Intake question plan');
    expect(planOutput).toContain('What roles are you targeting next');
    expect(planOutput).toMatch(/Resume: .*profile\/resume\.json/);
  });

  it('exports the intake question plan as JSON', () => {
    runCli([
      'intake',
      'record',
      '--question',
      'Where are you willing to relocate?',
      '--answer',
      'Open to West Coast US and remote-first roles.',
      '--tags',
      'relocation',
    ]);

    const payload = JSON.parse(runCli(['intake', 'plan', '--json']));
    expect(Array.isArray(payload.plan)).toBe(true);
    expect(payload.resume_path).toMatch(/profile\/resume\.json$/);
    expect(payload.plan.length).toBeGreaterThan(0);
  });

  it('advertises all intake subcommands in usage output', () => {
    const bin = path.resolve('bin', 'jobbot.js');
    const result = spawnSync('node', [bin, 'intake'], {
      encoding: 'utf8',
      env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: jobbot intake <record|list|bullets|plan> ...');
  });

  it('tags shortlist entries and persists labels', () => {
    const output = runCli(['shortlist', 'tag', 'job-abc', 'dream', 'remote']);
    expect(output.trim()).toBe('Tagged job-abc with dream, remote');
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(raw.jobs['job-abc'].tags).toEqual(['dream', 'remote']);
  });

  it('deduplicates shortlist tags when casing differs', () => {
    runCli(['shortlist', 'tag', 'job-case', 'Remote']);
    const output = runCli(['shortlist', 'tag', 'job-case', 'remote', 'Hybrid']);
    expect(output.trim()).toBe('Tagged job-case with Remote, Hybrid');

    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'shortlist.json'), 'utf8')
    );
    expect(raw.jobs['job-case'].tags).toEqual(['Remote', 'Hybrid']);

    const listing = runCli(['shortlist', 'list', '--tag', 'remote']);
    expect(listing).toContain('job-case');
    expect(listing).toContain('Tags: Remote, Hybrid');
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

  it('surfaces discard tags in shortlist list output', () => {
    runCli([
      'shortlist',
      'discard',
      'job-with-discard-tags',
      '--reason',
      'Changed focus',
      '--tags',
      'Remote,onsite',
      '--date',
      '2025-03-05T12:00:00Z',
    ]);

    const output = runCli(['shortlist', 'list']);
    expect(output).toContain('job-with-discard-tags');
    expect(output).toContain('Last Discard Tags: Remote, onsite');
  });

  it('highlights when the latest discard has no tags in shortlist summaries', () => {
    runCli([
      'shortlist',
      'discard',
      'job-without-discard-tags',
      '--reason',
      'Keeping options open',
      '--date',
      '2025-03-09T08:30:00Z',
    ]);

    const output = runCli(['shortlist', 'list']);
    expect(output).toContain('job-without-discard-tags');
    expect(output).toContain('Last Discard Tags: (none)');
  });

  it('deduplicates discard tags in shortlist archive output', () => {
    const archivePath = path.join(dataDir, 'discarded_jobs.json');
    fs.writeFileSync(
      archivePath,
      `${JSON.stringify(
        {
          'job-archive-dup': [
            {
              reason: 'Legacy entry',
              discarded_at: '2025-03-08T15:00:00Z',
              tags: [' Remote ', 'remote', 'ONSITE', 'onsite'],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const output = runCli(['shortlist', 'archive', 'job-archive-dup']);
    expect(output).toContain('Tags: Remote, ONSITE');

    const json = JSON.parse(runCli(['shortlist', 'archive', 'job-archive-dup', '--json']));
    expect(json.history[0].tags).toEqual(['Remote', 'ONSITE']);
  });

  it('reports the newest discard in shortlist list summaries', () => {
    runCli([
      'shortlist',
      'discard',
      'job-newest-first',
      '--reason',
      'Old news',
      '--date',
      '2024-12-25T09:00:00Z',
    ]);

    runCli([
      'shortlist',
      'discard',
      'job-newest-first',
      '--reason',
      'Stay in touch',
      '--date',
      '2025-03-10T12:00:00Z',
    ]);

    const output = runCli(['shortlist', 'list']);
    expect(output).toContain('Last Discard: Stay in touch (2025-03-10T12:00:00.000Z)');
    expect(output).not.toContain('Last Discard: Old news (2024-12-25T09:00:00.000Z)');
  });

  it('surfaces discard counts in shortlist list summaries', () => {
    runCli([
      'shortlist',
      'discard',
      'job-discard-count',
      '--reason',
      'Initial pass',
      '--date',
      '2025-02-01T10:00:00Z',
    ]);

    runCli([
      'shortlist',
      'discard',
      'job-discard-count',
      '--reason',
      'Revisit later',
      '--date',
      '2025-03-15T12:30:00Z',
    ]);

    const output = runCli(['shortlist', 'list']);
    expect(output).toContain('job-discard-count');
    expect(output).toContain('Discard Count: 2');
  });

  it('omits discard summaries when a shortlist entry has no history', () => {
    runCli(['shortlist', 'sync', 'job-no-history', '--location', 'Remote']);

    const output = runCli(['shortlist', 'list']);
    const blocks = output
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean);
    const jobBlock = blocks.find(block => block.startsWith('job-no-history'));
    expect(jobBlock).toBeDefined();
    expect(jobBlock).not.toContain('Discard Count:');
    expect(jobBlock).not.toContain('Last Discard:');
    expect(jobBlock).not.toContain('Last Discard Tags:');
  });

  it('shows last discard details for legacy entries without timestamps', () => {
    const shortlistPath = path.join(dataDir, 'shortlist.json');
    const legacyPayload = {
      jobs: {
        'job-legacy': {
          tags: [],
          discarded: [
            {
              reason: 'No longer relevant',
              tags: ['legacy', 'manual'],
            },
          ],
          metadata: {},
        },
      },
    };
    fs.writeFileSync(shortlistPath, `${JSON.stringify(legacyPayload, null, 2)}\n`);

    const output = runCli(['shortlist', 'list']);
    expect(output).toContain('Last Discard: No longer relevant (unknown time)');
    expect(output).toContain('Last Discard Tags: legacy, manual');
  });

  it('treats invalid discard timestamps as (unknown time) in shortlist output', () => {
    const shortlistPath = path.join(dataDir, 'shortlist.json');
    const payload = {
      jobs: {
        'job-invalid': {
          tags: [],
          discarded: [
            {
              reason: 'Legacy invalid timestamp',
              discarded_at: 'not-a-real-date',
            },
            {
              reason: 'Legacy another invalid',
              discarded_at: '13/32/2024',
            },
          ],
          metadata: {},
        },
      },
    };
    fs.writeFileSync(shortlistPath, `${JSON.stringify(payload, null, 2)}\n`);

    const output = runCli(['shortlist', 'list']);
    expect(output).toContain('Last Discard: Legacy invalid timestamp (unknown time)');
    expect(output).not.toContain('not-a-real-date');
    expect(output).not.toContain('13/32/2024');
  });

  it('includes last_discard metadata in shortlist list --json exports', () => {
    runCli([
      'shortlist',
      'discard',
      'job-json',
      '--reason',
      'Initial screen passed',
      '--date',
      '2025-03-05T12:00:00Z',
    ]);

    runCli([
      'shortlist',
      'discard',
      'job-json',
      '--reason',
      'Scheduling call',
      '--tags',
      'follow_up,calendared',
      '--date',
      '2025-03-07T09:30:00Z',
    ]);

    const json = JSON.parse(runCli(['shortlist', 'list', '--json']));
    expect(json.jobs['job-json'].last_discard).toEqual({
      reason: 'Scheduling call',
      discarded_at: '2025-03-07T09:30:00.000Z',
      tags: ['follow_up', 'calendared'],
    });
    expect(json.jobs['job-json'].discard_count).toBe(2);
  });

  it('writes shortlist JSON snapshots to disk with --out', () => {
    runCli([
      'shortlist',
      'sync',
      'job-export',
      '--location',
      'Remote',
      '--level',
      'Staff',
    ]);

    runCli([
      'shortlist',
      'discard',
      'job-export',
      '--reason',
      'Deprioritized',
      '--date',
      '2025-03-05T12:00:00Z',
    ]);

    const outPath = path.join(dataDir, 'exports', 'shortlist.json');
    const output = runCli([
      'shortlist',
      'list',
      '--json',
      '--out',
      outPath,
    ]);

    expect(output.trim()).toBe(`Saved shortlist snapshot to ${outPath}`);

    const snapshot = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    expect(snapshot.jobs).toHaveProperty('job-export');
    expect(snapshot.jobs['job-export']).toMatchObject({
      metadata: {
        location: 'Remote',
        level: 'Staff',
      },
      last_discard: {
        reason: 'Deprioritized',
        discarded_at: '2025-03-05T12:00:00.000Z',
      },
      discard_count: 1,
    });
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
    expect(syncOutput.trim()).toBe('Synced job-sync metadata with refreshed fields');

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

  it('filters shortlist entries by compensation using normalized currency symbols', () => {
    runCli([
      'shortlist',
      'sync',
      'job-comp-filter',
      '--location',
      'Remote',
      '--level',
      'Staff',
      '--compensation',
      '185k',
    ]);

    const output = runCli(['shortlist', 'list', '--compensation', '185k']);
    expect(output).toContain('job-comp-filter');
    expect(output).toContain('Compensation: $185k');
  });

  it('filters shortlist entries by tag', () => {
    runCli(['shortlist', 'tag', 'job-remote', 'Remote', 'Dream']);
    runCli(['shortlist', 'tag', 'job-onsite', 'Onsite']);

    const textOutput = runCli(['shortlist', 'list', '--tag', 'remote']);
    expect(textOutput).toContain('job-remote');
    expect(textOutput).not.toContain('job-onsite');

    const jsonOutput = runCli(['shortlist', 'list', '--tag', 'remote', '--tag', 'dream', '--json']);
    const payload = JSON.parse(jsonOutput);
    expect(Object.keys(payload.jobs)).toEqual(['job-remote']);
    expect(payload.jobs['job-remote'].tags).toEqual(['Remote', 'Dream']);
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
          discard_count: 1,
          tags: ['Remote'],
          last_discard: {
            reason: 'Paused search',
            discarded_at: '2025-06-02T09:30:00.000Z',
            tags: ['Paused'],
          },
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

  it('creates shortlist sync metadata when invoked without flags for new jobs', () => {
    const shortlistPath = path.join(dataDir, 'shortlist.json');

    const before = Date.now();
    const output = runCli(['shortlist', 'sync', 'job-touch-create']);
    const after = Date.now();

    expect(output.trim()).toBe('Synced job-touch-create metadata');

    expect(fs.existsSync(shortlistPath)).toBe(true);
    const shortlist = JSON.parse(fs.readFileSync(shortlistPath, 'utf8'));
    expect(shortlist.jobs['job-touch-create']).toBeDefined();
    const metadata = shortlist.jobs['job-touch-create'].metadata;
    expect(typeof metadata.synced_at).toBe('string');
    const timestamp = new Date(metadata.synced_at).getTime();
    expect(Number.isNaN(timestamp)).toBe(false);
    expect(timestamp).toBeGreaterThanOrEqual(before - 10);
    expect(timestamp).toBeLessThanOrEqual(after + 2000);
  });

  it('refreshes shortlist sync timestamps when called without metadata flags', async () => {
    const shortlistPath = path.join(dataDir, 'shortlist.json');

    runCli(['shortlist', 'sync', 'job-touch', '--location', 'Remote']);

    const initial = JSON.parse(fs.readFileSync(shortlistPath, 'utf8'));
    const initialMetadata = initial.jobs['job-touch'].metadata;
    expect(initialMetadata).toMatchObject({ location: 'Remote' });
    const initialTimestamp = new Date(initialMetadata.synced_at);
    expect(Number.isNaN(initialTimestamp.getTime())).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 10));

    const output = runCli(['shortlist', 'sync', 'job-touch']);
    expect(output.trim()).toBe('Synced job-touch metadata');

    const updated = JSON.parse(fs.readFileSync(shortlistPath, 'utf8'));
    const updatedMetadata = updated.jobs['job-touch'].metadata;
    const updatedTimestamp = new Date(updatedMetadata.synced_at);
    expect(Number.isNaN(updatedTimestamp.getTime())).toBe(false);
    expect(updatedTimestamp.getTime()).toBeGreaterThan(initialTimestamp.getTime());
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

  it('summarizes shortlist compensation analytics', () => {
    runCli(['shortlist', 'sync', 'job-dollar', '--compensation', '185k']);

    process.env.JOBBOT_SHORTLIST_CURRENCY = '€';
    try {
      runCli(['shortlist', 'sync', 'job-euro-fixed', '--compensation', '95k']);
      runCli(['shortlist', 'sync', 'job-euro-range', '--compensation', '€95 – 140k']);
    } finally {
      delete process.env.JOBBOT_SHORTLIST_CURRENCY;
    }

    runCli(['shortlist', 'sync', 'job-unparsed', '--compensation', 'Competitive']);

    const jsonReport = runCli(['analytics', 'compensation', '--json']);
    const payload = JSON.parse(jsonReport);
    expect(payload.totals).toEqual({
      shortlisted_jobs: 4,
      with_compensation: 4,
      parsed: 3,
      unparsed: 1,
    });
    const euro = payload.currencies.find(entry => entry.currency === '€');
    expect(euro.stats).toMatchObject({
      count: 2,
      range: 1,
      minimum: 95000,
      maximum: 140000,
    });
    const usd = payload.currencies.find(entry => entry.currency === '$');
    expect(usd.stats).toMatchObject({ count: 1, minimum: 185000, maximum: 185000 });
    expect(payload.issues).toEqual([
      { job_id: 'job-unparsed', value: 'Competitive' },
    ]);

    const textReport = runCli(['analytics', 'compensation']);
    expect(textReport).toContain('Compensation summary');
    expect(textReport).toContain('$185,000');
    expect(textReport).toContain('€95,000 – €140,000');
    expect(textReport).toContain('job-unparsed: Competitive');
  });

  it('runs scheduled matching tasks from configuration', () => {
    const resumePath = path.join(dataDir, 'resume.txt');
    fs.writeFileSync(
      resumePath,
      [
        'Summary',
        'Engineer who leads cross-functional teams and improves reliability.',
        '',
        'Experience',
        '2020-2024: Lead engineer driving reliability across services.',
      ].join('\n'),
      'utf8',
    );

    const jobPath = path.join(dataDir, 'job.json');
    fs.writeFileSync(
      jobPath,
      JSON.stringify(
        {
          parsed: {
            requirements: ['Lead reliability programs', 'Collaborate across teams'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const configPath = path.join(dataDir, 'schedule.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          tasks: [
            {
              id: 'match-sample',
              type: 'match',
              resume: resumePath,
              jobFile: jobPath,
              intervalSeconds: 1,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const output = runCli(['schedule', 'run', '--config', configPath, '--cycles', '1']);
    expect(output).toContain('match-sample');
    expect(output).toMatch(/score/i);
  });

  it('prints a helpful error when a scheduled match job snapshot is missing', () => {
    const resumePath = path.join(dataDir, 'resume.txt');
    fs.writeFileSync(resumePath, 'Summary\nLead engineer.\n');

    const configPath = path.join(dataDir, 'schedule.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          tasks: [
            {
              id: 'match-missing',
              type: 'match',
              resume: resumePath,
              jobId: 'job-999',
              intervalSeconds: 1,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const bin = path.resolve('bin', 'jobbot.js');
    const result = spawnSync(
      'node',
      [bin, 'schedule', 'run', '--config', configPath, '--cycles', '1'],
      {
        encoding: 'utf8',
        env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
      },
    );

    expect(result.stderr).toMatch(/match task match-missing could not find job snapshot job-999/i);
    expect(result.stderr).toMatch(/jobbot ingest/i);
  });

  it('bundles the latest deliverables run into a zip archive', async () => {
    const previous = path.join(
      dataDir,
      'deliverables',
      'job-321',
      '2025-03-01T09-00-00Z'
    );
    const latest = path.join(dataDir, 'deliverables', 'job-321', '2025-03-05T10-30-00Z');

    fs.mkdirSync(previous, { recursive: true });
    fs.mkdirSync(latest, { recursive: true });

    fs.writeFileSync(path.join(previous, 'resume.pdf'), 'outdated resume');
    fs.writeFileSync(path.join(latest, 'resume.pdf'), 'fresh resume');
    fs.writeFileSync(path.join(latest, 'cover_letter.md'), 'Updated letter');

    const bundlePath = path.join(dataDir, 'job-321-bundle.zip');
    const output = runCli(['deliverables', 'bundle', 'job-321', '--out', bundlePath]);
    expect(output.trim()).toBe(`Bundled job-321 deliverables to ${bundlePath}`);

    const buffer = fs.readFileSync(bundlePath);
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files).sort();
    expect(entries).toEqual(['cover_letter.md', 'resume.pdf']);
    await expect(zip.file('resume.pdf').async('string')).resolves.toBe('fresh resume');
  });

  it('tailor generates deliverables with cover letter and match artifacts', () => {
    const profileDir = path.join(dataDir, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const resume = {
      basics: {
        name: 'Ada Example',
        email: 'ada@example.com',
        phone: '+1-555-1234',
        summary: 'Platform engineer focused on resilient Node.js systems.',
      },
      work: [
        {
          company: 'Analytical Engines',
          position: 'Staff Engineer',
          highlights: [
            'Delivered Node.js experience improvements that cut latency by 35%.',
            'Led Terraform automation for multi-region deployments.',
          ],
        },
      ],
      projects: [
        {
          name: 'Incident Radar',
          highlights: ['Implemented on-call rotations with clear communication playbooks.'],
        },
      ],
    };
    fs.writeFileSync(
      path.join(profileDir, 'resume.json'),
      JSON.stringify(resume, null, 2),
      'utf8',
    );

    const jobSource = 'https://example.com/jobs/platform-engineer';
    const jobId = jobIdFromSource(jobSource);
    const jobsDir = path.join(dataDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });
    const jobSnapshot = {
      id: jobId,
      fetched_at: '2025-02-01T12:00:00.000Z',
      raw: [
        'Title: Platform Engineer',
        'Company: ExampleCorp',
        'Location: Remote',
        'Summary',
        'Keep Node.js infrastructure reliable while expanding Terraform coverage.',
        'Requirements',
        '- Node.js experience',
        '- Terraform automation',
        '- Clear communication',
      ].join('\n'),
      parsed: {
        title: 'Platform Engineer',
        company: 'ExampleCorp',
        location: 'Remote',
        summary: 'Keep Node.js infrastructure reliable while expanding Terraform coverage.',
        requirements: ['Node.js experience', 'Terraform automation', 'Clear communication'],
      },
      source: { type: 'url', value: jobSource, headers: {} },
    };
    fs.writeFileSync(
      path.join(jobsDir, `${jobId}.json`),
      JSON.stringify(jobSnapshot, null, 2),
      'utf8',
    );

    const out = runCli(['tailor', jobId]);
    expect(out.trim()).toMatch(new RegExp(`^Generated deliverables for ${jobId} at `));

    const deliverablesRoot = path.join(dataDir, 'deliverables', jobId);
    const runs = fs.readdirSync(deliverablesRoot);
    expect(runs).toHaveLength(1);
    const runDir = path.join(deliverablesRoot, runs[0]);
    const entries = fs.readdirSync(runDir).sort();
    expect(entries).toEqual([
      'build.json',
      'cover_letter.md',
      'match.json',
      'match.md',
      'resume.json',
      'resume.txt',
    ]);

    const coverLetter = fs.readFileSync(path.join(runDir, 'cover_letter.md'), 'utf8');
    expect(coverLetter).toContain('Ada Example');
    expect(coverLetter).toContain('Platform Engineer');
    expect(coverLetter).toContain('Node.js experience');

    const buildLog = JSON.parse(fs.readFileSync(path.join(runDir, 'build.json'), 'utf8'));
    expect(buildLog).toMatchObject({
      job_id: jobId,
      run_label: runs[0],
      cover_letter_included: true,
    });
    expect(() => new Date(buildLog.generated_at).toISOString()).not.toThrow();
    const snapshotPath = buildLog.job_snapshot?.path;
    expect(snapshotPath && snapshotPath.replace(/\\/g, '/')).toBe(`jobs/${jobId}.json`);
    expect(buildLog.job_snapshot?.source?.value).toBe(jobSource);
    const profilePath = buildLog.profile_resume_path;
    expect(profilePath && profilePath.replace(/\\/g, '/')).toBe('profile/resume.json');
    expect(buildLog.outputs).toEqual(
      expect.arrayContaining([
        'match.md',
        'match.json',
        'resume.json',
        'resume.txt',
        'cover_letter.md',
      ]),
    );
    expect(buildLog.prior_activity).toEqual({
      deliverables_runs: 0,
      interview_sessions: 0,
    });

    const matchJson = JSON.parse(fs.readFileSync(path.join(runDir, 'match.json'), 'utf8'));
    expect(buildLog.match_summary).toMatchObject({
      locale: 'en',
      matched_count: matchJson.matched.length,
      missing_count: matchJson.missing.length,
    });
    expect(typeof buildLog.match_summary.score).toBe('number');
    expect(matchJson.title).toBe('Platform Engineer');
    expect(matchJson.company).toBe('ExampleCorp');
    expect(matchJson.matched).toContain('Node.js experience');
    expect(matchJson.matched).toContain('Terraform automation');

    const matchMarkdown = fs.readFileSync(path.join(runDir, 'match.md'), 'utf8');
    expect(matchMarkdown).toContain('# Platform Engineer');
    expect(matchMarkdown).toContain('## Matched');

    const resumePreview = fs.readFileSync(path.join(runDir, 'resume.txt'), 'utf8');
    expect(resumePreview).toContain('Ada Example');
    expect(resumePreview).toContain('Analytical Engines');
  });

  it('fails gracefully when tailoring for a missing job', () => {
    const profileDir = path.join(dataDir, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, 'resume.json'),
      JSON.stringify({ basics: { name: 'Ada Example' } }, null, 2),
      'utf8',
    );

    const bin = path.resolve('bin', 'jobbot.js');
    const result = spawnSync('node', [bin, 'tailor', 'missing-job'], {
      encoding: 'utf8',
      env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Job snapshot not found/i);
  });

  it('records interview sessions with transcripts and notes', () => {
    const transcriptPath = path.join(dataDir, 'transcript.txt');
    fs.writeFileSync(
      transcriptPath,
      'Practiced STAR story covering situation, task, action, and result.\n',
    );

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

    expect(stored.transcript).toBe(
      'Practiced STAR story covering situation, task, action, and result.'
    );
    expect(stored.reflections).toEqual(['Highlight quant impact', 'Tighter close']);
    expect(stored.feedback).toEqual(['Coach praised clarity']);
    expect(stored.notes).toBe('Follow up with salary research');
    expect(stored.stage).toBe('Onsite');
    expect(stored.mode).toBe('Voice');
    expect(stored.started_at).toBe('2025-02-01T09:00:00.000Z');
    expect(stored.ended_at).toBe('2025-02-01T10:30:00.000Z');
    expect(stored.heuristics).toEqual({
      brevity: {
        word_count: 9,
        sentence_count: 1,
        average_sentence_words: 9,
        estimated_wpm: 0.1,
      },
      filler_words: {
        total: 0,
        counts: {},
      },
      structure: {
        star: {
          mentioned: ['situation', 'task', 'action', 'result'],
          missing: [],
        },
      },
      critique: {
        tighten_this: [],
      },
    });

    const shown = runCli(['interviews', 'show', 'job-123', 'session-1']);
    const parsed = JSON.parse(shown);
    expect(parsed).toEqual(stored);
  });

  it('defaults interviews record stage and mode when omitted', () => {
    const output = runCli([
      'interviews',
      'record',
      'job-456',
      'session-default',
      '--transcript',
      'Practiced elevator pitch',
      '--reflections',
      'Tighten closing ask',
    ]);

    expect(output.trim()).toBe('Recorded session session-default for job-456');

    const file = path.join(dataDir, 'interviews', 'job-456', 'session-default.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

    expect(stored.stage).toBe('Behavioral');
    expect(stored.mode).toBe('Voice');
  });

  it('records rehearsal sessions with stage and mode shortcuts', () => {
    const output = runCli([
      'rehearse',
      'job-789',
      '--session',
      'prep-2025-02-01',
      '--behavioral',
      '--voice',
      '--transcript',
      'Walked through leadership story',
      '--reflections',
      'Add more quantified wins',
      '--feedback',
      'Strong presence',
      '--notes',
      'Send thank-you email',
      '--started-at',
      '2025-02-01T09:00:00Z',
      '--ended-at',
      '2025-02-01T09:45:00Z',
    ]);

    expect(output.trim()).toBe('Recorded rehearsal prep-2025-02-01 for job-789');

    const file = path.join(dataDir, 'interviews', 'job-789', 'prep-2025-02-01.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

    expect(stored).toMatchObject({
      job_id: 'job-789',
      session_id: 'prep-2025-02-01',
      stage: 'Behavioral',
      mode: 'Voice',
      transcript: 'Walked through leadership story',
      reflections: ['Add more quantified wins'],
      feedback: ['Strong presence'],
      notes: 'Send thank-you email',
      started_at: '2025-02-01T09:00:00.000Z',
      ended_at: '2025-02-01T09:45:00.000Z',
    });
    expect(stored).toHaveProperty('heuristics');
  });

  it('defaults rehearse stage and mode when not provided', () => {
    const output = runCli([
      'rehearse',
      'job-quick',
      '--transcript',
      'Speed run behavioral prompts',
      '--reflections',
      'Anchor story with metrics',
    ]);

    const trimmed = output.trim();
    expect(trimmed.startsWith('Recorded rehearsal ')).toBe(true);
    const match = trimmed.match(/^Recorded rehearsal (.+) for job-quick$/);
    expect(match).not.toBeNull();
    const [, sessionId] = match;

    const file = path.join(dataDir, 'interviews', 'job-quick', `${sessionId}.json`);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

    expect(stored).toMatchObject({
      job_id: 'job-quick',
      session_id: sessionId,
      stage: 'Behavioral',
      mode: 'Voice',
      transcript: 'Speed run behavioral prompts',
      reflections: ['Anchor story with metrics'],
    });
    expect(stored).toHaveProperty('recorded_at');
  });

  it('records quick rehearsal sessions without additional fields', () => {
    const output = runCli(['rehearse', 'job-empty']);

    const trimmed = output.trim();
    expect(trimmed.startsWith('Recorded rehearsal ')).toBe(true);
    const match = trimmed.match(/^Recorded rehearsal (.+) for job-empty$/);
    expect(match).not.toBeNull();
    const [, sessionId] = match;

    const file = path.join(dataDir, 'interviews', 'job-empty', `${sessionId}.json`);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

    expect(stored).toMatchObject({
      job_id: 'job-empty',
      session_id: sessionId,
      stage: 'Behavioral',
      mode: 'Voice',
    });
    expect(stored).toHaveProperty('recorded_at');
    expect(stored).not.toHaveProperty('transcript');
    expect(stored).not.toHaveProperty('reflections');
    expect(stored).not.toHaveProperty('feedback');
    expect(stored).not.toHaveProperty('notes');
    expect(stored).not.toHaveProperty('heuristics');
  });

  it('transcribes audio rehearsals when a local speech transcriber is configured', () => {
    const audioPath = path.join(dataDir, 'voice-note.txt');
    fs.writeFileSync(audioPath, 'Discussed roadmap alignment');

    const transcriberScript = path.resolve(__dirname, 'fixtures', 'transcriber.js');
    const previous = process.env.JOBBOT_SPEECH_TRANSCRIBER;
    process.env.JOBBOT_SPEECH_TRANSCRIBER = `node ${transcriberScript} --file {{input}}`;

    try {
      const output = runCli(['rehearse', 'job-voice', '--audio', audioPath]);
      const trimmed = output.trim();
      expect(trimmed.startsWith('Recorded rehearsal ')).toBe(true);
      const match = trimmed.match(/^Recorded rehearsal (.+) for job-voice$/);
      expect(match).not.toBeNull();
      const [, sessionId] = match;

      const file = path.join(dataDir, 'interviews', 'job-voice', `${sessionId}.json`);
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));

      expect(stored).toMatchObject({
        job_id: 'job-voice',
        session_id: sessionId,
        stage: 'Behavioral',
        mode: 'Voice',
        transcript: 'Transcribed: Discussed roadmap alignment',
        audio_source: { type: 'file', name: 'voice-note.txt' },
      });
    } finally {
      if (previous === undefined) delete process.env.JOBBOT_SPEECH_TRANSCRIBER;
      else process.env.JOBBOT_SPEECH_TRANSCRIBER = previous;
    }
  });

  it('generates rehearsal plans for interviews', () => {
    const output = runCli([
      'interviews',
      'plan',
      '--stage',
      'system-design',
      '--role',
      'Staff Engineer',
    ]);

    expect(output).toContain('System Design rehearsal plan');
    expect(output).toContain('Role focus: Staff Engineer');
    expect(output).toContain('Architecture');
    expect(output).toContain('Resources');
    expect(output).toContain('Flashcards');
    expect(output).toContain('Question bank');
    expect(output).toContain('Dialog tree');
    expect(output).toMatch(/Follow-ups:/);
    expect(output).toMatch(/- Outline/);
  });

  it('prints onsite rehearsal plans with dialog tree follow-ups', () => {
    const output = runCli(['interviews', 'plan', '--onsite']);

    expect(output).toContain('Onsite rehearsal plan');
    expect(output).toContain('Dialog tree');
    expect(output).toContain(
      'transitions — Walk me through how you reset between onsite sessions and stay present.',
    );
    expect(output).toContain(
      'How do you capture notes for thank-you follow-ups before the next room?',
    );
  });

  it('surfaces recruiter screen rehearsal plans with timeline reminders', () => {
    const output = runCli(['interviews', 'plan', '--screen', '--role', 'Engineering Manager']);

    expect(output).toContain('Screen rehearsal plan');
    expect(output).toContain('Role focus: Engineering Manager');
    expect(output).toContain('Pitch warm-up');
    expect(output).toContain('Logistics & next steps');
    expect(output).toContain('Recruiter alignment checklist');
    expect(output).toMatch(/Confirm timeline/);
  });

  it('speaks dialog prompts with a configured speech synthesizer', () => {
    const spokenLog = path.join(dataDir, 'spoken.txt');
    const synthesizer = [
      'node',
      path.resolve(__dirname, 'fixtures', 'synthesizer.js'),
      '--out',
      spokenLog,
      '--text',
      '{{input}}',
    ].join(' ');

    runCli([
      'interviews',
      'plan',
      '--stage',
      'behavioral',
      '--role',
      'Engineering Manager',
      '--speak',
      '--speaker',
      synthesizer,
    ]);

    const spoken = fs.readFileSync(spokenLog, 'utf8').trim().split('\n');
    expect(spoken).toContain('Behavioral rehearsal plan');
    expect(spoken).toContain('Role focus: Engineering Manager');
    expect(spoken).toContain('Suggested duration: 45 minutes');
    expect(spoken).toContain('Section: Warm-up');
    expect(spoken).toContain(
      'Flashcard: STAR checkpoint — Anchor stories around Situation, Task, Action, Result.',
    );
    expect(spoken).toContain('Resource: STAR template cheat sheet');
    expect(spoken).toContain('Walk me through a recent project you led end-to-end.');
    expect(spoken).toContain('How did you bring partners along the way?');
    expect(spoken).toContain('Share a time you navigated conflict with a stakeholder.');
    expect(spoken).toContain('What trade-offs or data helped resolve it?');
  }, 10000);
});
