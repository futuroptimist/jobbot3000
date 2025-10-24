import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function readUserJourneys() {
  const filePath = path.join(repoRoot, 'docs/user-journeys.md');
  return fs.readFile(filePath, 'utf8');
}

describe('user journeys documentation', () => {
  it('documents the ingestion → scoring → notifications flow diagram', async () => {
    const markdown = await readUserJourneys();

    expect(markdown).toMatch(/```mermaid[\s\S]*journey-ingestion-scoring-notifications/);
    expect(markdown).toMatch(/Ingestion\["Ingestion/);
    expect(markdown).toMatch(/Scoring\["Scoring/);
    expect(markdown).toMatch(/Notifications\["Notifications/);
    expect(markdown).toMatch(/Notifications -->\|Weekly digest\|/);
  });
});
