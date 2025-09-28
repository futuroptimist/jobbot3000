import { describe, it, expect } from 'vitest';

import { generateCoverLetter } from '../src/cover-letter.js';

const sampleResume = {
  basics: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+44 20 7946 0958',
    website: 'https://adalovelace.dev',
    summary: 'Platform engineer with a track record of scaling distributed systems.',
    location: { city: 'London', region: 'UK' },
  },
  work: [
    {
      company: 'Analytical Engines',
      position: 'Lead Engineer',
      highlights: [
        'Led Node.js service modernization to increase availability by 30%.',
        'Automated Terraform pipelines to ship weekly releases.',
      ],
    },
    {
      company: 'Royal Society',
      position: 'Advisor',
      highlights: ['Mentored engineers on collaborative research practices.'],
    },
  ],
  projects: [
    {
      name: 'Computational Notes',
      highlights: ['Documented reusable analytical patterns for partner teams.'],
    },
  ],
};

const sampleMatch = {
  title: 'Platform Engineer',
  company: 'ACME Corp',
  summary: 'Build resilient infrastructure in a collaborative product-led environment.',
  matched: ['Node.js', 'Terraform', 'Mentorship'],
  requirements: ['Node.js', 'Terraform', 'Stakeholder communication'],
};

describe('generateCoverLetter', () => {
  it('produces a markdown cover letter with resume highlights and matched skills', () => {
    const letter = generateCoverLetter({
      resume: sampleResume,
      match: sampleMatch,
      job: sampleMatch,
    });

    expect(letter).toContain('Ada Lovelace');
    expect(letter).toContain('ada@example.com');
    expect(letter).toContain('London, UK');
    expect(letter).toContain('Hiring Team at ACME Corp');
    expect(letter).toContain('Platform Engineer role at ACME Corp');
    expect(letter).toMatch(/Node\.js, Terraform, and Mentorship matches outcomes/);
    expect(letter).toContain('Led Node.js service modernization to increase availability by 30%.');
    expect(letter).toContain('Automated Terraform pipelines to ship weekly releases.');
    expect(letter).toMatch(/Sincerely,\nAda Lovelace$/);
  });

  it('degrades gracefully when resume details are unavailable', () => {
    const letter = generateCoverLetter({
      match: { title: 'Software Engineer', company: 'Globex' },
    });

    expect(letter).toContain('Hello,');
    expect(letter).toContain('Software Engineer role at Globex');
    expect(letter).toContain(
      "I'd welcome the opportunity to discuss how I can support Globex.",
    );
    expect(letter).toContain('Thank you for your consideration.');
    expect(letter).toContain('Sincerely');
  });
});
