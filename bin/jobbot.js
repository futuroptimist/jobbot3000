#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { summarize as summarizeFirstSentence } from '../src/index.js';
import { fetchTextFromUrl } from '../src/fetch.js';
import { parseJobText } from '../src/parser.js';
import { loadResume } from '../src/resume.js';
import { computeFitScore } from '../src/scoring.js';
import { toJson, toMarkdownSummary, toMarkdownMatch } from '../src/exporters.js';
import { saveJobSnapshot, jobIdFromSource } from '../src/jobs.js';
import { recordApplication, STATUSES } from '../src/lifecycle.js';

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

function getNumberFlag(args, name, fallback) {
  const raw = getFlag(args, name);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function persistJobSnapshot(raw, parsed, source, requestHeaders) {
  if (!source || typeof source.value !== 'string') return;
  try {
    const key = source.type === 'url' ? source.value : `${source.type}:${source.value}`;
    await saveJobSnapshot({
      id: jobIdFromSource(key),
      raw,
      parsed,
      source,
      requestHeaders,
    });
  } catch (err) {
    if (process.env.JOBBOT_DEBUG) {
      const message = err && typeof err.message === 'string' ? err.message : String(err);
      console.error(`jobbot: failed to persist job snapshot: ${message}`);
    }
  }
}

async function cmdSummarize(args) {
  const input = args[0] || '-';
  const format = args.includes('--json')
    ? 'json'
    : args.includes('--text')
      ? 'text'
      : 'md';
  const timeoutMs = getNumberFlag(args, '--timeout', 10000);
  const count = getNumberFlag(args, '--sentences', 1);
  const fetchingRemote = isHttpUrl(input);
  const raw = fetchingRemote
    ? await fetchTextFromUrl(input, { timeoutMs })
    : await readSource(input);
  const parsed = parseJobText(raw);
  const summary = summarizeFirstSentence(raw, count);
  const payload = { ...parsed, summary };
  if (fetchingRemote) {
    await persistJobSnapshot(raw, parsed, { type: 'url', value: input });
  }
  if (format === 'json') console.log(toJson(payload));
  else if (format === 'text') console.log(summary);
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
  const timeoutMs = getNumberFlag(args, '--timeout', 10000);
  const resumePath = args[resumeIdx + 1];
  const jobInput = args[jobIdx + 1];
  const resumeText = await loadResume(resumePath);
  const jobUrl = isHttpUrl(jobInput) ? jobInput : undefined;
  const jobRaw = jobUrl
    ? await fetchTextFromUrl(jobUrl, { timeoutMs })
    : await readSource(jobInput);
  const parsed = parseJobText(jobRaw);
  const { score, matched, missing } = computeFitScore(resumeText, parsed.requirements);

  const payload = { ...parsed, url: jobUrl, score, matched, missing };

  const jobSource = jobUrl
    ? { type: 'url', value: jobUrl }
    : jobInput === '-' || jobInput === '/dev/stdin'
      ? null
      : { type: 'file', value: path.resolve(process.cwd(), jobInput) };
  if (jobSource) {
    await persistJobSnapshot(jobRaw, parsed, jobSource);
  }

  if (format === 'json') console.log(toJson(payload));
  else console.log(toMarkdownMatch(payload));
}

function trackUsage() {
  console.error(
    `Usage: jobbot track add <job_id> --status <status>\n` +
      `Valid statuses: ${STATUSES.join(', ')}`
  );
  process.exit(2);
}

async function cmdTrack(args) {
  const [action, id] = args;
  if (action !== 'add') trackUsage();
  if (!id) trackUsage();
  const status = getFlag(args, '--status');
  if (!status || typeof status !== 'string' || !status.trim()) trackUsage();
  const recorded = await recordApplication(id, status.trim());
  console.log(`Recorded ${id} as ${recorded}`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === 'summarize') return cmdSummarize(args);
  if (cmd === 'match') return cmdMatch(args);
  if (cmd === 'track') return cmdTrack(args);
  console.error('Usage: jobbot <summarize|match|track> [options]');
  process.exit(2);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
