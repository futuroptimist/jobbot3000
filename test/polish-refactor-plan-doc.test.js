import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function readDoc() {
  const docPath = path.join(repoRoot, 'docs', 'polish', 'refactor-plan.md');
  return fs.readFile(docPath, 'utf8');
}

describe('polish refactor plan documentation', () => {
  it('tracks the screenshot refresh implementation note', async () => {
    const contents = await readDoc();
    const screenshotNotePattern = new RegExp(
      'Capture refreshed screenshots after the UI adopts the new redaction and audit affordances.' +
        '\\s+_Implemented \\(2025-10-26\\):',
      's',
    );
    expect(contents).toMatch(screenshotNotePattern);
    expect(contents).toContain('scripts/generate-web-screenshots.js');
    expect(contents).toContain('test/polish-refactor-plan-doc.test.js');
  });

  it('records the module boundary milestone as implemented', async () => {
    const contents = await readDoc();

    const moduleBoundaryPattern = new RegExp(
      [
        'Introduce `src/modules/` with `auth`, `scraping`, `enrichment`, `scoring`,',
        'and `notifications` entry',
        'points wired to a shared event bus.',
        '_Implemented \\(2025-10-31\\):_',
      ].join('\\s+'),
      's',
    );
    expect(contents).toMatch(moduleBoundaryPattern);
    expect(contents).toContain('src/modules/index.js');
    expect(contents).toContain('test/schedule-config.test.js');

    const sharedHttpPattern = new RegExp(
      [
        'Move HTTP helpers into `src/shared/http/` and expose compatibility shims',
        'to avoid breaking legacy',
        'imports.',
        '_Implemented \\(2025-10-31\\):_',
      ].join('\\s+'),
      's',
    );
    expect(contents).toMatch(sharedHttpPattern);
    expect(contents).toContain('src/shared/http/client.js');
    expect(contents).toContain('test/http-client-manifest.test.js');
    expect(contents).toContain('test/services-http.test.js');

    const eventBusPattern = new RegExp(
      [
        'Create `src/shared/events/bus.js` so modules register handlers',
        'and emit cross-module events without',
        'tight coupling.',
        '_Implemented \\(2025-10-31\\):_',
      ].join('\\s+'),
      's',
    );
    expect(contents).toMatch(eventBusPattern);
    expect(contents).toContain('src/shared/events/bus.js');
    expect(contents).toContain('test/module-event-bus.test.js');
  });

  it('records the configuration manifest milestone as implemented', async () => {
    const contents = await readDoc();

    const manifestPattern = new RegExp(
      [
        'Ship the manifest \\(`src/shared/config/manifest.js`\\) that validates host/port,',
        'rate limits, feature',
        'flags, and secrets\\.',
        '_Implemented \\(2025-11-05\\):_',
      ].join('\\s+'),
      's',
    );

    expect(contents).toMatch(manifestPattern);
    expect(contents).toContain('src/shared/config/manifest.js');
    expect(contents).toContain('test/web-config.test.js');
    expect(contents).toContain('test/http-client-manifest.test.js');
  });
});
