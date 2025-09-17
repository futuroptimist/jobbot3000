import { performance } from 'node:perf_hooks';
import { describe, it, expect } from 'vitest';
import { parseJobText } from '../src/parser.js';

function legacyEscapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LEGACY_FIELD_SEPARATOR = '\\s*(?::|[-\\u2013\\u2014])\\s*';

function createLegacyFieldPattern(label) {
  const escaped = legacyEscapeForRegex(label).replace(/\s+/g, '\\s+');
  return new RegExp(`^\\s*${escaped}${LEGACY_FIELD_SEPARATOR}(.+)`, 'i');
}

const LEGACY_TITLE_PATTERNS = [
  'Title',
  'Job Title',
  'Position',
  'Role'
].map(createLegacyFieldPattern);
const LEGACY_COMPANY_PATTERNS = ['Company', 'Employer'].map(createLegacyFieldPattern);
const LEGACY_LOCATION_PATTERNS = ['Location'].map(createLegacyFieldPattern);

const LEGACY_REQUIREMENTS_HEADERS = [
  /\bRequirements\b/i,
  /\bQualifications\b/i,
  /\bWhat you(?:'|’)ll need\b/i
];

const LEGACY_FALLBACK_REQUIREMENTS_HEADERS = [/\bResponsibilities\b/i];

const LEGACY_BULLET_PREFIX_RE =
  /^(?:[-+*•\u00B7\u2013\u2014]\s*|(?:\d+|[A-Za-z])[.)]\s*|\((?:\d+|[A-Za-z])\)\s*)/;

function legacyStripBullet(line) {
  return line.replace(LEGACY_BULLET_PREFIX_RE, '').trim();
}

function legacyFindFirstPatternIndex(lines, patterns) {
  for (let i = 0; i < lines.length; i += 1) {
    const pattern = patterns.find(p => p.test(lines[i]));
    if (pattern) return { index: i, pattern };
  }
  return { index: -1, pattern: null };
}

function legacyFindHeader(lines, primary, fallback) {
  const primaryResult = legacyFindFirstPatternIndex(lines, primary);
  if (primaryResult.index !== -1) return primaryResult;
  return legacyFindFirstPatternIndex(lines, fallback);
}

function legacyFindFirstMatch(lines, patterns) {
  const { index, pattern } = legacyFindFirstPatternIndex(lines, patterns);
  if (index === -1 || !pattern) return '';
  const match = lines[index].match(pattern);
  return match ? match[1].trim() : '';
}

function legacyExtractRequirements(lines) {
  const { index: headerIndex, pattern: headerPattern } = legacyFindHeader(
    lines,
    LEGACY_REQUIREMENTS_HEADERS,
    LEGACY_FALLBACK_REQUIREMENTS_HEADERS
  );
  if (headerIndex === -1) return [];

  const requirements = [];
  const headerLine = lines[headerIndex];
  let rest = headerLine.replace(headerPattern, '').trim();
  rest = rest.replace(/^[:\s]+/, '');

  if (rest) {
    const first = legacyStripBullet(rest);
    if (first) requirements.push(first);
  }

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^[A-Za-z].+:$/.test(line)) break;
    const bullet = legacyStripBullet(line);
    if (bullet) requirements.push(bullet);
  }

  return requirements;
}

function legacyParseJobText(rawText) {
  if (!rawText) {
    return { title: '', company: '', location: '', requirements: [], body: '' };
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);

  const title = legacyFindFirstMatch(lines, LEGACY_TITLE_PATTERNS);
  const company = legacyFindFirstMatch(lines, LEGACY_COMPANY_PATTERNS);
  const location = legacyFindFirstMatch(lines, LEGACY_LOCATION_PATTERNS);
  const requirements = legacyExtractRequirements(lines);

  return { title, company, location, requirements, body: text };
}

describe('parseJobText field scanning performance', () => {
  it('outperforms the legacy field scanner', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `Line ${i}`);
    lines.splice(1000, 0, 'Title: Senior Staff Software Engineer');
    lines.splice(5000, 0, 'Company: Example Labs');
    lines.splice(12000, 0, 'Location: Remote (US)');
    lines.splice(16000, 0, 'Requirements:\n- Build reliable systems\n- Mentor engineers');
    const text = lines.join('\n');

    legacyParseJobText(text);
    parseJobText(text);

    const warmupIterations = 20;
    for (let i = 0; i < warmupIterations; i += 1) {
      legacyParseJobText(text);
      parseJobText(text);
    }

    const batches = 5;
    const iterationsPerBatch = 40; // 5 * 40 = 200 total iterations per parser

    const legacyDurations = [];
    const optimizedDurations = [];

    const measure = (fn, iterations) => {
      let total = 0;
      for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        fn();
        total += performance.now() - start;
      }
      return total;
    };

    for (let i = 0; i < batches; i += 1) {
      legacyDurations.push(measure(() => legacyParseJobText(text), iterationsPerBatch));
      optimizedDurations.push(measure(() => parseJobText(text), iterationsPerBatch));
    }

    const legacyTotal = legacyDurations.reduce((sum, value) => sum + value, 0);
    const optimizedTotal = optimizedDurations.reduce((sum, value) => sum + value, 0);
    const ratio = optimizedTotal / legacyTotal;

    expect(ratio).toBeLessThan(0.9);
    expect(Math.min(...optimizedDurations)).toBeLessThan(Math.min(...legacyDurations));
  });
});
