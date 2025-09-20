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
import { recordJobDiscard } from '../src/discards.js';
import { addJobTags, discardJob, filterShortlist, syncShortlistJob } from '../src/shortlist.js';
import { recordInterviewSession, getInterviewSession } from '../src/interviews.js';
import { initProfile } from '../src/profile.js';
import { ingestGreenhouseBoard } from '../src/greenhouse.js';
import { ingestLeverBoard } from '../src/lever.js';

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

function parseMultilineList(value) {
  if (value == null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  const lines = str
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  return lines.length === 1 ? lines[0] : lines;
}

function readContentFromArgs(args, valueFlag, fileFlag) {
  const filePath = getFlag(args, fileFlag);
  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(resolved, 'utf8');
  }
  const value = getFlag(args, valueFlag);
  return value === undefined ? undefined : value;
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

function parseTagsFlag(args) {
  const raw = getFlag(args, '--tags');
  if (!raw) return undefined;
  return String(raw)
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

async function cmdTrackDiscard(args) {
  const jobId = args[0];
  const reason = getFlag(args, '--reason');
  if (!jobId || !reason) {
    console.error(
      'Usage: jobbot track discard <job_id> --reason <reason> [--tags <tag1,tag2>] [--date <date>]'
    );
    process.exit(2);
  }
  const tags = parseTagsFlag(args);
  const date = getFlag(args, '--date');
  await recordJobDiscard(jobId, { reason, tags, date });
  console.log(`Discarded ${jobId}`);
}

async function cmdTrack(args) {
  const sub = args[0];
  if (sub === 'add') return cmdTrackAdd(args.slice(1));
  if (sub === 'log') return cmdTrackLog(args.slice(1));
  if (sub === 'discard') return cmdTrackDiscard(args.slice(1));
  console.error('Usage: jobbot track <add|log|discard> ...');
  process.exit(2);
}

async function cmdIngestGreenhouse(args) {
  const company = getFlag(args, '--company');
  if (!company) {
    console.error('Usage: jobbot ingest greenhouse --company <slug>');
    process.exit(2);
  }

  const { saved } = await ingestGreenhouseBoard({ board: company });
  const noun = saved === 1 ? 'job' : 'jobs';
  console.log(`Imported ${saved} ${noun} from ${company}`);
}

async function cmdIngestLever(args) {
  const company = getFlag(args, '--company') || getFlag(args, '--org');
  if (!company) {
    console.error('Usage: jobbot ingest lever --company <slug>');
    process.exit(2);
  }

  const { saved } = await ingestLeverBoard({ org: company });
  const noun = saved === 1 ? 'job' : 'jobs';
  console.log(`Imported ${saved} ${noun} from ${company}`);
}

async function cmdIngest(args) {
  const sub = args[0];
  if (sub === 'greenhouse') return cmdIngestGreenhouse(args.slice(1));
  if (sub === 'lever') return cmdIngestLever(args.slice(1));
  console.error('Usage: jobbot ingest <greenhouse|lever> --company <slug>');
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
  const rest = args.slice(1);
  const reason = getFlag(rest, '--reason');
  if (!jobId || !reason) {
    console.error(
      'Usage: jobbot shortlist discard <job_id> --reason <reason> [--tags <tag1,tag2>] ' +
        '[--date <date>]'
    );
    process.exit(2);
  }
  const tags = parseTagsFlag(rest);
  const date = getFlag(rest, '--date');
  const entry = await discardJob(jobId, reason, { tags, date });
  console.log(`Discarded ${jobId}: ${entry.reason}`);
}

function hasMetadata(metadata) {
  return Object.values(metadata).some(value => value !== undefined);
}

async function cmdShortlistSync(args) {
  const jobId = args[0];
  const rest = args.slice(1);
  const metadata = {};
  const location = getFlag(rest, '--location');
  if (location) metadata.location = location;
  const level = getFlag(rest, '--level');
  if (level) metadata.level = level;
  const compensation = getFlag(rest, '--compensation');
  if (compensation) metadata.compensation = compensation;
  const syncedAt = getFlag(rest, '--synced-at');
  if (syncedAt) metadata.syncedAt = syncedAt;

  if (!jobId || !hasMetadata(metadata)) {
    console.error(
      'Usage: jobbot shortlist sync <job_id> [--location <value>] [--level <value>] ' +
        '[--compensation <value>] [--synced-at <iso8601>]'
    );
    process.exit(2);
  }

  await syncShortlistJob(jobId, metadata);
  console.log(`Synced ${jobId} metadata`);
}

function formatShortlistList(jobs) {
  const entries = Object.entries(jobs);
  if (entries.length === 0) return 'No shortlist entries found';
  const lines = [];
  for (const [jobId, record] of entries) {
    lines.push(jobId);
    const { metadata = {}, tags = [], discarded = [] } = record;
    if (metadata.location) lines.push(`  Location: ${metadata.location}`);
    if (metadata.level) lines.push(`  Level: ${metadata.level}`);
    if (metadata.compensation) lines.push(`  Compensation: ${metadata.compensation}`);
    if (metadata.synced_at) lines.push(`  Synced At: ${metadata.synced_at}`);
    if (tags.length) lines.push(`  Tags: ${tags.join(', ')}`);
    if (discarded.length) {
      const latest = discarded[discarded.length - 1];
      if (latest?.reason && latest?.discarded_at) {
        lines.push(`  Last Discard: ${latest.reason} (${latest.discarded_at})`);
      }
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

async function cmdShortlistList(args) {
  const filters = {
    location: getFlag(args, '--location'),
    level: getFlag(args, '--level'),
    compensation: getFlag(args, '--compensation'),
  };

  const store = await filterShortlist(filters);
  console.log(formatShortlistList(store.jobs));
}

async function cmdShortlist(args) {
  const sub = args[0];
  if (sub === 'tag') return cmdShortlistTag(args.slice(1));
  if (sub === 'discard') return cmdShortlistDiscard(args.slice(1));
  if (sub === 'sync') return cmdShortlistSync(args.slice(1));
  if (sub === 'list') return cmdShortlistList(args.slice(1));
  console.error('Usage: jobbot shortlist <tag|discard|sync|list> ...');
  process.exit(2);
}

async function cmdInterviewsRecord(args) {
  const jobId = args[0];
  const sessionId = args[1];
  const rest = args.slice(2);

  const transcriptInput = readContentFromArgs(rest, '--transcript', '--transcript-file');
  const reflectionsInput = readContentFromArgs(rest, '--reflections', '--reflections-file');
  const feedbackInput = readContentFromArgs(rest, '--feedback', '--feedback-file');
  const notesInput = readContentFromArgs(rest, '--notes', '--notes-file');

  const stage = getFlag(rest, '--stage');
  const mode = getFlag(rest, '--mode');
  const startedAt = getFlag(rest, '--started-at');
  const endedAt = getFlag(rest, '--ended-at');

  if (!jobId || !sessionId) {
    console.error(
      'Usage: jobbot interviews record <job_id> <session_id> ' +
        '[--stage <value>] [--mode <value>] ' +
        '[--transcript <text>|--transcript-file <path>] ' +
        '[--reflections <text>|--reflections-file <path>] ' +
        '[--feedback <text>|--feedback-file <path>] ' +
        '[--notes <text>|--notes-file <path>] ' +
        '[--started-at <iso8601>] [--ended-at <iso8601>]'
    );
    process.exit(2);
  }

  const payload = {
    transcript: transcriptInput,
    reflections: parseMultilineList(reflectionsInput),
    feedback: parseMultilineList(feedbackInput),
    notes: notesInput,
    stage,
    mode,
    startedAt,
    endedAt,
  };

  const entry = await recordInterviewSession(jobId, sessionId, payload);
  console.log(`Recorded session ${entry.session_id} for ${entry.job_id}`);
}

async function cmdInterviewsShow(args) {
  const jobId = args[0];
  const sessionId = args[1];
  if (!jobId || !sessionId) {
    console.error('Usage: jobbot interviews show <job_id> <session_id>');
    process.exit(2);
  }

  const entry = await getInterviewSession(jobId, sessionId);
  if (!entry) {
    console.error(`No interview session ${sessionId} found for ${jobId}`);
    process.exit(1);
  }

  console.log(JSON.stringify(entry, null, 2));
}

async function cmdInterviews(args) {
  const sub = args[0];
  if (sub === 'record') return cmdInterviewsRecord(args.slice(1));
  if (sub === 'show') return cmdInterviewsShow(args.slice(1));
  console.error('Usage: jobbot interviews <record|show> ...');
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
  if (cmd === 'ingest') return cmdIngest(args);
  if (cmd === 'interviews') return cmdInterviews(args);
  console.error('Usage: jobbot <init|summarize|match|track|shortlist|interviews|ingest> [options]');
  process.exit(2);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
