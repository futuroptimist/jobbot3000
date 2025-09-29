import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundleDeliverables, setDeliverablesDataDir } from '../src/deliverables.js';

let dataDir;

describe('deliverables bundling', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-deliverables-'));
    setDeliverablesDataDir(dataDir);
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    setDeliverablesDataDir(undefined);
  });

  it('bundles the most recent deliverables run when no timestamp is provided', async () => {
    const latestDir = path.join(
      dataDir,
      'deliverables',
      'job-123',
      '2025-05-02T08-00-00Z'
    );
    const previousDir = path.join(
      dataDir,
      'deliverables',
      'job-123',
      '2025-04-30T17-30-00Z'
    );
    await fs.mkdir(latestDir, { recursive: true });
    await fs.mkdir(previousDir, { recursive: true });

    await fs.writeFile(path.join(previousDir, 'resume.pdf'), 'outdated resume');

    await fs.writeFile(path.join(latestDir, 'resume.pdf'), 'latest resume');
    await fs.writeFile(path.join(latestDir, 'cover_letter.md'), '# Cover Letter');
    await fs.mkdir(path.join(latestDir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(latestDir, 'notes', 'interview.txt'), 'Prep notes');

    const buffer = await bundleDeliverables('job-123');
    const zip = await JSZip.loadAsync(buffer);

    const entries = Object.keys(zip.files).sort();
    expect(entries).toEqual([
      'cover_letter.md',
      'notes/',
      'notes/interview.txt',
      'resume.pdf',
    ]);
    await expect(zip.file('resume.pdf').async('string')).resolves.toBe('latest resume');
    await expect(zip.file('notes/interview.txt').async('string')).resolves.toBe(
      'Prep notes'
    );
  });

  it('bundles a specific timestamp when provided', async () => {
    const root = path.join(dataDir, 'deliverables', 'job-789', '2025-03-15T12-00-00Z');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'report.txt'), 'Status report');

    const buffer = await bundleDeliverables('job-789', { timestamp: '2025-03-15T12-00-00Z' });
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files).sort();
    expect(entries).toEqual(['report.txt']);
    await expect(zip.file('report.txt').async('string')).resolves.toBe('Status report');
  });

  it('creates a resume diff when the tailored resume diverges from the base profile', async () => {
    const profileDir = path.join(dataDir, 'profile');
    await fs.mkdir(profileDir, { recursive: true });
    const baseResume = {
      basics: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      },
      skills: ['Node.js', 'Leadership'],
      work: [
        { company: 'Analytical Engines', position: 'Engineer' },
      ],
    };
    await fs.writeFile(
      path.join(profileDir, 'resume.json'),
      JSON.stringify(baseResume, null, 2),
    );

    const runDir = path.join(dataDir, 'deliverables', 'job-999', '2025-05-01T10-00-00Z');
    await fs.mkdir(runDir, { recursive: true });
    const tailoredResume = {
      basics: {
        name: 'Ada Byron',
        email: 'ada@example.com',
        summary: 'Seasoned engineer with platform leadership experience.',
      },
      skills: ['Node.js', 'Go'],
      work: [
        { company: 'Analytical Engines' },
      ],
    };
    await fs.writeFile(
      path.join(runDir, 'resume.json'),
      JSON.stringify(tailoredResume, null, 2),
    );

    const buffer = await bundleDeliverables('job-999', {
      timestamp: '2025-05-01T10-00-00Z',
    });
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files).sort();
    expect(entries).toContain('resume.diff.json');

    const diffJson = await zip.file('resume.diff.json').async('string');
    const diff = JSON.parse(diffJson);
    expect(() => new Date(diff.generated_at).toISOString()).not.toThrow();
    expect(diff.base_resume).toBe('profile/resume.json');
    expect(diff.tailored_resume).toBe('resume.json');
    expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 2 });
    expect(diff.added).toEqual({
      'basics.summary': 'Seasoned engineer with platform leadership experience.',
    });
    expect(diff.removed).toEqual({ 'work[0].position': 'Engineer' });
    expect(diff.changed).toMatchObject({
      'basics.name': { before: 'Ada Lovelace', after: 'Ada Byron' },
      'skills[1]': { before: 'Leadership', after: 'Go' },
    });
  });

  it('includes a plain-text preview when a tailored resume is present', async () => {
    const runDir = path.join(dataDir, 'deliverables', 'job-111', '2025-05-05T09-30-00Z');
    await fs.mkdir(runDir, { recursive: true });

    const tailoredResume = {
      basics: {
        name: 'Ada Byron',
        label: 'Platform Engineer',
        email: 'ada@example.com',
        location: {
          city: 'London',
          region: 'UK',
        },
        summary: 'Seasoned engineer with platform leadership experience.',
      },
      work: [
        {
          company: 'Analytical Engines',
          position: 'Engineer',
          startDate: '1840-01-01',
          endDate: '1843-12-31',
          highlights: [
            'Built the first mechanical computation algorithms.',
            'Collaborated with Charles Babbage on the Analytical Engine.',
          ],
        },
      ],
      skills: [
        {
          name: 'Programming',
          keywords: ['Analytical Engine', 'Mathematics'],
        },
        'Leadership',
      ],
    };

    await fs.writeFile(
      path.join(runDir, 'resume.json'),
      JSON.stringify(tailoredResume, null, 2),
    );

    const buffer = await bundleDeliverables('job-111', {
      timestamp: '2025-05-05T09-30-00Z',
    });

    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files).sort();
    expect(entries).toContain('resume.txt');

    const preview = await zip.file('resume.txt').async('string');
    expect(preview).toBe(
      [
        'Ada Byron',
        'Platform Engineer',
        '',
        'Email: ada@example.com',
        'Location: London, UK',
        '',
        'Summary:',
        'Seasoned engineer with platform leadership experience.',
        '',
        'Work Experience:',
        '- Analytical Engines — Engineer (1840-01-01 – 1843-12-31)',
        '  • Built the first mechanical computation algorithms.',
        '  • Collaborated with Charles Babbage on the Analytical Engine.',
        '',
        'Skills:',
        '- Programming (Analytical Engine, Mathematics)',
        '- Leadership',
        '',
      ].join('\n'),
    );
  });

  it('synthesizes a resume PDF when missing but a tailored resume exists', async () => {
    const runDir = path.join(dataDir, 'deliverables', 'job-222', '2025-05-06T08-15-00Z');
    await fs.mkdir(runDir, { recursive: true });

    const tailoredResume = {
      basics: {
        name: 'Ada Example',
        label: 'Staff Engineer',
        email: 'ada@example.com',
      },
      work: [
        {
          company: 'Analytical Engines',
          position: 'Staff Engineer',
          highlights: ['Built resilient systems.'],
        },
      ],
    };

    await fs.writeFile(
      path.join(runDir, 'resume.json'),
      JSON.stringify(tailoredResume, null, 2),
    );

    const buffer = await bundleDeliverables('job-222', {
      timestamp: '2025-05-06T08-15-00Z',
    });

    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files);
    expect(entries).toContain('resume.pdf');

    const pdfBuffer = await zip.file('resume.pdf').async('nodebuffer');
    expect(pdfBuffer.length).toBeGreaterThan(100);
    expect(pdfBuffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
