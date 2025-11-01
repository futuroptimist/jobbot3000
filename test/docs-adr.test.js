import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ADR_DIR = path.join(process.cwd(), 'docs', 'architecture-decisions');

async function readJson(filePath) {
  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents);
}

function tableCells(line) {
  if (!line.includes('|')) {
    return null;
  }

  const cells = line
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim());

  if (cells.length === 0) {
    return null;
  }

  return cells;
}

function normalizeTableRow(line) {
  const cells = tableCells(line);
  if (!cells) {
    return null;
  }

  return `| ${cells.join(' | ')} |`;
}

function isDividerRow(line) {
  const cells = tableCells(line);
  return Boolean(cells?.every(cell => /^-+$/.test(cell)));
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

  it('lists every ADR entry in the README index table', async () => {
    const indexPath = path.join(ADR_DIR, 'index.json');
    const entries = await readJson(indexPath);
    expect(entries.length).toBeGreaterThan(0);

    const readmePath = path.join(ADR_DIR, 'README.md');
    const readme = await fs.readFile(readmePath, 'utf8');

    const normalizedRows = readme
      .split('\n')
      .map(normalizeTableRow)
      .filter(Boolean);

    expect(normalizedRows).toContain('| ADR ID | Title | Status | Decided | Summary |');
    expect(readme.split('\n').some(isDividerRow)).toBe(true);

    for (const entry of entries) {
      const expectedRow =
        `| [${entry.id}](./${entry.slug}.md) | ${entry.title} | ${entry.status} | ` +
        `${entry.decidedAt} | ${entry.summary} |`;
      expect(normalizedRows).toContain(normalizeTableRow(expectedRow));
    }
  });
});
