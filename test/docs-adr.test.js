import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ADR_DIR = path.join(process.cwd(), 'docs', 'architecture-decisions');

async function readJson(filePath) {
  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents);
}

describe('architecture decisions log', () => {
  it('tracks accepted ADR entries with required metadata and markdown sections', async () => {
    await expect(fs.access(ADR_DIR)).resolves.toBeUndefined();

    const indexPath = path.join(ADR_DIR, 'index.json');
    const entries = await readJson(indexPath);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    const acceptedEntries = entries.filter(entry => entry.status === 'Accepted');
    expect(acceptedEntries.length).toBeGreaterThan(0);

    const statusHubEntry = acceptedEntries.find(
      entry => entry.slug === 'status-hub-event-payloads',
    );
    expect(statusHubEntry).toBeDefined();
    expect(statusHubEntry).toMatchObject({
      id: 'ADR-0001',
      summary: expect.stringContaining('statusLabel'),
      tests: expect.arrayContaining(['test/web-server.test.js']),
    });

    const markdownPath = path.join(ADR_DIR, `${statusHubEntry.slug}.md`);
    const markdown = await fs.readFile(markdownPath, 'utf8');
    expect(markdown).toContain('# ADR-0001');
    expect(markdown).toContain('## Context');
    expect(markdown).toContain('## Decision');
    expect(markdown).toContain('## Consequences');
  });
});
