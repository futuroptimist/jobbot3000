#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { summarize as summarizeFirstSentence } from '../src/index.js';
import { fetchTextFromUrl } from '../src/fetch.js';
import { parseJobText } from '../src/parser.js';
import { loadResume } from '../src/resume.js';
import { computeFitScore } from '../src/scoring.js';
import { toJson, toMarkdownSummary, toMarkdownMatch } from '../src/exporters.js';

function isHttpUrl(s) {
  return /^https?:\/\//i.test(s);
}

async function readSource(input) {
  if (isHttpUrl(input)) return fetchTextFromUrl(input);
  if (input === '-' || input === '/dev/stdin') {
    return fs.readFileSync(0, 'utf-8');
  }
  return fs.readFileSync(path.resolve(process.cwd(), input), 'utf-8');
}

function getFlag(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const val = args[idx + 1];
  if (!val || val.startsWith('--')) {
    return typeof fallback === 'boolean' ? true : fallback;
  }
  return val;
}

async function cmdSummarize(args) {
  const input = args[0] || '-';
  const format = args.includes('--json') ? 'json' : 'md';
  const timeoutMs = Number(getFlag(args, '--timeout', 10000));
  const count = Number(getFlag(args, '--sentences', 1));
  const raw = isHttpUrl(input)
    ? await fetchTextFromUrl(input, { timeoutMs })
    : await readSource(input);
  const parsed = parseJobText(raw);
  const summary = summarizeFirstSentence(raw, count);
  const payload = { ...parsed, summary };
  if (format === 'json') console.log(toJson(payload));
  else console.log(toMarkdownSummary(payload));
}

async function cmdMatch(args) {
  const resumeIdx = args.indexOf('--resume');
  if (resumeIdx === -1 || !args[resumeIdx + 1]) {
    console.error('Usage: jobbot match --resume <file> --job <file|url> [--json]');
    process.exit(2);
  }
  const jobIdx = args.indexOf('--job');
  if (jobIdx === -1 || !args[jobIdx + 1]) {
    console.error('Usage: jobbot match --resume <file> --job <file|url> [--json]');
    process.exit(2);
  }
  const format = args.includes('--json') ? 'json' : 'md';
  const timeoutMs = Number(getFlag(args, '--timeout', 10000));
  const resumePath = args[resumeIdx + 1];
  const jobInput = args[jobIdx + 1];
  const resumeText = await loadResume(resumePath);
  const jobRaw = isHttpUrl(jobInput)
    ? await fetchTextFromUrl(jobInput, { timeoutMs })
    : await readSource(jobInput);
  const parsed = parseJobText(jobRaw);
  const { score, matched, missing } = computeFitScore(resumeText, parsed.requirements);
  const payload = { ...parsed, score, matched, missing };
  if (format === 'json') console.log(toJson(payload));
  else console.log(toMarkdownMatch(payload));
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === 'summarize') return cmdSummarize(args);
  if (cmd === 'match') return cmdMatch(args);
  console.error('Usage: jobbot <summarize|match> [options]');
  process.exit(2);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});


