#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { summarize as summarizeFirstSentence } from '../src/index.js';
import { fetchTextFromUrl, DEFAULT_FETCH_HEADERS } from '../src/fetch.js';
import { parseJobText } from '../src/parser.js';
import { loadResume } from '../src/resume.js';
import { computeFitScore } from '../src/scoring.js';
import {
  toJson,
  toMarkdownSummary,
  toMarkdownMatch,
  formatMatchExplanation,
  toMarkdownMatchExplanation,
  toDocxSummary,
  toDocxMatch,
} from '../src/exporters.js';
import { saveJobSnapshot, jobIdFromSource } from '../src/jobs.js';
import {
  logApplicationEvent,
  getApplicationEvents,
  getApplicationReminders,
} from '../src/application-events.js';
import { recordApplication, STATUSES } from '../src/lifecycle.js';
import {
  getDiscardedJobs,
  normalizeDiscardEntries,
  normalizeDiscardArchive,
} from '../src/discards.js';
import { addJobTags, discardJob, filterShortlist, syncShortlistJob } from '../src/shortlist.js';
import {
  recordInterviewSession,
  getInterviewSession,
  generateRehearsalPlan,
} from '../src/interviews.js';
import { initProfile, importLinkedInProfile } from '../src/profile.js';
import {
  recordIntakeResponse,
  getIntakeResponses,
  getIntakeBulletOptions,
} from '../src/intake.js';
import { ingestGreenhouseBoard } from '../src/greenhouse.js';
import { ingestLeverBoard } from '../src/lever.js';
import { ingestSmartRecruitersBoard } from '../src/smartrecruiters.js';
import { ingestAshbyBoard } from '../src/ashby.js';
import { computeFunnel, exportAnalyticsSnapshot, formatFunnelReport } from '../src/analytics.js';
import { ingestWorkableBoard } from '../src/workable.js';
import { ingestJobUrl } from '../src/url-ingest.js';
import { bundleDeliverables } from '../src/deliverables.js';

function isHttpUrl(s) {
  return /^https?:\/\//i.test(s);
}

