import { describe, it, expect } from 'vitest';
import { toMarkdownSummary, toMarkdownMatch } from '../src/exporters.js';

describe('exporters', () => {
  describe('toMarkdownSummary', () => {
    it('renders summary and requirements with spacing', () => {
      const out = toMarkdownSummary({
        title: 'T',
        company: 'C',
        summary: 'S',
        requirements: ['r1', 'r2'],
      });
      expect(out).toBe(
        '# T\n**Company**: C\n\nS\n\n## Requirements\n- r1\n- r2'
      );
    });

    it('omits blank line before requirements when no summary', () => {
      const out = toMarkdownSummary({
        title: 'T',
        company: 'C',
        requirements: ['r1'],
      });
      expect(out).toBe('# T\n**Company**: C\n## Requirements\n- r1');
    });
  });

  describe('toMarkdownMatch', () => {
    it('renders matched and missing sections', () => {
      const out = toMarkdownMatch({
        title: 'T',
        company: 'C',
        score: 50,
        matched: ['m1'],
        missing: ['m2'],
      });
      expect(out).toBe(
        '# T\n**Company**: C\n**Fit Score**: 50%\n\n## Matched\n- m1\n\n## Missing\n- m2'
      );
    });
  });
});
