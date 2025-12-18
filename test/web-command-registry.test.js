import { describe, expect, it } from 'vitest';

import { validateCommandPayload } from '../src/web/command-registry.js';

describe('web command registry', () => {
  describe('validateCommandPayload', () => {
    it('strips control characters from track-show payloads', () => {
      const payload = validateCommandPayload('track-show', { jobId: ' job-42\u0007 ' });
      expect(payload).toEqual({ jobId: 'job-42' });
    });

    it('strips control characters from track-record payloads', () => {
      const payload = validateCommandPayload('track-record', {
        jobId: ' job-7\u0008 ',
        status: 'Offer\u0007',
        note: '\u0007Signed offer\u000f',
      });

      expect(payload).toMatchObject({
        jobId: 'job-7',
        status: 'offer',
        note: 'Signed offer',
      });
    });

    it('normalizes track-log payloads with documents and reminder timestamps', () => {
      const payload = validateCommandPayload('track-log', {
        jobId: ' job-99\u0007 ',
        channel: ' Email ',
        contact: ' Casey Recruiter\u000e ',
        date: '2025-03-06T10:30:00Z',
        note: '\u0000Offer sent ',
        documents: ' resume.pdf , cover_letter.pdf ',
        remindAt: '2025-03-07T09:00:00Z',
      });

      expect(payload).toEqual({
        jobId: 'job-99',
        channel: 'Email',
        contact: 'Casey Recruiter',
        date: '2025-03-06T10:30:00.000Z',
        note: 'Offer sent',
        documents: ['resume.pdf', 'cover_letter.pdf'],
        remindAt: '2025-03-07T09:00:00.000Z',
      });
    });
  });
});