async function readSource(input) {
  if (isHttpUrl(input)) return fetchTextFromUrl(input, { headers: DEFAULT_FETCH_HEADERS });
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

const CURRENCY_SYMBOL_RE = /^\p{Sc}/u;
const DEFAULT_SHORTLIST_CURRENCY = process.env.JOBBOT_SHORTLIST_CURRENCY
  ? process.env.JOBBOT_SHORTLIST_CURRENCY.trim()
  : '$';

function normalizeCompensation(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (CURRENCY_SYMBOL_RE.test(trimmed)) return trimmed;
  if (!/^\d/.test(trimmed)) return trimmed;
  const simpleNumeric = /^\d[\d.,]*(?:\s?(?:k|m|b))?$/i;
  if (!simpleNumeric.test(trimmed)) return trimmed;
  const symbol = DEFAULT_SHORTLIST_CURRENCY || '$';
  return `${symbol}${trimmed}`;
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

function generateRehearsalSessionId() {
  const iso = new Date().toISOString().replace(/\.(\d{3})Z$/, 'Z');
  const sanitized = iso.replace(/:/g, '-');
  return `prep-${sanitized}`;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function resolveRehearsalStage(args) {
  const explicit = getFlag(args, '--stage');
  if (explicit) return explicit;
  if (hasFlag(args, '--behavioral')) return 'Behavioral';
  if (hasFlag(args, '--technical')) return 'Technical';
  if (hasFlag(args, '--system-design')) return 'System Design';
  if (hasFlag(args, '--onsite')) return 'Onsite';
  if (hasFlag(args, '--screen')) return 'Screen';
  return undefined;
}

function resolveRehearsalMode(args) {
  const explicit = getFlag(args, '--mode');
  if (explicit) return explicit;
  if (hasFlag(args, '--voice')) return 'Voice';
  if (hasFlag(args, '--text')) return 'Text';
  if (hasFlag(args, '--in-person')) return 'In-Person';
  if (hasFlag(args, '--virtual')) return 'Virtual';
  return undefined;
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

async function writeDocxFile(targetPath, buffer) {
  if (!targetPath) return;
  const resolved = path.resolve(process.cwd(), targetPath);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, buffer);
}

async function cmdSummarize(args) {
  const usage =
    'Usage: jobbot summarize <file|url|-> [--json] [--text] [--sentences <count>] ' +
    '[--docx <path>] [--locale <code>]';
  const input = args[0] || '-';
  const format = args.includes('--json')
    ? 'json'
    : args.includes('--text')
      ? 'text'
      : 'md';
  const docxSpecified = args.includes('--docx');
  const docxPath = getFlag(args, '--docx');
  if (docxSpecified && !docxPath) {
    console.error(usage);
    process.exit(2);
  }
  const localeSpecified = args.includes('--locale');
  const localeFlag = getFlag(args, '--locale');
  const locale = typeof localeFlag === 'string' ? localeFlag.trim() : localeFlag;
  if (localeSpecified && !locale) {
    console.error(usage);
    process.exit(2);
  }
  const timeoutMs = getNumberFlag(args, '--timeout', 10000);
  const count = getNumberFlag(args, '--sentences', 1);
  const fetchingRemote = isHttpUrl(input);
  const requestHeaders = fetchingRemote ? { ...DEFAULT_FETCH_HEADERS } : undefined;
  const raw = fetchingRemote
    ? await fetchTextFromUrl(input, { timeoutMs, headers: requestHeaders })
    : await readSource(input);
  const parsed = parseJobText(raw);
  const summary = summarizeFirstSentence(raw, count);
  const payload = { ...parsed, summary };
  if (locale) payload.locale = locale;
  if (fetchingRemote) {
    await persistJobSnapshot(raw, parsed, { type: 'url', value: input }, requestHeaders);
  }
  const localizedPayload = locale ? { ...payload, locale } : payload;
  if (docxPath) {
    const buffer = await toDocxSummary(localizedPayload);
    await writeDocxFile(docxPath, buffer);
  }
  if (format === 'json') console.log(toJson(payload));
  else if (format === 'text') console.log(summary);
  else console.log(toMarkdownSummary(localizedPayload));
}

async function cmdMatch(args) {
  const resumeIdx = args.indexOf('--resume');
  const usage =
    'Usage: jobbot match --resume <file> --job <file|url> [--json] [--explain] ' +
    '[--docx <path>] [--locale <code>]';
  if (resumeIdx === -1 || !args[resumeIdx + 1]) {
    console.error(usage);
    process.exit(2);
  }
  const jobIdx = args.indexOf('--job');
  if (jobIdx === -1 || !args[jobIdx + 1]) {
    console.error(usage);
    process.exit(2);
  }
  const format = args.includes('--json') ? 'json' : 'md';
  const explain = args.includes('--explain');
  const docxSpecified = args.includes('--docx');
  const docxPath = getFlag(args, '--docx');
  if (docxSpecified && !docxPath) {
    console.error(usage);
    process.exit(2);
  }
  const localeSpecified = args.includes('--locale');
  const localeFlag = getFlag(args, '--locale');
  const locale = typeof localeFlag === 'string' ? localeFlag.trim() : localeFlag;
  if (localeSpecified && !locale) {
    console.error(usage);
    process.exit(2);
  }
  const timeoutMs = getNumberFlag(args, '--timeout', 10000);
  const resumePath = args[resumeIdx + 1];
  const jobInput = args[jobIdx + 1];
  const resumeText = await loadResume(resumePath);
  const jobUrl = isHttpUrl(jobInput) ? jobInput : undefined;
  const requestHeaders = jobUrl ? { ...DEFAULT_FETCH_HEADERS } : undefined;
  const jobRaw = jobUrl
    ? await fetchTextFromUrl(jobUrl, { timeoutMs, headers: requestHeaders })
    : await readSource(jobInput);
  const parsed = parseJobText(jobRaw);
  const { score, matched, missing, must_haves_missed, keyword_overlap } = computeFitScore(
    resumeText,
    parsed.requirements,
  );

  const payload = {
    ...parsed,
    url: jobUrl,
    score,
    matched,
    missing,
    must_haves_missed,
    keyword_overlap,
  };
  if (locale) payload.locale = locale;

  const jobSource = jobUrl
    ? { type: 'url', value: jobUrl }
    : jobInput === '-' || jobInput === '/dev/stdin'
      ? null
      : { type: 'file', value: path.resolve(process.cwd(), jobInput) };
  if (jobSource) {
    await persistJobSnapshot(jobRaw, parsed, jobSource, requestHeaders);
  }

  const localizedPayload = locale ? { ...payload, locale } : payload;

  if (docxPath) {
    const buffer = await toDocxMatch(localizedPayload);
    await writeDocxFile(docxPath, buffer);
  }

  if (format === 'json') {
    const jsonPayload = explain
      ? { ...payload, explanation: formatMatchExplanation(localizedPayload) }
      : payload;
    console.log(toJson(jsonPayload));
  } else {
    const report = toMarkdownMatch(localizedPayload);
    if (!explain) {
      console.log(report);
    } else {
      const explanationMd = toMarkdownMatchExplanation(localizedPayload);
      console.log(report ? `${report}\n\n${explanationMd}` : explanationMd);
    }
  }
}

async function cmdTrackAdd(args) {
  const jobId = args[0];
  const status = getFlag(args, '--status');
  const usage =
    `Usage: jobbot track add <job_id> --status <status>\n` +
    `Valid statuses: ${STATUSES.join(', ')}\n` +
    'Optional: --note <note>';
  if (!jobId || !status) {
    console.error(usage);
    process.exit(2);
  }

  const noteFlagIndex = args.indexOf('--note');
  if (noteFlagIndex !== -1) {
    const next = args[noteFlagIndex + 1];
    if (!next || next.startsWith('--')) {
      console.error(usage);
      process.exit(2);
    }
  }

  const note = getFlag(args, '--note');
  try {
    const recorded = await recordApplication(jobId, status.trim(), { note });
    console.log(`Recorded ${jobId} as ${recorded}`);
  } catch (err) {
    if (err && /note cannot be empty/i.test(String(err.message))) {
      console.error('Note cannot be empty');
      process.exit(2);
    }
    throw err;
  }
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
        '[--contact <contact>] [--documents <file1,file2>] [--note <note>] ' +
        '[--remind-at <iso8601>]'
    );
    process.exit(2);
  }
  const date = getFlag(args, '--date');
  const contact = getFlag(args, '--contact');
  const note = getFlag(args, '--note');
  const remindAt = getFlag(args, '--remind-at');
  const documents = parseDocumentsFlag(args);
  await logApplicationEvent(jobId, { channel, date, contact, note, documents, remindAt });
  console.log(`Logged ${jobId} event ${channel}`);
}

async function cmdTrackHistory(args) {
  const jobId = args[0];
  if (!jobId) {
    console.error('Usage: jobbot track history <job_id> [--json]');
    process.exit(2);
  }

  let events;
  try {
    events = await getApplicationEvents(jobId);
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({ job_id: jobId, events }, null, 2));
    return;
  }

  if (!events || events.length === 0) {
    console.log(`No history for ${jobId}`);
    return;
  }

  const lines = [jobId];
  for (const event of events) {
    const timestamp =
      typeof event.date === 'string' && event.date ? event.date : undefined;
    const channel =
      typeof event.channel === 'string' && event.channel && event.channel.trim()
        ? event.channel.trim()
        : 'unknown';
    const header = timestamp ? `${channel} (${timestamp})` : channel;
    lines.push(`- ${header}`);
    if (event.contact) lines.push(`  Contact: ${event.contact}`);
    if (Array.isArray(event.documents) && event.documents.length > 0) {
      lines.push(`  Documents: ${event.documents.join(', ')}`);
    }
    if (event.note) lines.push(`  Note: ${event.note}`);
    if (event.remind_at) lines.push(`  Reminder: ${event.remind_at}`);
  }

  console.log(lines.join('\n'));
}

