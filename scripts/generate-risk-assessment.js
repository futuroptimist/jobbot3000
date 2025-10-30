#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  createRiskAssessment,
  formatRiskAssessmentMarkdown,
} from '../src/shared/security/risk-assessment.js';

function printUsage() {
  const message = `Usage: node scripts/generate-risk-assessment.js --config <path> [--output <path>]

Options:
  --config <path>   JSON file describing the feature, threat model, and scenarios.
  --output <path>   Optional file to write the generated Markdown risk assessment.
  --help            Show this message.
`;
  process.stdout.write(message);
}

function parseArgs(argv) {
  const result = { config: null, output: null }; 
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help') {
      printUsage();
      process.exit(0);
    }
    if (value === '--config') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--config requires a path argument');
      }
      result.config = next;
      index += 1;
      continue;
    }
    if (value === '--output') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--output requires a path argument');
      }
      result.output = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

async function loadConfig(configPath) {
  const absolute = path.resolve(process.cwd(), configPath);
  const contents = await fs.readFile(absolute, 'utf8');
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${absolute}: ${error.message}`);
  }
}

async function writeOutput(outputPath, markdown) {
  const absolute = path.resolve(process.cwd(), outputPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `${markdown}\n`, 'utf8');
  return absolute;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.config) {
      printUsage();
      throw new Error('--config is required');
    }
    const config = await loadConfig(args.config);
    const assessment = createRiskAssessment(config);
    const markdown = formatRiskAssessmentMarkdown(assessment);
    if (args.output) {
      const written = await writeOutput(args.output, markdown);
      process.stdout.write(`Wrote risk assessment to ${written}\n`);
    } else {
      process.stdout.write(`${markdown}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
