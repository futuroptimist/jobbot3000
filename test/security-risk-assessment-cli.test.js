import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = path.resolve(__dirname, '..', 'scripts', 'generate-risk-assessment.js');

function createTempConfig(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), 'risk-assessment-'));
  const filePath = path.join(dir, 'config.json');
  writeFileSync(filePath, JSON.stringify(contents, null, 2));
  return filePath;
}

describe('generate-risk-assessment CLI', () => {
  const baseConfig = {
    feature: 'CLI smoke test feature',
    summary: 'Exercise the CLI end to end.',
    dataClassification: 'Internal',
    assets: ['status hub UI'],
    entryPoints: ['POST /commands/demo'],
    threatActors: ['Bug bounty researcher'],
    scenarios: [
      {
        id: 'demo',
        title: 'Demo scenario',
        category: 'Repudiation',
        description: 'Attacker claims a command they executed was spoofed.',
        impact: 'medium',
        likelihood: 'medium',
      },
    ],
    mitigations: {
      mustHave: ['Record command correlation IDs in audit log'],
    },
    residualRisk: 'Operators must monitor audit log rotation schedules.',
    references: ['docs/web-operational-playbook.md'],
  };

  it('prints Markdown to stdout when output is omitted', () => {
    const configPath = createTempConfig(baseConfig);
    const result = spawnSync('node', [scriptPath, '--config', configPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/# Risk assessment: CLI smoke test feature/);
    expect(result.stdout).toMatch(/Repudiation/);
    expect(result.stderr).toBe('');
  });

  it('writes Markdown to a file when --output is provided', () => {
    const configPath = createTempConfig(baseConfig);
    const outputDir = mkdtempSync(path.join(tmpdir(), 'risk-assessment-out-'));
    const outputPath = path.join(outputDir, 'report.md');

    const result = spawnSync(
      'node',
      [scriptPath, '--config', configPath, '--output', outputPath],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Wrote risk assessment to/);

    const written = readFileSync(outputPath, 'utf8');
    expect(written).toMatch(/Risk assessment: CLI smoke test feature/);
    expect(written).toMatch(/command correlation IDs/);
  });

  it('fails with a useful error when the config is missing', () => {
    const result = spawnSync('node', [scriptPath], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--config is required/);
  });
});