async function cmdTrackReminders(args) {
  const asJson = args.includes('--json');
  const nowValue = getFlag(args, '--now');
  const upcomingOnly = args.includes('--upcoming-only');

  let reminders;
  try {
    reminders = await getApplicationReminders({
      now: nowValue,
      includePastDue: !upcomingOnly,
    });
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify({ reminders }, null, 2));
    return;
  }

  if (reminders.length === 0) {
    console.log('No reminders scheduled');
    return;
  }

  const lines = [];
  for (const reminder of reminders) {
    const descriptors = [];
    if (reminder.channel) descriptors.push(reminder.channel);
    descriptors.push(reminder.past_due ? 'past due' : 'upcoming');
    lines.push(`${reminder.job_id} — ${reminder.remind_at} (${descriptors.join(', ')})`);
    if (reminder.note) lines.push(`  Note: ${reminder.note}`);
    if (reminder.contact) lines.push(`  Contact: ${reminder.contact}`);
  }

  console.log(lines.join('\n'));
}

function parseTagsFlag(args) {
  const raw = getFlag(args, '--tags');
  if (!raw) return undefined;
  return String(raw)
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function collectTagFilters(args) {
  const tags = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--tag') continue;
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      console.error(
        'Usage: jobbot shortlist list [--location <value>] [--level <value>] ' +
          '[--compensation <value>] [--tag <value>] [--json] [--out <path>]'
      );
      process.exit(2);
    }
    for (const entry of String(value).split(',')) {
      const trimmed = entry.trim();
      if (trimmed) tags.push(trimmed);
    }
    i++;
  }
  return tags.length > 0 ? tags : undefined;
}

