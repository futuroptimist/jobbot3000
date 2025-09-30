import { describe, expect, it } from 'vitest';

import { normalizeMatchRequest, normalizeSummarizeRequest } from '../src/web/schemas.js';

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
});
