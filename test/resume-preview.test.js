import { describe, expect, it } from 'vitest';

import { renderResumeTextPreview } from '../src/resume-preview.js';

function buildLongResume(entries = 80) {
  const work = Array.from({ length: entries }, (_, index) => ({
    company: `Company ${index + 1}`,
    position: `Role ${index + 1}`,
    startDate: '2020-01',
    endDate: '2020-12',
    summary: `Impact summary ${index + 1}`,
    highlights: [
      `Delivered project ${index + 1}`,
      `Improved metric ${index + 1}`,
    ],
  }));

  return {
    basics: {
      name: 'Alex Applicant',
      label: 'Product Engineer',
      email: 'alex@example.com',
    },
    work,
  };
}

describe('renderResumeTextPreview', () => {
  it('truncates preview output to a single page with a marker', () => {
    const preview = renderResumeTextPreview(buildLongResume());
    const lines = preview.split('\n');

    expect(lines.length).toBeLessThanOrEqual(60);
    expect(lines[0]).toBe('Alex Applicant');
    expect(lines.at(-1)).toBe('… (truncated for one-page preview)');
  });

  it('keeps shorter previews intact and ends with a trailing newline', () => {
    const preview = renderResumeTextPreview(buildLongResume(1));
    const lines = preview.split('\n');

    expect(lines).toContain('Alex Applicant');
    expect(lines.at(-1)).toBe('');
  });
});
