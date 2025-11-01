#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { summarize } from '../src/index.js';

function printHelp() {
  const message = [
    'Usage: node scripts/summarize-jobs.js [--job <id> ...] [--sentences <count>] [--json]',
    '',
    'Summarize job descriptions stored in $JOBBOT_DATA_DIR/jobs (or ./data/jobs when unset).',
    '',
    'Options:',
    '  --job <id>         Summarize a specific job snapshot (may be repeated).',
    '  --sentences <n>   Number of sentences to include in each summary (default: 2).',
    '  --json            Emit a JSON payload instead of formatted text.',
    '  --help            Show this help message.',
  ];
  console.log(message.join('\n'));
}

function parseArgs(argv) {
  const options = {
    jobIds: [],
    format: 'text',
    sentences: 2,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.format = 'json';
      continue;
    }
    if (arg === '--job') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--job requires a job identifier');
      }
      options.jobIds.push(next);
      i += 1;
      continue;
    }
    if (arg === '--sentences') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--sentences requires a positive number');
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--sentences requires a positive number');
      }
      options.sentences = Math.floor(parsed);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function listAllJobIds(jobsDir) {
  let entries;
  try {
    entries = await fs.readdir(jobsDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b));
}

async function loadJobSnapshot(jobsDir, jobId) {
  const filePath = path.join(jobsDir, `${jobId}.json`);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Job snapshot not found: ${jobId}`);
    }
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err.message || err}`);
  }
}

function extractDescription(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const parsed = snapshot.parsed && typeof snapshot.parsed === 'object' ? snapshot.parsed : {};

  const candidateFields = [
    parsed.summary,
    parsed.overview,
    parsed.body,
    parsed.description,
    snapshot.raw,
  ];
  for (const value of candidateFields) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  if (Array.isArray(parsed.requirements) && parsed.requirements.length > 0) {
    return parsed.requirements.filter(item => typeof item === 'string').join(' ');
  }
  return '';
}

function formatResultText(results) {
  const lines = [];
  for (const result of results) {
    lines.push(`${result.jobId}:`);
    if (result.title) {
      lines.push(`  Title: ${result.title}`);
    }
    if (result.summary) {
      lines.push(`  Summary: ${result.summary}`);
    } else {
      lines.push('  Summary: (no description available)');
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  const dataDir = process.env.JOBBOT_DATA_DIR
    ? path.resolve(process.env.JOBBOT_DATA_DIR)
    : path.resolve('data');
  const jobsDir = path.join(dataDir, 'jobs');

  let jobIds = options.jobIds;
  if (jobIds.length === 0) {
    jobIds = await listAllJobIds(jobsDir);
  }

  if (jobIds.length === 0) {
    console.error('No job snapshots found. Set JOBBOT_DATA_DIR or provide --job <id>.');
    process.exitCode = 1;
    return;
  }

  const uniqueJobIds = Array.from(new Set(jobIds));
  uniqueJobIds.sort((a, b) => a.localeCompare(b));

  const summaries = [];
  for (const jobId of uniqueJobIds) {
    let snapshot;
    try {
      snapshot = await loadJobSnapshot(jobsDir, jobId);
    } catch (err) {
      console.error(err.message || String(err));
      process.exitCode = 1;
      return;
    }
    const description = extractDescription(snapshot);
    const summary = description ? summarize(description, options.sentences) : '';
    const title = typeof snapshot?.parsed?.title === 'string' ? snapshot.parsed.title : undefined;
    summaries.push({ jobId, title, summary });
  }

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        summaries.map(entry => ({
          jobId: entry.jobId,
          title: entry.title ?? null,
          summary: entry.summary,
        })),
        null,
        2,
      ),
    );
    return;
  }

  process.stdout.write(formatResultText(summaries));
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exitCode = 1;
});