function formatIntakeList(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 'No intake responses found';
  }
  const lines = [];
  for (const entry of entries) {
    lines.push(entry.question);
    const status = typeof entry.status === 'string' ? entry.status : 'answered';
    if (status === 'skipped') {
      lines.push('  Status: Skipped');
      lines.push('  Answer: (skipped)');
    } else {
      lines.push(`  Answer: ${entry.answer}`);
    }
    if (entry.tags && entry.tags.length > 0) {
      lines.push(`  Tags: ${entry.tags.join(', ')}`);
    }
    if (entry.notes) {
      lines.push(`  Notes: ${entry.notes}`);
    }
    if (entry.asked_at) {
      lines.push(`  Asked At: ${entry.asked_at}`);
    }
    if (entry.recorded_at) {
      lines.push(`  Recorded At: ${entry.recorded_at}`);
    }
    if (entry.id) {
      lines.push(`  ID: ${entry.id}`);
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}

function collectRepeatableFlag(args, flag, { usage }) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== flag) continue;
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      if (usage) {
        console.error(usage);
        process.exit(2);
      }
      continue;
    }
    for (const entry of String(value).split(',')) {
      const trimmed = entry.trim();
      if (trimmed) values.push(trimmed);
    }
    i += 1;
  }
  return values;
}

