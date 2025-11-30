import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOW_LISTED_COMMANDS } from '../src/web/command-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function readFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.readFile(absolutePath, 'utf8');
}

describe('web documentation backlog', () => {
  it('documents every allow-listed command endpoint', async () => {
    const apiDoc = await readFile('docs/web-api-reference.md');
    expect(apiDoc).toContain('# Web API reference');
    for (const command of ALLOW_LISTED_COMMANDS) {
      expect(apiDoc).toMatch(new RegExp(`POST\\s+/commands/${command}\\b`));
    }
  });

  it('does not document web commands that lack validators', async () => {
    const apiDoc = await readFile('docs/web-api-reference.md');
    const documentedCommands = new Set(
      [...apiDoc.matchAll(/POST\s+\/commands\/([a-z0-9-]+)/gi)].map(match => match[1]),
    );

    expect(documentedCommands.size).toBeGreaterThan(0);

    for (const command of documentedCommands) {
      expect(ALLOW_LISTED_COMMANDS).toContain(command);
    }
  });

  it('includes storybook markup for each status panel state', async () => {
    const storybookDoc = await readFile('docs/web-component-storybook.md');
    expect(storybookDoc).toContain('# Status hub component storybook');

    const serverSource = await readFile('src/web/server.js');
    const matches = [...serverSource.matchAll(/data-status-panel="([^"]+)"/g)];
    const panelIds = [...new Set(matches.map(match => match[1]))];
    expect(panelIds.length).toBeGreaterThan(0);

    for (const panelId of panelIds) {
      expect(storybookDoc).toMatch(new RegExp(`data-status-panel="${panelId}"`));
    }

    for (const state of ['ready', 'loading', 'error']) {
      expect(storybookDoc).toMatch(new RegExp(`data-state-slot="${state}"`));
    }

    expect(storybookDoc).toContain('status-panel__loading');
    expect(storybookDoc).toContain('status-panel__error');
  });

  it('documents the recent payload history endpoint', async () => {
    const apiDoc = await readFile('docs/web-api-reference.md');
    expect(apiDoc).toMatch(/GET \/commands\/payloads\/recent/);
    expect(apiDoc).toMatch(/sanitized payload history/i);
    expect(apiDoc).toMatch(/test\/web-documentation-storybook\.test\.js/);
  });
});
