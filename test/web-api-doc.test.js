import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOC_PATH = resolve('docs', 'web-api-reference.md');
const REQUIRED_COMMANDS = [
  'summarize',
  'match',
  'shortlist-list',
  'shortlist-show',
  'track-show',
  'track-record',
  'analytics-funnel',
  'analytics-export',
  'listings-fetch',
  'listings-ingest',
  'listings-archive',
  'listings-providers',
];

describe('web API reference documentation', () => {
  it('documents command endpoints, headers, and rate limiting', () => {
    expect(existsSync(DOC_PATH)).toBe(true);

    const contents = readFileSync(DOC_PATH, 'utf8');

    expect(contents).toMatch(/#\s+Web API Reference/i);
    expect(contents).toMatch(/POST\s+\/commands\/:command/i);
    expect(contents).toMatch(/X-Jobbot-Csrf/i);
    expect(contents).toMatch(/Authorization/i);
    expect(contents).toMatch(/Rate limiting/i);
    expect(contents).toMatch(/429/);

    for (const command of REQUIRED_COMMANDS) {
      const pattern = new RegExp(`\\b${command}\\b`);
      expect(contents).toMatch(pattern);
    }
  });
});
