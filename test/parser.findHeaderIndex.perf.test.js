import { performance } from 'node:perf_hooks';
import { parseJobText } from '../src/parser.js';
import { describe, it, expect } from 'vitest';

// Baseline implementation of parseJobText using the previous findHeaderIndex
function parseJobTextBaseline(rawText) {
  if (!rawText) {
    return { title: '', company: '', requirements: [], body: '' };
  }
  const TITLE_PATTERNS = [
    /\bTitle\s*:\s*(.+)/i,
    /\bJob Title\s*:\s*(.+)/i,
    /\bPosition\s*:\s*(.+)/i
  ];
  const COMPANY_PATTERNS = [
    /\bCompany\s*:\s*(.+)/i,
    /\bEmployer\s*:\s*(.+)/i
  ];
  const REQUIREMENTS_HEADERS = [
    /\bRequirements\b/i,
    /\bQualifications\b/i,
    /\bWhat you(?:'|’ )ll need\b/i
  ];
  const FALLBACK_REQUIREMENTS_HEADERS = [/\bResponsibilities\b/i];
  const BULLET_PREFIX_RE = /^[-+*•\u00B7\u2013\u2014\d.)(\s]+/;
  function stripBullet(line) {
    return line.replace(BULLET_PREFIX_RE, '').trim();
  }
  function findHeaderIndexOld(lines, primary, fallback) {
    const idx = lines.findIndex(l => primary.some(h => h.test(l)));
    return idx !== -1 ? idx : lines.findIndex(l => fallback.some(h => h.test(l)));
  }
  function extractRequirements(lines) {
    const idx = findHeaderIndexOld(lines, REQUIREMENTS_HEADERS, FALLBACK_REQUIREMENTS_HEADERS);
    if (idx === -1) return [];
    const requirements = [];
    const headerLine = lines[idx];
    const headerPattern = REQUIREMENTS_HEADERS.find(h => h.test(headerLine));
    let rest = headerPattern ? headerLine.replace(headerPattern, '').trim() : '';
    rest = rest.replace(/^[:\s]+/, '');
    if (rest) {
      const first = stripBullet(rest);
      if (first) requirements.push(first);
    }
    for (let i = idx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^[A-Za-z].+:$/.test(line)) break;
      const bullet = stripBullet(line);
      if (bullet) requirements.push(bullet);
    }
    return requirements;
  }
  function findFirstMatch(lines, patterns) {
    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) return match[1].trim();
      }
    }
    return '';
  }
  const text = rawText.replace(/\r/g, '').trim();
  const lines = text.split(/\n+/);
  const title = findFirstMatch(lines, TITLE_PATTERNS);
  const company = findFirstMatch(lines, COMPANY_PATTERNS);
  const requirements = extractRequirements(lines);
  return { title, company, requirements, body: text };
}

describe('findHeaderIndex performance', () => {
  it('improves over baseline implementation', () => {
    const lines = Array(1000).fill('line');
    lines.push('Responsibilities:');
    lines.push('bullet');
    const text = lines.join('\n');
    const iterations = 500;

    const startSlow = performance.now();
    for (let i = 0; i < iterations; i++) {
      parseJobTextBaseline(text);
    }
    const slow = performance.now() - startSlow;

    const startFast = performance.now();
    for (let i = 0; i < iterations; i++) {
      parseJobText(text);
    }
    const fast = performance.now() - startFast;

    expect(fast).toBeLessThan(slow);
  });
});
