import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GUIDE_PATH = resolve('docs', 'resume-pipeline-guide.md');

describe('resume pipeline developer guide', () => {
  it('documents how to extend the resume pipeline safely', () => {
    expect(existsSync(GUIDE_PATH)).toBe(true);

    const contents = readFileSync(GUIDE_PATH, 'utf8');

    expect(contents).toMatch(/# Resume pipeline developer guide/i);
    expect(contents).toMatch(
      /Load\s*(?:➜|->)\s*Normalize\s*(?:➜|->)\s*Enrich\s*(?:➜|->)\s*Analyze\s*(?:➜|->)\s*Score/i,
    );
    expect(contents).toMatch(/src\/pipeline\/resume-pipeline\.js/);
    expect(contents).toMatch(/context object/i);
    expect(contents).toMatch(/test\/resume-pipeline\.test\.js/);
    expect(contents).toMatch(/add(ing)? a new enrichment stage/i);
  });
});
