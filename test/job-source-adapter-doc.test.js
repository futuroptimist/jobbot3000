import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const GUIDE_PATH = path.resolve('docs', 'job-source-adapters-guide.md');

describe('job source adapter documentation', () => {
  it('describes the JobSourceAdapter contract and quick-start steps', () => {
    expect(fs.existsSync(GUIDE_PATH)).toBe(true);

    const contents = fs.readFileSync(GUIDE_PATH, 'utf8');
    expect(contents).toMatch(/# Job Source Adapter Guide/);
    expect(contents).toMatch(/JobSourceAdapter/);
    expect(contents).toMatch(/listOpenings/);
    expect(contents).toMatch(/normalizeJob/);
    expect(contents).toMatch(/toApplicationEvent/);
    expect(contents).toMatch(/src\/adapters\/job-source\.js/);
    expect(contents).toMatch(/src\/jobs\/adapters\/common\.js/);
    expect(contents).toMatch(/Quick start/i);
  });
});
