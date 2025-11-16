import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from '../src/index.js';
import JSZip from 'jszip';
import { recordApplication, STATUSES } from '../src/lifecycle.js';
import { jobIdFromSource } from '../src/jobs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dataDir;

const SAMPLE_PHONE_SCREEN_EMAIL = `From: Casey Recruiter <casey@instabase.com>\n`
  + 'To: Candidate <you@example.com>\n'
  + 'Subject: Instabase recruiter outreach - Phone screen for Solutions Engineer\n'
  + 'Date: Wed, 22 Oct 2025 10:00:00 -0700\n\n'
  + 'Hi Alex,\n\nThanks for your interest in Instabase! We\'d love to connect.\n'
  + 'Would you be available for a phone screen on Thu Oct 23, 2:00 PM PT?\n\n'
  + 'Best,\nCasey\nInstabase Recruiting';

async function ingestPhoneScreenOpportunity() {
  const previousDataDir = process.env.JOBBOT_DATA_DIR;
  process.env.JOBBOT_DATA_DIR = dataDir;

  const { OpportunitiesRepo } = await import('../src/services/opportunitiesRepo.js');
  const { AuditLog } = await import('../src/services/audit.js');
  const { ingestRecruiterEmail } = await import('../src/ingest/recruiterEmail.js');

  const repo = new OpportunitiesRepo();
  const audit = new AuditLog();
  const result = ingestRecruiterEmail({ raw: SAMPLE_PHONE_SCREEN_EMAIL, repo, audit });
  const opportunityUid = result.opportunity.uid;
  repo.close();
  audit.close();

  if (previousDataDir === undefined) {
    delete process.env.JOBBOT_DATA_DIR;
  } else {
    process.env.JOBBOT_DATA_DIR = previousDataDir;
  }

  return opportunityUid;
}

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

  it('errors when profile snapshot runs without an existing resume', () => {
    expect(() => runCli(['profile', 'snapshot'])).toThrow(/profile resume/i);
  });

  it('creates profile snapshots with optional notes and JSON output', () => {
    runCli(['profile', 'init']);

    const profileDir = path.join(dataDir, 'profile');
    const resumePath = path.join(profileDir, 'resume.json');
    const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    resume.basics.name = 'Ada Lovelace';
    fs.writeFileSync(resumePath, `${JSON.stringify(resume, null, 2)}\n`);

    const textOutput = runCli(['profile', 'snapshot', '--note', 'First draft']);
    expect(textOutput.trim()).toMatch(/Saved profile snapshot to/);

    const snapshotsDir = path.join(profileDir, 'snapshots');
    const files = fs.readdirSync(snapshotsDir);
    expect(files.length).toBeGreaterThan(0);
    const snapshotPath = path.join(snapshotsDir, files[0]);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    expect(snapshot).toMatchObject({
      note: 'First draft',
      source_path: 'resume.json',
    });
    expect(new Date(snapshot.created_at).toString()).not.toBe('Invalid Date');
    expect(snapshot.resume.basics.name).toBe('Ada Lovelace');

    const jsonOutput = runCli(['profile', 'snapshot', '--json']);
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.path).toMatch(/profile[\\/]+snapshots[\\/]+/);
    expect(parsed.snapshot.resume.basics.name).toBe('Ada Lovelace');
    expect(parsed.snapshot.note).toBeUndefined();
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

  it('manages listings provider tokens with the CLI', () => {
    const envPath = path.join(dataDir, '.env.tokens');
    const previousEnvFile = process.env.JOBBOT_ENV_FILE;
    process.env.JOBBOT_ENV_FILE = envPath;

    try {
      const setOutput = runCli([
        'listings',
        'provider-token',
        '--provider',
        'workable',
        '--token',
        '  line1\nline2  ',
        '--json',
      ]);
      const setResult = JSON.parse(setOutput);

      expect(setResult).toMatchObject({ provider: 'workable', action: 'set' });
      const setStatus = setResult.tokenStatus.find(
        entry => entry.provider === 'workable',
      );
      expect(setStatus).toBeTruthy();
      expect(setStatus).toMatchObject({
        envKey: 'JOBBOT_WORKABLE_TOKEN',
        hasToken: true,
        length: 10,
        lastFour: 'ine2',
      });

      const envContent = fs.readFileSync(envPath, 'utf8');
      expect(envContent).toContain('JOBBOT_WORKABLE_TOKEN="line1line2"');

      const clearOutput = runCli([
        'listings',
        'provider-token',
        '--provider',
        'workable',
        '--clear',
        '--json',
      ]);
      const clearResult = JSON.parse(clearOutput);
      expect(clearResult).toMatchObject({ provider: 'workable', action: 'clear' });
      const clearStatus = clearResult.tokenStatus.find(
        entry => entry.provider === 'workable',
      );
      expect(clearStatus?.hasToken).toBe(false);

      const clearedContent = fs.existsSync(envPath)
        ? fs.readFileSync(envPath, 'utf8')
        : '';
      expect(clearedContent).not.toContain('JOBBOT_WORKABLE_TOKEN');
    } finally {
      if (previousEnvFile === undefined) delete process.env.JOBBOT_ENV_FILE;
      else process.env.JOBBOT_ENV_FILE = previousEnvFile;

      if (fs.existsSync(envPath)) {
        fs.rmSync(envPath, { recursive: true, force: true });
      }
    }
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

  it('applies lifecycle resolutions from a plan file with track resolve --plan', () => {
    runCli(['track', 'add', 'job-keep', '--status', 'screening', '--note', 'Preserve note']);
    runCli(['track', 'add', 'job-update', '--status', 'onsite', '--note', 'Old onsite note']);
    runCli(['track', 'add', 'job-remove', '--status', 'offer', '--note', 'Remove me']);

    const plan = {
      jobs: [
        {
          job_id: 'job-update',
          status: 'offer',
          note: 'Selected offer',
          updated_at: '2025-02-05T09:30:00Z',
        },
        {
          job_id: 'job-remove',
          status: 'offer',
          note: null,
          updated_at: '2025-02-06T08:15:00Z',
        },
        {
          job_id: 'job-keep',
          status: 'onsite',
        },
      ],
    };
    const planPath = path.join(dataDir, 'resolution-plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

    const output = runCli(['track', 'resolve', '--plan', planPath]);
    expect(output.trim().split('\n')).toEqual([
      'Resolved job-update to offer — note: Selected offer',
      'Resolved job-remove to offer — note cleared',
      'Resolved job-keep to onsite — note: Preserve note',
    ]);

    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8')
    );
    expect(raw['job-update']).toMatchObject({
      status: 'offer',
      note: 'Selected offer',
      updated_at: '2025-02-05T09:30:00.000Z',
    });
    expect(raw['job-remove']).toEqual({
      status: 'offer',
      updated_at: '2025-02-06T08:15:00.000Z',
    });
    expect(raw['job-keep']).toMatchObject({ status: 'onsite', note: 'Preserve note' });
  });

  it('resolves a single lifecycle entry with track resolve', () => {
    runCli(['track', 'add', 'job-single', '--status', 'screening', '--note', 'Initial note']);

    const first = runCli([
      'track',
      'resolve',
      'job-single',
      '--status',
      'offer',
      '--note',
      'Selected offer',
      '--date',
      '2025-02-07T09:30:00Z',
    ]);
    expect(first.trim()).toBe('Resolved job-single to offer — note: Selected offer');

    let raw = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8')
    );
    expect(raw['job-single']).toEqual({
      status: 'offer',
      note: 'Selected offer',
      updated_at: '2025-02-07T09:30:00.000Z',
    });

    const cleared = runCli([
      'track',
      'resolve',
      'job-single',
      '--status',
      'offer',
      '--clear-note',
      '--date',
      '2025-02-08T10:00:00Z',
    ]);
    expect(cleared.trim()).toBe('Resolved job-single to offer — note cleared');

    raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8'));
    expect(raw['job-single']).toEqual({
      status: 'offer',
      updated_at: '2025-02-08T10:00:00.000Z',
    });
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

  it('shows lifecycle details, timeline, and attachments with track show', () => {
    runCli([
      'track',
      'add',
      'job-detail',
      '--status',
      'screening',
      '--note',
      'Waiting on recruiter feedback',
      '--date',
      '2025-03-03T08:00:00Z',
    ]);

    runCli([
      'track',
      'log',
      'job-detail',
      '--channel',
      'applied',
      '--date',
      '2025-03-01T09:30:00Z',
      '--contact',
      'Jordan Hiring Manager',
      '--documents',
      'resume.pdf,cover-letter.pdf',
      '--note',
      'Submitted via referral portal',
      '--remind-at',
      '2025-03-10T09:00:00Z',
    ]);

    runCli([
      'track',
      'log',
      'job-detail',
      '--channel',
      'follow_up',
      '--date',
      '2025-03-05T10:15:00Z',
      '--contact',
      'Jordan Hiring Manager',
      '--note',
      'Checked in after onsite invite',
    ]);

    const output = runCli(['track', 'show', 'job-detail']);
    expect(output).toContain('job-detail');
    expect(output).toMatch(/Status: screening \(updated \d{4}-\d{2}-\d{2}T/);
    expect(output).toContain('Note: Waiting on recruiter feedback');
    expect(output).toContain('Timeline:');
    expect(output).toContain('- applied (2025-03-01T09:30:00.000Z)');
    expect(output).toContain('  Contact: Jordan Hiring Manager');
    expect(output).toContain('  Attachments: resume.pdf, cover-letter.pdf');
    expect(output).toContain('  Reminder: 2025-03-10T09:00:00.000Z');
    expect(output).toContain('- follow_up (2025-03-05T10:15:00.000Z)');
    expect(output).toContain('  Note: Checked in after onsite invite');
    expect(output).toContain('Attachments:\n- resume.pdf\n- cover-letter.pdf');

    const jsonOutput = runCli(['track', 'show', 'job-detail', '--json']);
    const detail = JSON.parse(jsonOutput);
    expect(detail.job_id).toBe('job-detail');
    expect(detail.status).toMatchObject({
      job_id: 'job-detail',
      status: 'screening',
      note: 'Waiting on recruiter feedback',
    });
    expect(detail.status.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(detail.events).toEqual([
      {
        channel: 'applied',
        date: '2025-03-01T09:30:00.000Z',
        contact: 'Jordan Hiring Manager',
        documents: ['resume.pdf', 'cover-letter.pdf'],
        note: 'Submitted via referral portal',
        remind_at: '2025-03-10T09:00:00.000Z',
      },
      {
        channel: 'follow_up',
        date: '2025-03-05T10:15:00.000Z',
        contact: 'Jordan Hiring Manager',
        note: 'Checked in after onsite invite',
      },
    ]);
    expect(detail.attachments).toEqual(['resume.pdf', 'cover-letter.pdf']);
  }, 15000);

  it('updates lifecycle status and note with track update', () => {
    const initialDate = '2025-03-02T08:30:00Z';
    const expectedInitialIso = new Date(initialDate).toISOString();
    const updateDate = '2025-03-04T10:00:00Z';
    const expectedUpdateIso = new Date(updateDate).toISOString();

    const addOutput = runCli([
      'track',
      'add',
      'job-update',
      '--status',
      'screening',
      '--note',
      'Initial recruiter screen',
      '--date',
      initialDate,
    ]);
    expect(addOutput.trim()).toBe('Recorded job-update as screening');

    const updateOutput = runCli([
      'track',
      'update',
      'job-update',
      '--status',
      'onsite',
      '--note',
      'Onsite loop scheduled',
      '--date',
      updateDate,
    ]);
    expect(updateOutput.trim()).toBe('Updated job-update to onsite');

    const textDetail = runCli(['track', 'show', 'job-update']);
    expect(textDetail).toContain(`Status: onsite (updated ${expectedUpdateIso})`);
    expect(textDetail).toContain('Note: Onsite loop scheduled');
    expect(textDetail).not.toContain(expectedInitialIso);

    const jsonDetail = runCli(['track', 'show', 'job-update', '--json']);
    const parsedDetail = JSON.parse(jsonDetail);
    expect(parsedDetail.status).toEqual({
      job_id: 'job-update',
      status: 'onsite',
      note: 'Onsite loop scheduled',
      updated_at: expectedUpdateIso,
    });
    expect(parsedDetail.events).toEqual([]);
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

  it('snoozes reminders via track reminders snooze', () => {
    runCli([
      'track',
      'log',
      'job-snooze',
      '--channel',
      'follow_up',
      '--date',
      '2025-03-01T08:00:00Z',
      '--remind-at',
      '2025-03-05T09:00:00Z',
    ]);

    const output = runCli([
      'track',
      'reminders',
      'snooze',
      'job-snooze',
      '--until',
      '2025-03-08T10:15:00Z',
    ]);

    expect(output.trim()).toBe('Snoozed reminder for job-snooze until 2025-03-08T10:15:00.000Z');

    const payload = JSON.parse(
      runCli(['track', 'reminders', '--json', '--now', '2025-03-06T00:00:00Z']),
    );

    expect(payload.reminders).toEqual([
      {
        job_id: 'job-snooze',
        remind_at: '2025-03-08T10:15:00.000Z',
        channel: 'follow_up',
        past_due: false,
      },
    ]);
    expect(payload.sections[0]).toEqual({ heading: 'Past Due', reminders: [] });
    expect(payload.sections[1]).toMatchObject({ heading: 'Upcoming' });
    expect(payload.sections[1].reminders).toEqual([
      {
        job_id: 'job-snooze',
        remind_at: '2025-03-08T10:15:00.000Z',
        channel: 'follow_up',
        past_due: false,
      },
    ]);
  });

  it('marks reminders done via track reminders done', () => {
    runCli([
      'track',
      'log',
      'job-done',
      '--channel',
      'call',
      '--date',
      '2025-03-01T08:00:00Z',
      '--remind-at',
      '2025-03-06T14:00:00Z',
      '--note',
      'Prep talking points',
    ]);

    const output = runCli([
      'track',
      'reminders',
      'done',
      'job-done',
      '--at',
      '2025-03-05T13:00:00Z',
    ]);

    expect(output.trim()).toBe('Marked reminder for job-done as done at 2025-03-05T13:00:00.000Z');

    const payload = JSON.parse(runCli(['track', 'reminders', '--json']));
    expect(payload.reminders).toEqual([]);
    expect(payload.sections).toEqual([
      { heading: 'Past Due', reminders: [] },
      { heading: 'Upcoming', reminders: [] },
    ]);
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

  it('allows customizing the ICS calendar name with --calendar-name', () => {
    runCli([
      'track',
      'log',
      'job-calendar-name',
      '--channel',
      'call',
      '--date',
      '2025-03-05T10:00:00Z',
      '--note',
      'Prep talking points',
      '--contact',
      'Jamie Hiring Manager',
      '--remind-at',
      '2025-03-10T15:00:00Z',
    ]);

    const calendarPath = path.join(dataDir, 'custom-name.ics');
    runCli([
      'track',
      'reminders',
      '--ics',
      calendarPath,
      '--calendar-name',
      'Coaching Reminders',
      '--now',
      '2025-03-06T00:00:00Z',
    ]);

    const ics = fs.readFileSync(calendarPath, 'utf8');
    expect(ics).toContain('NAME:Coaching Reminders');
    expect(ics).toContain('X-WR-CALNAME:Coaching Reminders');
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

  it('schedules phone screen reminders for an opportunity', async () => {
    const opportunityUid = await ingestPhoneScreenOpportunity();

    const output = runCli(['reminders', 'schedule', '--opportunity', opportunityUid]);
    expect(output).toContain(`Scheduled 3 reminders for ${opportunityUid}`);

    const eventsPath = path.join(dataDir, 'application_events.json');
    const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    const reminders = events[opportunityUid];
    expect(reminders).toBeDefined();
    expect(reminders).toHaveLength(3);
    const remindTimes = reminders.map(entry => entry.remind_at);
    expect(remindTimes).toEqual([
      '2025-10-22T21:00:00.000Z',
      '2025-10-23T20:00:00.000Z',
      '2025-10-23T23:00:00.000Z',
    ]);
    const notes = reminders.map(entry => entry.note);
    expect(notes).toEqual([
      expect.stringContaining('prep'),
      expect.stringContaining('logistics'),
      expect.stringContaining('thank-you'),
    ]);
  });

  it(
    'does not duplicate phone screen reminders when run repeatedly',
    async () => {
      const opportunityUid = await ingestPhoneScreenOpportunity();

      runCli(['reminders', 'schedule', '--opportunity', opportunityUid]);
      const secondRun = runCli(['reminders', 'schedule', '--opportunity', opportunityUid]);

      expect(secondRun).toContain(`No new reminders scheduled for ${opportunityUid}.`);

      const eventsPath = path.join(dataDir, 'application_events.json');
      const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
      expect(events[opportunityUid]).toHaveLength(3);
    },
    15000,
  );

  it('preserves unrelated follow-up reminders when scheduling phone screen reminders', async () => {
    const opportunityUid = await ingestPhoneScreenOpportunity();

    runCli([
      'track',
      'log',
      opportunityUid,
      '--channel',
      'follow_up',
      '--date',
      '2025-10-20T18:00:00Z',
      '--remind-at',
      '2025-10-24T18:00:00Z',
      '--note',
      'Custom follow-up to share portfolio',
    ]);

    runCli(['reminders', 'schedule', '--opportunity', opportunityUid]);

    const eventsPath = path.join(dataDir, 'application_events.json');
    const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    const reminders = events[opportunityUid];
    expect(reminders).toHaveLength(4);

    const manualReminder = reminders.find(
      entry => entry.note === 'Custom follow-up to share portfolio',
    );
    expect(manualReminder).toBeDefined();
    expect(manualReminder.remind_at).toBe('2025-10-24T18:00:00.000Z');

    const schedulerEntries = reminders.filter(
      entry => Array.isArray(entry.tags) && entry.tags.includes('phone_screen_reminder'),
    );
    expect(schedulerEntries).toHaveLength(3);
  });

  it('replaces existing reminders when the phone screen time changes', async () => {
    const opportunityUid = await ingestPhoneScreenOpportunity();

    runCli(['reminders', 'schedule', '--opportunity', opportunityUid]);

    const previousDataDir = process.env.JOBBOT_DATA_DIR;
    process.env.JOBBOT_DATA_DIR = dataDir;
    const { OpportunitiesRepo } = await import('../src/services/opportunitiesRepo.js');
    const repo = new OpportunitiesRepo();
    repo.appendEvent({
      opportunityUid,
      type: 'phone_screen_scheduled',
      occurredAt: '2025-10-24T18:00:00.000Z',
      payload: { scheduledAt: '2025-10-24T18:00:00.000Z' },
    });
    repo.close();
    if (previousDataDir === undefined) {
      delete process.env.JOBBOT_DATA_DIR;
    } else {
      process.env.JOBBOT_DATA_DIR = previousDataDir;
    }

    const output = runCli(['reminders', 'schedule', '--opportunity', opportunityUid]);
    expect(output).toContain(`Scheduled 3 reminders for ${opportunityUid}`);

    const eventsPath = path.join(dataDir, 'application_events.json');
    const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    const reminders = events[opportunityUid];
    expect(reminders).toHaveLength(3);
    const remindTimes = reminders.map(entry => entry.remind_at);
    expect(remindTimes).toEqual([
      '2025-10-23T18:00:00.000Z',
      '2025-10-24T17:00:00.000Z',
      '2025-10-24T20:00:00.000Z',
    ]);
  });

  it('errors when scheduling reminders without a phone screen event', async () => {
    const previousDataDir = process.env.JOBBOT_DATA_DIR;
    process.env.JOBBOT_DATA_DIR = dataDir;
    const { OpportunitiesRepo } = await import('../src/services/opportunitiesRepo.js');
    const repo = new OpportunitiesRepo();
    const opportunity = repo.upsertOpportunity({
      company: 'Example Corp',
      roleHint: 'Solutions Engineer',
      contactName: 'Sam Recruiter',
      contactEmail: 'sam@example.com',
      lifecycleState: 'recruiter_outreach',
      firstSeenAt: '2025-10-20T18:00:00.000Z',
    });
    repo.close();
    if (previousDataDir === undefined) {
      delete process.env.JOBBOT_DATA_DIR;
    } else {
      process.env.JOBBOT_DATA_DIR = previousDataDir;
    }

    expect(() =>
      runCli(['reminders', 'schedule', '--opportunity', opportunity.uid]),
    ).toThrow('Opportunity does not have a scheduled phone screen.');
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

  it('lists tracked applications with filters and pagination', async () => {
    process.env.JOBBOT_DATA_DIR = dataDir;
    await recordApplication('job-old-screening', 'screening', {
      date: '2025-02-02T09:00:00Z',
      note: 'Followed up with recruiter',
    });
    await recordApplication('job-new-screening', 'screening', {
      date: '2025-02-04T15:30:00Z',
    });
    await recordApplication('job-offer', 'offer', {
      date: '2025-02-05T12:00:00Z',
      note: 'Offer call scheduled',
    });
    await recordApplication('job-rejected', 'rejected', {
      date: '2025-01-20T08:00:00Z',
    });
    delete process.env.JOBBOT_DATA_DIR;

    const json = runCli([
      'track',
      'list',
      '--json',
      '--status',
      'screening,offer',
      '--page',
      '1',
      '--page-size',
      '2',
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.entries).toEqual([
      expect.objectContaining({
        job_id: 'job-offer',
        status: 'offer',
        updated_at: '2025-02-05T12:00:00.000Z',
        note: 'Offer call scheduled',
      }),
      expect.objectContaining({
        job_id: 'job-new-screening',
        status: 'screening',
        updated_at: '2025-02-04T15:30:00.000Z',
      }),
    ]);
    expect(parsed.pagination).toEqual({
      page: 1,
      pageSize: 2,
      totalEntries: 3,
      totalPages: 2,
    });
    expect(parsed.filters).toEqual({ statuses: ['screening', 'offer'] });

    const text = runCli([
      'track',
      'list',
      '--status',
      'screening,offer',
      '--page',
      '2',
      '--page-size',
      '2',
    ]);
    expect(text).toContain('Showing 1 of 3 applications (page 2 of 2)');
    expect(text).toContain('job-old-screening — Screening');
    expect(text).toContain('2025-02-02T09:00:00.000Z');
    expect(text).toContain('Followed up with recruiter');
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

  it('returns manual templates alongside intake plan JSON output', () => {
    runCli(['init']);
    const output = runCli(['intake', 'plan', '--json']);
    const payload = JSON.parse(output);
    expect(Array.isArray(payload.manual_templates)).toBe(true);
    expect(payload.manual_templates.length).toBeGreaterThan(0);
    expect(
      payload.manual_templates.some(template =>
        template.id === 'manual_strength_story',
      ),
    ).toBe(true);
  });

  it('redacts sensitive intake entries when requested', () => {
    runCli([
      'intake',
      'record',
      '--question',
      'What compensation range keeps you engaged?',
      '--answer',
      'Base $220k + bonus',
      '--tags',
      'compensation',
      '--notes',
      'Discuss equity expectations at onsite',
    ]);
    runCli([
      'intake',
      'record',
      '--question',
      'Share a leadership win',
      '--answer',
      'Mentored two engineers through promotion',
      '--tags',
      'leadership',
    ]);

    const list = runCli(['intake', 'list', '--redact']);
    expect(list).toContain('Answer: [redacted]');
    expect(list).toContain('Notes: [redacted]');
    expect(list).toContain('Answer: Mentored two engineers through promotion');

    const payload = JSON.parse(runCli(['intake', 'list', '--json', '--redact']));
    expect(payload.responses[0]).toMatchObject({
      answer: '[redacted]',
      notes: '[redacted]',
      redacted: true,
    });
    expect(payload.responses[1].answer).toBe('Mentored two engineers through promotion');
    expect(payload.responses[1].redacted).toBeUndefined();
  });

  it('exports intake responses to disk and stdout', () => {
    runCli([
      'intake',
      'record',
      '--question',
      'What compensation range keeps you engaged?',
      '--answer',
      'Base $200k + bonus',
      '--tags',
      'compensation',
    ]);
    runCli([
      'intake',
      'record',
      '--question',
      'Share a leadership win',
      '--answer',
      'Mentored two engineers through promotion',
    ]);

    const target = path.join(dataDir, 'profile', 'intake-export.json');
    const message = runCli(['intake', 'export', '--out', target, '--redact']);
    expect(message).toContain('Saved intake export to');

    const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(saved.responses[0]).toMatchObject({ answer: '[redacted]', redacted: true });

    const stdout = runCli(['intake', 'export', '--json', '--redact']);
    const payload = JSON.parse(stdout);
    expect(payload.responses[0].answer).toBe('[redacted]');
    expect(payload.responses[1].answer).toBe('Mentored two engineers through promotion');
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

  it('accepts a custom resume path for intake plans', () => {
    runCli(['profile', 'init']);

    const customDir = path.join(dataDir, 'alt-profile');
    fs.mkdirSync(customDir, { recursive: true });
    const customResumePath = path.join(customDir, 'resume.json');
    const customResume = {
      basics: {
        summary: 'Principal engineer focused on reliability and mentoring.',
        location: { city: 'Portland', region: 'OR', country: 'USA' },
      },
      work: [
        {
          summary: 'Scaled platform availability and led SRE guild initiatives.',
          highlights: [
            'Reduced incident volume by 45% year-over-year while mentoring junior engineers.',
          ],
        },
      ],
      skills: [
        { name: 'Kubernetes' },
        { name: 'Go' },
        { name: 'Terraform' },
      ],
    };
    fs.writeFileSync(customResumePath, `${JSON.stringify(customResume, null, 2)}\n`, 'utf8');

    const output = runCli([
      'intake',
      'plan',
      '--profile',
      customResumePath,
    ]);

    expect(output).toContain(
      'Where are you open to working and do you have relocation or remote constraints?'
    );
    expect(output).not.toContain('What roles are you targeting next');
    expect(output).not.toContain('Which tools, frameworks, or platforms do you rely on');
    expect(output).toContain(`Resume: ${customResumePath}`);
  });

  it('advertises all intake subcommands in usage output', () => {
    const bin = path.resolve('bin', 'jobbot.js');
    const result = spawnSync('node', [bin, 'intake'], {
      encoding: 'utf8',
      env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: jobbot intake <record|list|bullets|plan|export> ...');
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

  it('shows shortlist details with timeline events and attachments', () => {
    runCli([
      'shortlist',
      'sync',
      'job-detail',
      '--location',
      'Remote',
      '--level',
      'Staff',
      '--compensation',
      '$200k',
    ]);

    runCli(['shortlist', 'tag', 'job-detail', 'remote', 'priority']);

    runCli([
      'shortlist',
      'discard',
      'job-detail',
      '--reason',
      'Paused hiring',
      '--tags',
      'follow_up',
      '--date',
      '2025-03-05T12:00:00Z',
    ]);

    runCli([
      'track',
      'log',
      'job-detail',
      '--channel',
      'email',
      '--contact',
      'Recruiter',
      '--note',
      'Sent resume',
      '--documents',
      'resume.pdf,cover-letter.pdf',
      '--remind-at',
      '2025-03-06T15:00:00Z',
    ]);

    runCli([
      'track',
      'log',
      'job-detail',
      '--channel',
      'call',
      '--note',
      'Scheduled screening',
      '--date',
      '2025-03-07T09:00:00Z',
    ]);

    const detail = JSON.parse(runCli(['shortlist', 'show', 'job-detail', '--json']));

    expect(detail).toMatchObject({
      job_id: 'job-detail',
      metadata: {
        location: 'Remote',
        level: 'Staff',
        compensation: '$200k',
      },
      tags: ['remote', 'priority'],
      discard_count: 1,
      last_discard: {
        reason: 'Paused hiring',
        discarded_at: '2025-03-05T12:00:00.000Z',
        tags: ['follow_up'],
      },
    });

    expect(Array.isArray(detail.events)).toBe(true);
    expect(detail.events).toHaveLength(2);
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'email',
          contact: 'Recruiter',
          note: 'Sent resume',
          documents: ['resume.pdf', 'cover-letter.pdf'],
          remind_at: '2025-03-06T15:00:00.000Z',
        }),
        expect.objectContaining({
          channel: 'call',
          note: 'Scheduled screening',
        }),
      ]),
    );
  }, 15000);

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

  it('exports analytics activity summaries without leaking job identifiers', () => {
    const deliverablesRoot = path.join(dataDir, 'deliverables');
    fs.mkdirSync(deliverablesRoot, { recursive: true });
    const job1Run1 = path.join(deliverablesRoot, 'job-1', '2025-02-01T10-00-00Z');
    const job1Run2 = path.join(deliverablesRoot, 'job-1', '2025-02-05T09-00-00Z');
    const job2Dir = path.join(deliverablesRoot, 'job-2');
    fs.mkdirSync(job1Run1, { recursive: true });
    fs.writeFileSync(path.join(job1Run1, 'resume.pdf'), 'binary');
    fs.mkdirSync(job1Run2, { recursive: true });
    fs.writeFileSync(path.join(job1Run2, 'cover-letter.docx'), 'binary');
    fs.mkdirSync(job2Dir, { recursive: true });
    fs.writeFileSync(path.join(job2Dir, 'portfolio.pdf'), 'binary');

    const interviewsRoot = path.join(dataDir, 'interviews');
    fs.mkdirSync(interviewsRoot, { recursive: true });
    const jobAlphaDir = path.join(interviewsRoot, 'job-alpha');
    const jobBetaDir = path.join(interviewsRoot, 'job-beta');
    fs.mkdirSync(jobAlphaDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobAlphaDir, 'session-1.json'),
      JSON.stringify({ transcript: 'Great session' }, null, 2),
    );
    fs.writeFileSync(
      path.join(jobAlphaDir, 'session-2.json'),
      JSON.stringify({ transcript: 'Follow-up session' }, null, 2),
    );
    fs.mkdirSync(jobBetaDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobBetaDir, 'session-a.json'),
      JSON.stringify({ transcript: 'Phone screen' }, null, 2),
    );

    const outPath = path.join(dataDir, 'analytics', 'activity.json');
    const output = runCli(['analytics', 'activity', '--out', outPath]);

    const resolvedOut = path.resolve(outPath);
    expect(output.trim()).toContain(`Saved analytics activity to ${resolvedOut}`);

    const payload = JSON.parse(fs.readFileSync(resolvedOut, 'utf8'));
    expect(payload.deliverables).toEqual({ jobs: 2, runs: 3 });
    expect(payload.interviews).toEqual({ jobs: 2, sessions: 3 });
    expect(typeof payload.generated_at).toBe('string');
    expect(payload.generated_at).toMatch(/T/);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('job-1');
    expect(serialized).not.toContain('job-2');
    expect(serialized).not.toContain('job-alpha');
    expect(serialized).not.toContain('job-beta');
  });

  it('errors when analytics activity missing output path', () => {
    const bin = path.resolve('bin', 'jobbot.js');
    const result = spawnSync('node', [bin, 'analytics', 'activity', '--out'], {
      encoding: 'utf8',
      env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Usage: jobbot analytics activity/);
  });

  it('filters analytics funnel with timeframe and company flags', () => {
    const jobsDir = path.join(dataDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobsDir, 'job-target.json'),
      `${JSON.stringify({ parsed: { company: 'Future Works' } }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(jobsDir, 'job-other.json'),
      `${JSON.stringify({ parsed: { company: 'Example Labs' } }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(jobsDir, 'job-outside.json'),
      `${JSON.stringify({ parsed: { company: 'Future Works' } }, null, 2)}\n`,
      'utf8',
    );

    runCli([
      'track',
      'log',
      'job-target',
      '--channel',
      'email',
      '--date',
      '2025-02-09T09:00:00Z',
    ]);
    runCli([
      'track',
      'add',
      'job-target',
      '--status',
      'screening',
      '--date',
      '2025-02-10T12:00:00Z',
    ]);

    runCli([
      'track',
      'log',
      'job-other',
      '--channel',
      'email',
      '--date',
      '2025-02-11T10:00:00Z',
    ]);
    runCli([
      'track',
      'add',
      'job-other',
      '--status',
      'screening',
      '--date',
      '2025-02-12T11:00:00Z',
    ]);

    runCli([
      'track',
      'log',
      'job-outside',
      '--channel',
      'email',
      '--date',
      '2025-01-04T09:00:00Z',
    ]);
    runCli([
      'track',
      'add',
      'job-outside',
      '--status',
      'screening',
      '--date',
      '2025-01-05T12:00:00Z',
    ]);

    const jsonReport = runCli([
      'analytics',
      'funnel',
      '--from',
      '2025-02-01',
      '--to',
      '2025-02-28',
      '--company',
      'Future Works',
      '--json',
    ]);
    const parsed = JSON.parse(jsonReport);
    expect(parsed.totals).toEqual({ trackedJobs: 1, withEvents: 1 });
    const stages = Object.fromEntries(parsed.stages.map(stage => [stage.key, stage]));
    expect(stages.outreach.count).toBe(1);
    expect(stages.screening.count).toBe(1);

    const textReport = runCli([
      'analytics',
      'funnel',
      '--from',
      '2025-02-01',
      '--to',
      '2025-02-28',
      '--company',
      'Future Works',
    ]);
    expect(textReport).toContain('Outreach: 1');
    expect(textReport).toContain('Screening: 1 (100% conversion)');
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
  }, 15000);

  it('configures inference settings via the CLI', () => {
    const updated = JSON.parse(
      runCli([
        'settings',
        'configure',
        '--model-provider',
        'vllm',
        '--model',
        'gpt-4o-mini',
        '--json',
      ]),
    );
    expect(updated.inference).toEqual({ provider: 'vllm', model: 'gpt-4o-mini' });

    const current = JSON.parse(runCli(['settings', 'show', '--json']));
    expect(current.inference.provider).toBe('vllm');
    expect(current.inference.model).toBe('gpt-4o-mini');
  });

  it('applies privacy redaction defaults to analytics exports', () => {
    runCli(['settings', 'configure', '--privacy-redact-analytics', 'on']);

    const jobsDir = path.join(dataDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobsDir, 'job-privacy.json'),
      JSON.stringify({ company: 'Future Works' }, null, 2),
      'utf8',
    );

    runCli(['track', 'log', 'job-privacy', '--channel', 'referral', '--date', '2025-03-03']);
    runCli(['track', 'add', 'job-privacy', '--status', 'offer']);

    const redacted = JSON.parse(runCli(['analytics', 'export']));
    const companyNames = redacted.companies.map(entry => entry.name);
    expect(companyNames.every(name => !name || /^Company \d+$/.test(name))).toBe(true);

    const unredacted = JSON.parse(runCli(['analytics', 'export', '--no-redact']));
    expect(unredacted.companies.some(entry => entry.name === 'Future Works')).toBe(true);
  });

  it('prints analytics sankey transitions with json option', () => {
    const opportunitiesDir = path.join(dataDir, 'opportunities');
    fs.mkdirSync(opportunitiesDir, { recursive: true });
    const eventsPath = path.join(opportunitiesDir, 'events.ndjson');
    const events = [
      {
        eventUid: 'evt-001',
        opportunityUid: 'opp-123',
        type: 'phone_screen_scheduled',
        occurredAt: '2025-10-22T12:00:00.000Z',
      },
      {
        eventUid: 'evt-002',
        opportunityUid: 'opp-123',
        type: 'phone_screen_completed',
        occurredAt: '2025-10-23T15:00:00.000Z',
      },
    ];
    const payload = `${events.map(entry => JSON.stringify(entry)).join('\n')}\n`;
    fs.writeFileSync(eventsPath, payload, 'utf8');

    const output = runCli(['analytics', 'sankey', '--json']);
    const report = JSON.parse(output);

    expect(typeof report.generated_at).toBe('string');
    expect(Array.isArray(report.edges)).toBe(true);
    expect(report.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'recruiter_outreach',
          target: 'phone_screen_scheduled',
          count: 1,
        }),
        expect.objectContaining({
          source: 'phone_screen_scheduled',
          target: 'phone_screen_done',
          count: 1,
        }),
      ]),
    );
  });

  it('prints a friendly message when no opportunity events exist', () => {
    const output = runCli(['analytics', 'sankey']);
    expect(output.trim()).toBe('No opportunity events recorded');
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
  }, 8000);

  it('reports analytics health issues for missing statuses and stale outreach', () => {
    runCli(['track', 'log', 'job-known', '--channel', 'email', '--date', '2025-02-10']);
    runCli(['track', 'add', 'job-known', '--status', 'screening']);

    runCli(['track', 'log', 'job-stale', '--channel', 'email', '--date', '2024-10-15']);
    runCli(['track', 'add', 'job-stale', '--status', 'offer']);

    runCli(['track', 'log', 'job-missing', '--channel', 'email', '--date', '2024-12-01']);

    runCli(['track', 'add', 'job-unknown', '--status', 'screening']);

    const applicationsPath = path.join(dataDir, 'applications.json');
    const lifecycle = JSON.parse(fs.readFileSync(applicationsPath, 'utf8'));
    lifecycle['job-known'].updated_at = '2025-02-10T00:00:00.000Z';
    lifecycle['job-unknown'] = {
      status: 'custom_stage',
      updated_at: '2025-02-01T00:00:00.000Z',
    };
    lifecycle['job-stale'].updated_at = '2024-10-01T00:00:00.000Z';
    fs.writeFileSync(applicationsPath, `${JSON.stringify(lifecycle, null, 2)}\n`);

    const eventsPath = path.join(dataDir, 'application_events.json');
    const interactions = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    interactions['job-known'] = [
      { channel: 'email', date: '2025-02-10T00:00:00.000Z' },
    ];
    interactions['job-missing'] = [
      { channel: 'email', date: '2024-12-01T00:00:00.000Z' },
    ];
    interactions['job-stale'] = [
      { channel: 'email', date: '2024-10-15T00:00:00.000Z' },
    ];
    fs.writeFileSync(eventsPath, `${JSON.stringify(interactions, null, 2)}\n`);

    const textReport = runCli(['analytics', 'health', '--now', '2025-02-15T00:00:00Z']);
    expect(textReport).toContain('Missing statuses: 1 job');
    expect(textReport).toContain('job-missing');
    expect(textReport).toContain('Unknown statuses: 1 job');
    expect(textReport).toContain('custom_stage');
    expect(textReport).toContain('Stale statuses (>30d): 1 job');
    expect(textReport).toContain('job-stale');
    expect(textReport).toContain('Stale outreach (>30d): 2 jobs');
    expect(textReport).toContain('job-missing');
    expect(textReport).toContain('last 2024-10-15');

    const jsonReport = runCli([
      'analytics',
      'health',
      '--json',
      '--now',
      '2025-02-15T00:00:00Z',
    ]);
    const payload = JSON.parse(jsonReport);
    expect(payload.summary).toEqual({
      tracked_jobs: 4,
      jobs_with_status: 2,
      jobs_with_events: 3,
    });
    expect(payload.issues.missingStatus.jobs).toEqual(['job-missing']);
    expect(payload.issues.unknownStatuses.entries).toEqual([
      { job_id: 'job-unknown', status: 'custom_stage' },
    ]);
    expect(payload.issues.staleStatuses.entries).toEqual([
      {
        job_id: 'job-stale',
        status: 'offer',
        updated_at: '2024-10-01T00:00:00.000Z',
        age_days: 137,
      },
    ]);
    expect(payload.issues.staleEvents).toEqual({
      count: 2,
      entries: [
        {
          job_id: 'job-missing',
          last_event_at: '2024-12-01T00:00:00.000Z',
          age_days: 76,
        },
        {
          job_id: 'job-stale',
          last_event_at: '2024-10-15T00:00:00.000Z',
          age_days: 123,
        },
      ],
    });
  }, 15000);

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

  it('outputs deliverables resume diff as JSON', () => {
    const profileDir = path.join(dataDir, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, 'resume.json'),
      JSON.stringify(
        {
          basics: { name: 'Alex Original', email: 'alex@example.com' },
          skills: ['Leadership'],
        },
        null,
        2,
      ),
    );

    const runLabel = '2025-08-01T09-00-00Z';
    const runDir = path.join(dataDir, 'deliverables', 'job-cli-diff', runLabel);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'resume.json'),
      JSON.stringify(
        {
          basics: {
            name: 'Alex Tailored',
            email: 'alex@example.com',
            summary: 'Seasoned platform engineer.',
          },
          skills: ['Leadership', 'Node.js'],
        },
        null,
        2,
      ),
    );

    const output = runCli([
      'deliverables',
      'diff',
      'job-cli-diff',
      '--timestamp',
      runLabel,
      '--json',
    ]);
    const diff = JSON.parse(output);
    expect(diff.summary).toEqual({ added: 2, removed: 0, changed: 1 });
    expect(diff.added).toMatchObject({
      'basics.summary': 'Seasoned platform engineer.',
      'skills[1]': 'Node.js',
    });
    expect(diff.changed).toMatchObject({
      'basics.name': { before: 'Alex Original', after: 'Alex Tailored' },
    });
  });

  it('prints deliverables resume diff summary', () => {
    const profileDir = path.join(dataDir, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, 'resume.json'),
      JSON.stringify(
        {
          basics: { name: 'Quinn Original', email: 'quinn@example.com' },
          skills: ['Analysis'],
        },
        null,
        2,
      ),
    );

    const runLabel = '2025-08-02T15-45-00Z';
    const runDir = path.join(dataDir, 'deliverables', 'job-cli-text', runLabel);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'resume.json'),
      JSON.stringify(
        {
          basics: {
            name: 'Quinn Tailored',
            email: 'quinn@example.com',
            summary: 'Tailored storytelling for platform leadership roles.',
          },
          skills: ['Analysis', 'Leadership'],
        },
        null,
        2,
      ),
    );

    const output = runCli(['deliverables', 'diff', 'job-cli-text', '--timestamp', runLabel]);
    expect(output).toContain('Resume diff for job-cli-text');
    expect(output).toContain('Summary: 2 added, 0 removed, 1 changed');
    expect(output).toContain('- basics.summary:');
    expect(output).toContain('"Tailored storytelling for platform leadership roles."');
    expect(output).toContain('- skills[1]: "Leadership"');
    expect(output).toContain('- basics.name: "Quinn Original" → "Quinn Tailored"');
  });

  it('reports when no resume differences exist for a deliverables run', () => {
    const profileDir = path.join(dataDir, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const resume = {
      basics: { name: 'Morgan Candidate', email: 'morgan@example.com' },
      skills: ['Strategy'],
    };
    fs.writeFileSync(
      path.join(profileDir, 'resume.json'),
      JSON.stringify(resume, null, 2),
    );

    const runLabel = '2025-08-03T11-20-00Z';
    const runDir = path.join(dataDir, 'deliverables', 'job-cli-same', runLabel);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'resume.json'),
      JSON.stringify(resume, null, 2),
    );

    const output = runCli(['deliverables', 'diff', 'job-cli-same']);
    expect(output.trim()).toBe(
      `No resume differences found for job-cli-same (${runLabel}).`
    );
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
        requirements: [
          'Node.js experience',
          'Terraform automation',
          'Clear communication',
          'Security clearance required',
        ],
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
      'resume.pdf',
      'resume.txt',
    ]);

    const pdfBuffer = fs.readFileSync(path.join(runDir, 'resume.pdf'));
    expect(pdfBuffer.length).toBeGreaterThan(100);
    expect(pdfBuffer.subarray(0, 4).toString()).toBe('%PDF');

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
        'resume.pdf',
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
      blockers_count: matchJson.blockers.length,
    });
    expect(typeof buildLog.match_summary.score).toBe('number');
    expect(matchJson.title).toBe('Platform Engineer');
    expect(matchJson.company).toBe('ExampleCorp');
    expect(matchJson.matched).toContain('Node.js experience');
    expect(matchJson.matched).toContain('Terraform automation');
    expect(matchJson.blockers).toEqual(['Security clearance required']);

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

  it('captures interview ratings via CLI flags', () => {
    const output = runCli([
      'interviews',
      'record',
      'job-456',
      'session-rated',
      '--rating',
      '5',
      '--notes',
      'Mock panel run-through',
    ]);

    expect(output.trim()).toBe('Recorded session session-rated for job-456');

    const file = path.join(dataDir, 'interviews', 'job-456', 'session-rated.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(stored.rating).toBe(5);
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
      '--rating',
      '3',
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
      rating: 3,
      started_at: '2025-02-01T09:00:00.000Z',
      ended_at: '2025-02-01T09:45:00.000Z',
    });
    expect(stored).toHaveProperty('heuristics');
  });

  it('rejects out-of-range rehearsal ratings', () => {
    expect(() =>
      runCli([
        'rehearse',
        'job-789',
        '--rating',
        '0',
      ]),
    ).toThrow(/rating must be between 1 and 5/);
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

  it('exports interview sessions via interviews export command', async () => {
    runCli([
      'interviews',
      'record',
      'job-export',
      'session-one',
      '--transcript',
      'First recorded session',
      '--stage',
      'Behavioral',
    ]);

    runCli([
      'interviews',
      'record',
      'job-export',
      'session-two',
      '--transcript',
      'Second recorded session',
      '--stage',
      'Onsite',
    ]);

    const outPath = path.join(dataDir, 'interviews-export.zip');
    const output = runCli(['interviews', 'export', '--job', 'job-export', '--out', outPath]);

    expect(output.trim()).toMatch(/Exported interviews for job-export/);
    expect(fs.existsSync(outPath)).toBe(true);

    const archive = fs.readFileSync(outPath);
    const zip = await JSZip.loadAsync(archive);
    const manifestRaw = await zip.file('manifest.json')?.async('string');
    expect(manifestRaw).toBeTruthy();
    const manifest = JSON.parse(manifestRaw);
    expect(manifest).toMatchObject({ job_id: 'job-export', total_sessions: 2 });
    expect(await zip.file('sessions/session-one.json')?.async('string')).toContain(
      'First recorded session',
    );
    expect(await zip.file('sessions/session-two.json')?.async('string')).toContain(
      'Second recorded session',
    );
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

  it('prints a system design outline for interviews outline command', () => {
    const output = runCli([
      'interviews',
      'outline',
      '--role',
      'Staff Engineer',
      '--duration',
      '90',
    ]);

    expect(output).toContain('System Design outline');
    expect(output).toContain('Kickoff (0-5 min)');
    expect(output).toContain('Scaling & reliability');
    expect(output).toContain('Wrap-up (70-75 min)');
  });

  it('emits JSON outlines with --json for interviews outline', () => {
    const output = runCli(['interviews', 'outline', '--json', '--role', 'Platform Lead']);
    const parsed = JSON.parse(output);

    expect(parsed.outline).toMatchObject({
      stage: 'System Design',
      role: 'Platform Lead',
    });
    expect(parsed.outline.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringMatching(/Kickoff/) }),
      ]),
    );
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

  it('surfaces interview practice reminders via the CLI', () => {
    const interviewsRoot = path.join(dataDir, 'interviews');
    fs.mkdirSync(interviewsRoot, { recursive: true });

    const staleDir = path.join(interviewsRoot, 'job-cli-stale');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, 'session-1.json'),
      `${JSON.stringify(
        {
          recorded_at: '2025-02-20T10:00:00.000Z',
          stage: 'Onsite',
          mode: 'Voice',
          heuristics: { critique: { tighten_this: [' tighten transitions '] } },
        },
        null,
        2,
      )}\n`,
    );

    const freshDir = path.join(interviewsRoot, 'job-cli-fresh');
    fs.mkdirSync(freshDir, { recursive: true });
    fs.writeFileSync(
      path.join(freshDir, 'session-1.json'),
      `${JSON.stringify({ recorded_at: '2025-03-28T09:00:00.000Z' }, null, 2)}\n`,
    );

    const emptyDir = path.join(interviewsRoot, 'job-cli-empty');
    fs.mkdirSync(emptyDir, { recursive: true });

    const output = runCli([
      'interviews',
      'remind',
      '--now',
      '2025-03-30T12:00:00.000Z',
      '--stale-after',
      '7',
    ]);

    expect(output).toContain('job-cli-stale');
    expect(output).toContain('Last session: 2025-02-20T10:00:00.000Z (38 days ago)');
    expect(output).toContain('Suggested focus: tighten transitions');
    expect(output).toContain('job-cli-empty');
    expect(output).toContain('No rehearsal sessions have been recorded yet.');
    expect(output).not.toContain('job-cli-fresh');

    const jsonOutput = runCli([
      'interviews',
      'remind',
      '--now',
      '2025-03-30T12:00:00.000Z',
      '--stale-after',
      '7',
      '--json',
    ]);

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.reminders).toEqual([
      expect.objectContaining({
        job_id: 'job-cli-stale',
        reason: 'stale',
        last_session_at: '2025-02-20T10:00:00.000Z',
        stale_for_days: 38,
        suggestions: ['tighten transitions'],
      }),
      {
        job_id: 'job-cli-empty',
        reason: 'no_sessions',
        sessions: 0,
        message: 'No rehearsal sessions have been recorded yet.',
      },
    ]);
  });

  it('subscribes to weekly summaries via notifications command', () => {
    const output = runCli([
      'notifications',
      'subscribe',
      '--email',
      'ada@example.com',
      '--lookback-days',
      '10',
      '--now',
      '2025-03-07T12:00:00Z',
    ]);
    expect(output).toContain('Subscribed ada@example.com (10-day lookback)');

    const subscriptionsPath = path.join(dataDir, 'notifications', 'subscriptions.json');
    const raw = fs.readFileSync(subscriptionsPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      weeklySummary: [
        expect.objectContaining({
          email: 'ada@example.com',
          lookbackDays: 10,
          createdAt: '2025-03-07T12:00:00.000Z',
        }),
      ],
    });
  });

  it('runs notifications digests and spools email payloads', () => {
    fs.writeFileSync(
      path.join(dataDir, 'applications.json'),
      `${JSON.stringify({
        'job-1': 'screening',
        'job-2': 'offer',
      }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(dataDir, 'application_events.json'),
      `${JSON.stringify({
        'job-1': [
          { channel: 'email', date: '2025-01-02T10:00:00.000Z' },
          { channel: 'follow_up', date: '2025-01-05T15:30:00.000Z' },
        ],
        'job-2': [
          { channel: 'email', date: '2025-01-04T09:00:00.000Z' },
          { channel: 'offer_accepted', date: '2025-02-01T18:00:00.000Z' },
        ],
      }, null, 2)}\n`,
    );

    runCli(['notifications', 'subscribe', '--email', 'ada@example.com']);
    const output = runCli(['notifications', 'run', '--now', '2025-02-08T12:00:00Z']);
    expect(output).toContain('Sent 1 weekly summary email.');
    expect(output).toMatch(/ada@example.com/);

    const outboxDir = path.join(dataDir, 'notifications', 'outbox');
    const files = fs.readdirSync(outboxDir);
    expect(files).toHaveLength(1);
    const payload = fs.readFileSync(path.join(outboxDir, files[0]), 'utf8');
    expect(payload).toContain('To: ada@example.com');
    expect(payload).toContain('Funnel snapshot');
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