function formatIntakeBullets(bullets) {
  if (!Array.isArray(bullets) || bullets.length === 0) {
    return 'No bullet suggestions found';
  }
  const lines = [];
  for (const bullet of bullets) {
    lines.push(bullet.text);
    if (Array.isArray(bullet.tags) && bullet.tags.length > 0) {
      lines.push(`  Tags: ${bullet.tags.join(', ')}`);
    }
    if (bullet.notes) {
      lines.push(`  Notes: ${bullet.notes}`);
    }
    if (bullet.source?.question) {
      lines.push(`  Question: ${bullet.source.question}`);
    }
    if (bullet.source?.response_id) {
      lines.push(`  Response ID: ${bullet.source.response_id}`);
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

async function cmdIntakeRecord(args) {
  const skip = args.includes('--skip');
  const question = readContentFromArgs(args, '--question', '--question-file');
  const answer = readContentFromArgs(args, '--answer', '--answer-file');
  if (!question || (!skip && !answer)) {
    console.error(
      'Usage: jobbot intake record --question <text> [--answer <text>|--answer-file <path>] ' +
        '[--skip] [--tags <tag1,tag2>] [--notes <text>|--notes-file <path>] [--asked-at <iso8601>]'
    );
    process.exit(2);
  }
  const tags = parseTagsFlag(args);
  const notes = readContentFromArgs(args, '--notes', '--notes-file');
  const askedAt = getFlag(args, '--asked-at');
  const payload = { question, tags, notes, askedAt, skipped: skip };
  if (!skip) payload.answer = answer;
  const entry = await recordIntakeResponse(payload);
  console.log(`Recorded intake response ${entry.id}`);
}

async function cmdIntakeList(args) {
  const asJson = args.includes('--json');
  const skippedOnly = args.includes('--skipped-only');
  const filters = skippedOnly ? { status: 'skipped' } : undefined;
  const entries = await getIntakeResponses(filters);
  if (asJson) {
    console.log(JSON.stringify({ responses: entries }, null, 2));
    return;
  }
  if (!entries.length) {
    console.log(skippedOnly ? 'No skipped intake responses found' : 'No intake responses found');
    return;
  }
  console.log(formatIntakeList(entries));
}

async function cmdIntakeBullets(args) {
  const asJson = args.includes('--json');
  const tags = collectRepeatableFlag(args, '--tag', {
    usage: 'Usage: jobbot intake bullets [--tag <value>] [--json]',
  });

  let bullets;
  try {
    bullets = await getIntakeBulletOptions({ tags: tags.length ? tags : undefined });
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify({ bullets }, null, 2));
    return;
  }

  console.log(formatIntakeBullets(bullets));
}

async function cmdIntake(args) {
  const sub = args[0];
  if (sub === 'record') return cmdIntakeRecord(args.slice(1));
  if (sub === 'list') return cmdIntakeList(args.slice(1));
  if (sub === 'bullets') return cmdIntakeBullets(args.slice(1));
  console.error('Usage: jobbot intake <record|list> ...');
  process.exit(2);
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
  const entry = await discardJob(jobId, reason, { tags, date });
  console.log(`Discarded ${jobId}: ${entry.reason}`);
}

async function cmdTrack(args) {
  const sub = args[0];
  if (sub === 'add') return cmdTrackAdd(args.slice(1));
  if (sub === 'log') return cmdTrackLog(args.slice(1));
  if (sub === 'history') return cmdTrackHistory(args.slice(1));
  if (sub === 'discard') return cmdTrackDiscard(args.slice(1));
  if (sub === 'reminders') return cmdTrackReminders(args.slice(1));
  console.error('Usage: jobbot track <add|log|history|discard|reminders> ...');
  process.exit(2);
}

async function cmdIngestGreenhouse(args) {
  const company = getFlag(args, '--company');
  if (!company) {
    console.error('Usage: jobbot ingest greenhouse --company <slug>');
    process.exit(2);
  }

  const { saved, notModified } = await ingestGreenhouseBoard({ board: company });
  if (notModified) {
    console.log(`Greenhouse board ${company} unchanged since last sync`);
    return;
  }
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

async function cmdIngestAshby(args) {
  const company = getFlag(args, '--company') || getFlag(args, '--org');
  if (!company) {
    console.error('Usage: jobbot ingest ashby --company <slug>');
    process.exit(2);
  }

  const { saved } = await ingestAshbyBoard({ org: company });
  const noun = saved === 1 ? 'job' : 'jobs';
  console.log(`Imported ${saved} ${noun} from ${company}`);
}

async function cmdIngestSmartRecruiters(args) {
  const company = getFlag(args, '--company');
  if (!company) {
    console.error('Usage: jobbot ingest smartrecruiters --company <slug>');
    process.exit(2);
  }

  const { saved } = await ingestSmartRecruitersBoard({ company });
  const noun = saved === 1 ? 'job' : 'jobs';
  console.log(`Imported ${saved} ${noun} from ${company}`);
}

async function cmdIngestWorkable(args) {
  const account = getFlag(args, '--company') || getFlag(args, '--account');
  if (!account) {
    console.error('Usage: jobbot ingest workable --company <slug>');
    process.exit(2);
  }

  const { saved } = await ingestWorkableBoard({ account });
  const noun = saved === 1 ? 'job' : 'jobs';
  console.log(`Imported ${saved} ${noun} from ${account}`);
}

async function cmdIngestUrl(args) {
  const targetUrl = args[0];
  const rest = args.slice(1);
  if (!targetUrl) {
    console.error('Usage: jobbot ingest url <url> [--timeout <ms>]');
    process.exit(2);
  }

  const timeoutMs = getNumberFlag(rest, '--timeout', 10000);

  try {
    const { id } = await ingestJobUrl({ url: targetUrl, timeoutMs });
    console.log(`Imported job ${id} from ${targetUrl}`);
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }
}

async function cmdIngest(args) {
  const sub = args[0];
  if (sub === 'greenhouse') return cmdIngestGreenhouse(args.slice(1));
  if (sub === 'lever') return cmdIngestLever(args.slice(1));
  if (sub === 'ashby') return cmdIngestAshby(args.slice(1));
  if (sub === 'smartrecruiters') return cmdIngestSmartRecruiters(args.slice(1));
  if (sub === 'workable') return cmdIngestWorkable(args.slice(1));
  if (sub === 'url') return cmdIngestUrl(args.slice(1));
  console.error(
    'Usage: jobbot ingest <greenhouse|lever|ashby|smartrecruiters|workable> --company <slug>',
  );
  console.error('   or: jobbot ingest url <url> [--timeout <ms>]');
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
  const compensation = normalizeCompensation(getFlag(rest, '--compensation'));
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
    const normalizedDiscard = normalizeDiscardEntries(discarded);
    if (normalizedDiscard.length > 0) {
      const latest = normalizedDiscard[0];
      const reason = latest.reason || 'Unknown reason';
      const timestamp = latest.discarded_at || 'unknown time';
      lines.push(`  Last Discard: ${reason} (${timestamp})`);
      if (latest.tags && latest.tags.length > 0) {
        lines.push(`  Last Discard Tags: ${latest.tags.join(', ')}`);
      }
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function formatDiscardTimestamp(timestamp) {
  return timestamp === 'unknown time' ? '(unknown time)' : timestamp;
}

function formatDiscardHistory(jobId, entries) {
  const normalized = normalizeDiscardEntries(entries);
  if (normalized.length === 0) {
    return `No discard history for ${jobId}`;
  }
  const lines = [jobId];
  for (const entry of normalized) {
    const timestamp = formatDiscardTimestamp(entry.discarded_at);
    lines.push(`- ${timestamp} — ${entry.reason}`);
    if (entry.tags && entry.tags.length > 0) {
      lines.push(`  Tags: ${entry.tags.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function formatDiscardArchive(archive) {
  const normalized = normalizeDiscardArchive(archive);
  const jobIds = Object.keys(normalized);
  if (jobIds.length === 0) return 'No discarded jobs found';
  const lines = [];
  for (const jobId of jobIds) {
    const entries = normalized[jobId];
    if (!entries || entries.length === 0) continue;
    lines.push(jobId);
    for (const entry of entries) {
      const timestamp = formatDiscardTimestamp(entry.discarded_at);
      lines.push(`- ${timestamp} — ${entry.reason}`);
      if (entry.tags && entry.tags.length > 0) {
        lines.push(`  Tags: ${entry.tags.join(', ')}`);
      }
    }
    lines.push('');
  }
  if (lines.length === 0) return 'No discarded jobs found';
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

async function cmdShortlistList(args) {
  const asJson = args.includes('--json');
  const outPath = getFlag(args, '--out');
  const filteredArgs = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (arg === '--out') {
      i += 1;
      continue;
    }
    filteredArgs.push(arg);
  }

  if (outPath && !asJson) {
    console.error('--out is only supported with --json');
    process.exit(2);
  }

  const filters = {
    location: getFlag(filteredArgs, '--location'),
    level: getFlag(filteredArgs, '--level'),
    compensation: normalizeCompensation(getFlag(filteredArgs, '--compensation')),
  };
  const tagFilters = collectTagFilters(filteredArgs);
  if (tagFilters) filters.tags = tagFilters;

  const store = await filterShortlist(filters);
  if (asJson) {
    const payload = { jobs: store.jobs };
    if (outPath) {
      const resolved = path.resolve(process.cwd(), outPath);
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
      await fs.promises.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      console.log(`Saved shortlist snapshot to ${resolved}`);
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }
  console.log(formatShortlistList(store.jobs));
}

async function cmdShortlistArchive(args) {
  const asJson = args.includes('--json');
  const filtered = args.filter(arg => arg !== '--json');
  const jobId = filtered[0];

  try {
    if (jobId) {
      const history = await getDiscardedJobs(jobId);
      if (asJson) {
        console.log(JSON.stringify({ job_id: jobId, history }, null, 2));
      } else {
        console.log(formatDiscardHistory(jobId, history));
      }
      return;
    }

    const archive = await getDiscardedJobs();
    if (asJson) {
      console.log(JSON.stringify({ discarded: archive }, null, 2));
    } else {
      console.log(formatDiscardArchive(archive));
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }
}

async function cmdShortlist(args) {
  const sub = args[0];
  if (sub === 'tag') return cmdShortlistTag(args.slice(1));
  if (sub === 'discard') return cmdShortlistDiscard(args.slice(1));
  if (sub === 'sync') return cmdShortlistSync(args.slice(1));
  if (sub === 'list') return cmdShortlistList(args.slice(1));
  if (sub === 'archive') return cmdShortlistArchive(args.slice(1));
  console.error('Usage: jobbot shortlist <tag|discard|sync|list|archive> ...');
  process.exit(2);
}

async function cmdAnalyticsFunnel(args) {
  const format = args.includes('--json') ? 'json' : 'text';
  const funnel = await computeFunnel();
  if (format === 'json') {
    console.log(JSON.stringify(funnel, null, 2));
    return;
  }
  console.log(formatFunnelReport(funnel));
}

async function cmdAnalyticsExport(args) {
  const output = getFlag(args, '--out');
  const snapshot = await exportAnalyticsSnapshot();
  const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (output) {
    const resolved = path.resolve(process.cwd(), output);
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, payload, 'utf8');
    console.log(`Saved analytics snapshot to ${resolved}`);
    return;
  }
  console.log(payload.trimEnd());
}

async function cmdAnalytics(args) {
  const sub = args[0];
  if (sub === 'funnel') return cmdAnalyticsFunnel(args.slice(1));
  if (sub === 'export') return cmdAnalyticsExport(args.slice(1));
  console.error('Usage: jobbot analytics <funnel|export> [options]');
  process.exit(2);
}

async function cmdDeliverablesBundle(args) {
  const jobId = args[0];
  const rest = args.slice(1);
  const outPath = getFlag(rest, '--out');
  const timestamp = getFlag(rest, '--timestamp');
  if (!jobId || !outPath) {
    console.error(
      'Usage: jobbot deliverables bundle <job_id> --out <path> ' +
        '[--timestamp <iso8601>]'
    );
    process.exit(2);
  }

  let archive;
  try {
    archive = await bundleDeliverables(jobId, { timestamp });
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), outPath);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, archive);
  console.log(`Bundled ${jobId} deliverables to ${resolved}`);
}

async function cmdDeliverables(args) {
  const sub = args[0];
  if (sub === 'bundle') return cmdDeliverablesBundle(args.slice(1));
  console.error('Usage: jobbot deliverables <bundle> [options]');
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

function resolvePlanStage(args) {
  if (args.includes('--behavioral')) return 'behavioral';
  if (args.includes('--technical')) return 'technical';
  if (args.includes('--system-design') || args.includes('--system_design')) return 'system design';
  if (args.includes('--take-home') || args.includes('--takehome')) return 'take-home';
  if (args.includes('--onsite')) return 'onsite';
  const explicit = getFlag(args, '--stage');
  return explicit;
}

function formatRehearsalPlan(plan) {
  const lines = [];
  lines.push(`${plan.stage} rehearsal plan`);
  if (plan.role) lines.push(`Role focus: ${plan.role}`);
  if (plan.duration_minutes) {
    lines.push(`Suggested duration: ${plan.duration_minutes} minutes`);
  }
  if (plan.summary) {
    lines.push('');
    lines.push(plan.summary);
  }

  if (Array.isArray(plan.sections) && plan.sections.length > 0) {
    for (const section of plan.sections) {
      lines.push('');
      lines.push(section.title);
      for (const item of section.items || []) {
        lines.push(`- ${item}`);
      }
    }
  }

  if (Array.isArray(plan.resources) && plan.resources.length > 0) {
    lines.push('');
    lines.push('Resources');
    for (const resource of plan.resources) {
      lines.push(`- ${resource}`);
    }
  }

  if (Array.isArray(plan.flashcards) && plan.flashcards.length > 0) {
    const entries = plan.flashcards
      .map(card => {
        const front = typeof card?.front === 'string' ? card.front.trim() : '';
        const back = typeof card?.back === 'string' ? card.back.trim() : '';
        if (!front && !back) return null;
        const detail = back ? `${front} → ${back}` : front || back;
        return detail;
      })
      .filter(Boolean);
    if (entries.length > 0) {
      lines.push('');
      lines.push('Flashcards');
      for (const entry of entries) {
        lines.push(`- ${entry}`);
      }
    }
  }

  if (Array.isArray(plan.question_bank) && plan.question_bank.length > 0) {
    const entries = plan.question_bank
      .map((question, index) => {
        const prompt = typeof question?.prompt === 'string' ? question.prompt.trim() : '';
        if (!prompt) return null;
        const tags = Array.isArray(question.tags) ? question.tags.filter(Boolean) : [];
        const suffix = tags.length ? ` (${tags.join(', ')})` : '';
        return `${index + 1}. ${prompt}${suffix}`;
      })
      .filter(Boolean);
    if (entries.length > 0) {
      lines.push('');
      lines.push('Question bank');
      for (const entry of entries) {
        lines.push(entry);
      }
    }
  }

  if (Array.isArray(plan.dialog_tree) && plan.dialog_tree.length > 0) {
    let headerPrinted = false;
    for (const node of plan.dialog_tree) {
      const prompt = typeof node?.prompt === 'string' ? node.prompt.trim() : '';
      if (!prompt) continue;
      if (!headerPrinted) {
        lines.push('');
        lines.push('Dialog tree');
        headerPrinted = true;
      }
      const id = typeof node?.id === 'string' ? node.id.trim() : '';
      const label = id ? `${id} — ${prompt}` : prompt;
      lines.push(`- ${label}`);
      const followUps = Array.isArray(node?.follow_ups)
        ? node.follow_ups
            .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean)
        : [];
      if (followUps.length > 0) {
        lines.push('  Follow-ups:');
        for (const followUp of followUps) {
          lines.push(`  * ${followUp}`);
        }
      }
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}

async function cmdInterviewsPlan(args) {
  const asJson = args.includes('--json');
  const filtered = args.filter(arg => arg !== '--json');
  const stageInput = resolvePlanStage(filtered);
  const role = getFlag(filtered, '--role');
  const durationMinutes = getNumberFlag(filtered, '--duration');

  const plan = generateRehearsalPlan({ stage: stageInput, role, durationMinutes });

  if (asJson) {
    console.log(JSON.stringify({ plan }, null, 2));
    return;
  }

  console.log(formatRehearsalPlan(plan));
}

async function cmdInterviews(args) {
  const sub = args[0];
  if (sub === 'record') return cmdInterviewsRecord(args.slice(1));
  if (sub === 'show') return cmdInterviewsShow(args.slice(1));
  if (sub === 'plan') return cmdInterviewsPlan(args.slice(1));
  console.error('Usage: jobbot interviews <record|show|plan> ...');
  process.exit(2);
}

async function cmdRehearse(args) {
  const jobId = args[0];
  const rest = args.slice(1);
  const sessionId = getFlag(rest, '--session') || generateRehearsalSessionId();

  if (!jobId) {
    console.error(
      'Usage: jobbot rehearse <job_id> [--session <id>] [--stage <value>] [--mode <value>] ' +
        '[--behavioral] [--technical] [--onsite] [--voice] [--text] ' +
        '[--transcript <text>|--transcript-file <path>] ' +
        '[--reflections <text>|--reflections-file <path>] ' +
        '[--feedback <text>|--feedback-file <path>] ' +
        '[--notes <text>|--notes-file <path>] ' +
        '[--started-at <iso8601>] [--ended-at <iso8601>]'
    );
    process.exit(2);
  }

  const transcriptInput = readContentFromArgs(rest, '--transcript', '--transcript-file');
  const reflectionsInput = readContentFromArgs(rest, '--reflections', '--reflections-file');
  const feedbackInput = readContentFromArgs(rest, '--feedback', '--feedback-file');
  const notesInput = readContentFromArgs(rest, '--notes', '--notes-file');

  const stage = resolveRehearsalStage(rest) || 'Behavioral';
  const mode = resolveRehearsalMode(rest) || 'Voice';
  const startedAt = getFlag(rest, '--started-at');
  const endedAt = getFlag(rest, '--ended-at');

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
  console.log(`Recorded rehearsal ${entry.session_id} for ${entry.job_id}`);
}

async function cmdImportLinkedIn(args) {
  const source = args[0];
  if (!source) {
    console.error('Usage: jobbot import linkedin <file>');
    process.exit(2);
  }

  try {
    const result = await importLinkedInProfile(source);
    const summaryParts = [];
    if (result.basicsUpdated) summaryParts.push(`basics +${result.basicsUpdated}`);
    if (result.workAdded) summaryParts.push(`work +${result.workAdded}`);
    if (result.educationAdded) summaryParts.push(`education +${result.educationAdded}`);
    if (result.skillsAdded) summaryParts.push(`skills +${result.skillsAdded}`);
    const summary = summaryParts.length ? ` (${summaryParts.join(', ')})` : '';
    console.log(`Imported LinkedIn profile to ${result.path}${summary}`);
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }
}

async function cmdImport(args) {
  const sub = args[0];
  if (sub === 'linkedin') return cmdImportLinkedIn(args.slice(1));
  console.error('Usage: jobbot import <linkedin> [options]');
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
  if (cmd === 'analytics') return cmdAnalytics(args);
  if (cmd === 'rehearse') return cmdRehearse(args);
  if (cmd === 'deliverables') return cmdDeliverables(args);
  if (cmd === 'import') return cmdImport(args);
  if (cmd === 'intake') return cmdIntake(args);
  if (cmd === 'ingest') return cmdIngest(args);
  if (cmd === 'interviews') return cmdInterviews(args);
  console.error(
    'Usage: jobbot <init|import|summarize|match|track|shortlist|analytics|' +
      'rehearse|deliverables|interviews|intake|ingest> [options]'
  );
  process.exit(2);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
