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
  });
});
