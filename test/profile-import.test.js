import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dataDir;

async function readResume() {
  const resumePath = path.join(dataDir, 'profile', 'resume.json');
  const contents = await fs.readFile(resumePath, 'utf8');
  return JSON.parse(contents);
}

describe('LinkedIn profile import', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-linkedin-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    delete process.env.JOBBOT_DATA_DIR;
  });

  it('merges LinkedIn profile exports into the JSON resume', async () => {
    const { initProfile, importLinkedInProfile } = await import('../src/profile.js');
    await initProfile();

    const fixture = path.resolve('test', 'fixtures', 'linkedin-profile.json');
    const result = await importLinkedInProfile(fixture);

    expect(result.basicsUpdated).toBeGreaterThan(0);
    expect(result.workAdded).toBe(1);
    expect(result.educationAdded).toBe(1);
    expect(result.skillsAdded).toBe(3);

    const resume = await readResume();
    expect(resume.basics.name).toBe('Casey Taylor');
    expect(resume.basics.label).toBe('Senior Site Reliability Engineer');
    expect(resume.basics.summary).toMatch('Site reliability leader');
    expect(resume.basics.location.city).toBe('San Francisco Bay Area');

    expect(resume.work).toHaveLength(1);
    expect(resume.work[0]).toMatchObject({
      name: 'ExampleCorp',
      position: 'Staff SRE',
      location: 'Remote',
      startDate: '2021-05',
      endDate: '2024-01',
      summary: 'Maintained infrastructure for multi-region services.',
    });

    expect(resume.education).toHaveLength(1);
    expect(resume.education[0]).toMatchObject({
      institution: 'State University',
      studyType: 'BSc',
      area: 'Computer Science',
      startDate: '2012',
      endDate: '2016',
    });

    expect(resume.skills.map(skill => skill.name)).toEqual([
      'Kubernetes',
      'AWS',
      'Incident Response',
    ]);
  });

  it('does not duplicate entries when importing the same profile again', async () => {
    const { importLinkedInProfile } = await import('../src/profile.js');
    const fixture = path.resolve('test', 'fixtures', 'linkedin-profile.json');

    await importLinkedInProfile(fixture);
    await importLinkedInProfile(fixture);

    const resume = await readResume();
    expect(resume.work).toHaveLength(1);
    expect(resume.education).toHaveLength(1);
    expect(resume.skills).toHaveLength(3);
  });

  it('fills missing resume fields without overwriting confirmed data', async () => {
    const { initProfile, importLinkedInProfile } = await import('../src/profile.js');
    const { path: resumePath } = await initProfile();
    const base = JSON.parse(await fs.readFile(resumePath, 'utf8'));
    base.basics.name = 'Existing Name';
    base.basics.location.city = 'Existing City';
    base.work.push({
      name: 'PartialCo',
      position: 'Engineer',
      startDate: '2019-01',
    });
    base.skills = [{ name: 'Kubernetes' }];
    await fs.writeFile(resumePath, `${JSON.stringify(base, null, 2)}\n`, 'utf8');

    const partialProfile = {
      firstName: 'Jamie',
      lastName: 'Rivera',
      headline: 'Platform Engineer',
      summaryText: 'Focuses on developer workflows.',
      profileLocation: { displayName: 'Seattle, Washington, United States' },
      positions: [
        {
          companyName: 'PartialCo',
          title: 'Engineer',
          timePeriod: { startDate: { year: 2019, month: 1 } },
        },
        {
          companyName: 'FutureLabs',
          title: 'Staff Engineer',
          timePeriod: {
            startDate: { year: 2022, month: 3 },
          },
        },
      ],
      skills: ['Kubernetes', { name: 'Terraform' }],
    };
    const tmp = path.join(dataDir, 'partial-linkedin.json');
    await fs.writeFile(tmp, `${JSON.stringify(partialProfile, null, 2)}\n`, 'utf8');

    const result = await importLinkedInProfile(tmp);
    expect(result.workAdded).toBe(1);
    expect(result.skillsAdded).toBe(1);

    const resume = await readResume();
    expect(resume.basics.name).toBe('Existing Name');
    expect(resume.basics.summary).toBe('Focuses on developer workflows.');
    expect(resume.basics.location.city).toBe('Existing City');
    expect(resume.basics.location.region).toBe('Washington');
    expect(resume.basics.location.country).toBe('United States');
    expect(resume.work).toHaveLength(2);
    const futureRole = resume.work.find(job => job.name === 'FutureLabs');
    expect(futureRole).toMatchObject({
      name: 'FutureLabs',
      position: 'Staff Engineer',
      startDate: '2022-03',
    });
    expect(futureRole).not.toHaveProperty('endDate');
    expect(resume.skills.map(skill => skill.name)).toEqual(['Kubernetes', 'Terraform']);
  });
});
