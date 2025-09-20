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
import { logApplicationEvent } from '../src/application-events.js';
import { recordApplication, STATUSES } from '../src/lifecycle.js';
import { addJobTags, discardJob } from '../src/shortlist.js';
import { initProfile } from '../src/profile.js';

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

async function cmdTrackAdd(args) {
  const jobId = args[0];
  const status = getFlag(args, '--status');
  if (!jobId || !status) {
    console.error(
      `Usage: jobbot track add <job_id> --status <status>\n` +
        `Valid statuses: ${STATUSES.join(', ')}`
    );
    process.exit(2);
  }
  const recorded = await recordApplication(jobId, status.trim());
  console.log(`Recorded ${jobId} as ${recorded}`);
}

function parseDocumentsFlag(args) {
  const raw = getFlag(args, '--documents');
  if (!raw) return undefined;
  return String(raw)
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

async function cmdTrackLog(args) {
  const jobId = args[0];
  const channel = getFlag(args, '--channel');
  if (!jobId || !channel) {
    console.error(
      'Usage: jobbot track log <job_id> --channel <channel> [--date <date>] ' +
        '[--contact <contact>] [--documents <file1,file2>] [--note <note>]'
    );
    process.exit(2);
  }
  const date = getFlag(args, '--date');
  const contact = getFlag(args, '--contact');
  const note = getFlag(args, '--note');
  const documents = parseDocumentsFlag(args);
  await logApplicationEvent(jobId, { channel, date, contact, note, documents });
  console.log(`Logged ${jobId} event ${channel}`);
}

async function cmdTrack(args) {
  const sub = args[0];
  if (sub === 'add') return cmdTrackAdd(args.slice(1));
  if (sub === 'log') return cmdTrackLog(args.slice(1));
  console.error('Usage: jobbot track <add|log> ...');
  process.exit(2);
}

async function cmdShortlistTag(args) {
  const [jobId, ...tagArgs] = args;
  if (!jobId || tagArgs.length === 0) {
    console.error('Usage: jobbot shortlist tag <job_id> <tag> [tag ...]');
    process.exit(2);
  }
  const tags = tagArgs.map(tag => String(tag));
  const allTags = await addJobTags(jobId, tags);
  console.log(`Tagged ${jobId} with ${allTags.join(', ')}`);
}

async function cmdShortlistDiscard(args) {
  const jobId = args[0];
  const reason = getFlag(args.slice(1), '--reason');
  if (!jobId || !reason) {
    console.error('Usage: jobbot shortlist discard <job_id> --reason <reason>');
    process.exit(2);
  }
  const entry = await discardJob(jobId, reason);
  console.log(`Discarded ${jobId}: ${entry.reason}`);
}

async function cmdShortlist(args) {
  const sub = args[0];
  if (sub === 'tag') return cmdShortlistTag(args.slice(1));
  if (sub === 'discard') return cmdShortlistDiscard(args.slice(1));
  console.error('Usage: jobbot shortlist <tag|discard> ...');
  process.exit(2);
}

async function cmdInit(args) {
  const force = args.includes('--force');
  const { created, path: resumePath } = await initProfile({ force });
  if (created) console.log(`Initialized profile at ${resumePath}`);
  else console.log(`Profile already exists at ${resumePath}`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'summarize') return cmdSummarize(args);
  if (cmd === 'match') return cmdMatch(args);
  if (cmd === 'track') return cmdTrack(args);
  if (cmd === 'shortlist') return cmdShortlist(args);
  console.error('Usage: jobbot <init|summarize|match|track|shortlist> [options]');
  process.exit(2);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
