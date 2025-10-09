import { describe, expect, it } from 'vitest';

import {
  normalizeMatchRequest,
  normalizeSummarizeRequest,
  normalizeTrackAddRequest,
} from '../src/web/schemas.js';

describe('web request schemas', () => {
  describe('normalizeSummarizeRequest', () => {
    it('normalizes aliases and numeric strings', () => {
      const options = normalizeSummarizeRequest({
        source: 'input.md',
        format: 'JSON',
        sentences: '5',
        timeout: '1500',
        maxBytes: '2048',
        locale: ' En-US ',
      });

      expect(options).toEqual({
        input: 'input.md',
        format: 'json',
        sentences: 5,
        timeoutMs: 1500,
        maxBytes: 2048,
        locale: 'En-US',
      });
    });

    it('throws when options are not an object', () => {
      expect(() => normalizeSummarizeRequest(null)).toThrow('summarize options must be an object');
      expect(() => normalizeSummarizeRequest([])).toThrow('summarize options must be an object');
    });
  });

  describe('normalizeMatchRequest', () => {
    it('normalizes optional strings and boolean flags', () => {
      const options = normalizeMatchRequest({
        resume: 'resume.txt',
        job: 'job.txt',
        explain: 1,
        role: '  Staff Engineer ',
        location: ' Remote ',
        profile: '',
        timeoutMs: '3000',
      });

      expect(options).toEqual({
        resume: 'resume.txt',
        job: 'job.txt',
        format: 'markdown',
        locale: undefined,
        role: 'Staff Engineer',
        location: 'Remote',
        profile: undefined,
        explain: true,
        timeoutMs: 3000,
        maxBytes: undefined,
      });
    });

    it('throws when options are not an object', () => {
      expect(() => normalizeMatchRequest(null)).toThrow('match options must be an object');
      expect(() => normalizeMatchRequest([])).toThrow('match options must be an object');
    });
  });

  describe('normalizeTrackAddRequest', () => {
    it('normalizes lifecycle requests and trims note', () => {
      const options = normalizeTrackAddRequest({
        jobId: ' job-42 ',
        status: 'screening',
        note: '  Scheduled recruiter call  ',
      });

      expect(options).toEqual({
        jobId: 'job-42',
        status: 'screening',
        note: 'Scheduled recruiter call',
      });
    });

    it('rejects unsupported statuses', () => {
      expect(() =>
        normalizeTrackAddRequest({ jobId: 'job-1', status: 'unknown' }),
      ).toThrow('status must be one of:');
    });

    it('throws when options are not an object', () => {
      expect(() => normalizeTrackAddRequest(null)).toThrow('track add options must be an object');
      expect(() => normalizeTrackAddRequest([])).toThrow('track add options must be an object');
    });
  });
});
