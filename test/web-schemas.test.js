import { describe, expect, it } from 'vitest';

import {
  normalizeIntakeListRequest,
  normalizeIntakeExportRequest,
  normalizeIntakePlanRequest,
  normalizeIntakeDraftRequest,
  normalizeIntakeRecordRequest,
  normalizeIntakeResumeRequest,
  normalizeMatchRequest,
  normalizeSummarizeRequest,
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

  describe('normalizeIntakeListRequest', () => {
    it('normalizes status filter and redact flag', () => {
      const options = normalizeIntakeListRequest({
        status: 'skipped',
        redact: true,
      });

      expect(options).toEqual({
        status: 'skipped',
        redact: true,
      });
    });

    it('defaults redact to false when omitted', () => {
      const options = normalizeIntakeListRequest({});

      expect(options).toEqual({
        redact: false,
      });
    });

    it('throws when options are not an object', () => {
      expect(() => normalizeIntakeListRequest(null)).toThrow(
        'intake list request must be an object',
      );
      expect(() => normalizeIntakeListRequest([])).toThrow(
        'intake list request must be an object',
      );
    });

    it('throws when unexpected keys are provided', () => {
      expect(() => normalizeIntakeListRequest({ invalid: true })).toThrow(
        'unexpected intake list keys: invalid',
      );
    });
  });

  describe('normalizeIntakeExportRequest', () => {
    it('normalizes the redact flag', () => {
      const options = normalizeIntakeExportRequest({ redact: true });

      expect(options).toEqual({ redact: true });
    });

    it('defaults redact to false when omitted', () => {
      const options = normalizeIntakeExportRequest({});

      expect(options).toEqual({ redact: false });
    });

    it('throws when options are not an object', () => {
      expect(() => normalizeIntakeExportRequest(null)).toThrow(
        'intake export request must be an object',
      );
      expect(() => normalizeIntakeExportRequest([])).toThrow(
        'intake export request must be an object',
      );
    });

    it('throws when unexpected keys are provided', () => {
      expect(() => normalizeIntakeExportRequest({ format: 'csv' })).toThrow(
        'unexpected intake export keys: format',
      );
    });
  });

  describe('normalizeIntakePlanRequest', () => {
    it('normalizes profile path', () => {
      const options = normalizeIntakePlanRequest({
        profilePath: ' data/profile/resume.json ',
      });

      expect(options).toEqual({
        profilePath: 'data/profile/resume.json',
      });
    });

    it('allows empty payloads', () => {
      expect(normalizeIntakePlanRequest({})).toEqual({});
    });

    it('throws when options are not an object', () => {
      expect(() => normalizeIntakePlanRequest(null)).toThrow(
        'intake plan request must be an object',
      );
      expect(() => normalizeIntakePlanRequest([])).toThrow(
        'intake plan request must be an object',
      );
    });

    it('throws when unexpected keys are provided', () => {
      expect(() => normalizeIntakePlanRequest({ profile: 'resume.json' })).toThrow(
        'unexpected intake plan keys: profile',
      );
    });
  });

  describe('normalizeIntakeDraftRequest', () => {
    it('normalizes required question and optional metadata', () => {
      const options = normalizeIntakeDraftRequest({
        question: '  Why this company?\u0007 ',
        answer: ' Mission ',
        notes: '  values  ',
        tags: 'mission,values',
        askedAt: '2025-03-01T10:00:00.000Z',
      });

      expect(options).toEqual({
        question: 'Why this company?',
        answer: 'Mission',
        notes: 'values',
        tags: 'mission,values',
        askedAt: '2025-03-01T10:00:00.000Z',
      });
    });

    it('throws when question is missing', () => {
      expect(() => normalizeIntakeDraftRequest({})).toThrow('question is required');
    });

    it('throws when timestamps are invalid', () => {
      expect(() =>
        normalizeIntakeDraftRequest({
          question: 'Why this company?',
          askedAt: 'invalid',
        }),
      ).toThrow('askedAt must be a valid ISO-8601 timestamp');
    });

    it('throws when unexpected keys are provided', () => {
      expect(() =>
        normalizeIntakeDraftRequest({ question: 'Why this company?', invalid: true }),
      ).toThrow('unexpected intake draft keys: invalid');
    });
  });

  describe('normalizeIntakeRecordRequest', () => {
    it('normalizes required question and answer fields', () => {
      const options = normalizeIntakeRecordRequest({
        question: '  Career goals?  ',
        answer: '  Build tools  ',
        tags: 'career,growth',
        notes: ' Important ',
      });

      expect(options).toEqual({
        question: 'Career goals?',
        answer: 'Build tools',
        skipped: false,
        tags: 'career,growth',
        notes: 'Important',
      });
    });

    it('normalizes ISO-8601 timestamps', () => {
      const options = normalizeIntakeRecordRequest({
        question: 'When did you start?',
        answer: '2020',
        askedAt: '2025-03-01T10:00:00.000Z',
      });

      expect(options).toEqual({
        question: 'When did you start?',
        answer: '2020',
        skipped: false,
        askedAt: '2025-03-01T10:00:00.000Z',
      });
    });

    it('allows skipped prompts without an answer', () => {
      const options = normalizeIntakeRecordRequest({
        question: 'Compensation expectations?',
        skipped: true,
      });

      expect(options).toEqual({
        question: 'Compensation expectations?',
        skipped: true,
      });
    });

    it('throws when question is missing', () => {
      expect(() => normalizeIntakeRecordRequest({ answer: 'Some answer' })).toThrow(
        'question is required',
      );
    });

    it('throws when answer is missing for non-skipped prompts', () => {
      expect(() => normalizeIntakeRecordRequest({ question: 'Tell me' })).toThrow(
        'answer is required',
      );
    });

    it('throws when askedAt is not a valid timestamp', () => {
      expect(() =>
        normalizeIntakeRecordRequest({
          question: 'Test',
          answer: 'Answer',
          askedAt: 'not-a-date',
        }),
      ).toThrow('askedAt must be a valid ISO-8601 timestamp');
    });

    it('throws when options are not an object', () => {
      expect(() => normalizeIntakeRecordRequest(null)).toThrow(
        'intake record request must be an object',
      );
      expect(() => normalizeIntakeRecordRequest([])).toThrow(
        'intake record request must be an object',
      );
    });

    it('throws when unexpected keys are provided', () => {
      expect(() =>
        normalizeIntakeRecordRequest({
          question: 'Test',
          answer: 'Answer',
          invalid: true,
        }),
      ).toThrow('unexpected intake record keys: invalid');
    });
  });

  describe('normalizeIntakeResumeRequest', () => {
    it('returns an empty object when no fields are supplied', () => {
      expect(normalizeIntakeResumeRequest({})).toEqual({});
    });

    it('throws when unexpected keys are provided', () => {
      expect(() => normalizeIntakeResumeRequest({ draft: true })).toThrow(
        'unexpected intake resume keys: draft',
      );
    });

    it('throws when payload is not an object', () => {
      expect(() => normalizeIntakeResumeRequest(null)).toThrow(
        'intake resume request must be an object',
      );
      expect(() => normalizeIntakeResumeRequest([])).toThrow(
        'intake resume request must be an object',
      );
    });
  });
});
