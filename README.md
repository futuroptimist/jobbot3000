# 🎯 jobbot3000

[![CI](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/ci.yml?label=ci)](https://github.com/futuroptimist/jobbot3000/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/codeql.yml?label=codeql)](https://github.com/futuroptimist/jobbot3000/actions/workflows/codeql.yml)
[![PR Reaper](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/pr-reaper.yml?label=pr%20reaper)](https://github.com/futuroptimist/jobbot3000/actions/workflows/pr-reaper.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

**jobbot3000** is a self-hosted, open-source job search copilot.
It was bootstrapped from
[futuroptimist/flywheel](https://github.com/futuroptimist/flywheel) and uses its
practices for linting, testing, and documentation.

## Getting Started

Requires [Node.js](https://nodejs.org/) 20 or newer.

### Cross-platform setup checklist

All platforms:

- Install Node.js 20+ and run `npm ci` from the project root.
- Verify the repo stays green with `npm run lint` and `npm run test:ci`.
- When you are done with a temporary data directory, remove it to avoid stale state.

#### Linux, macOS, and Windows Subsystem for Linux (WSL)

The POSIX shells bundled with these environments support the same commands.

```bash
export JOBBOT_DATA_DIR=$(mktemp -d)
npm run lint
npm run test:ci
npx jobbot init
npx jobbot track add job-123 --status screening
rm -rf "$JOBBOT_DATA_DIR"
unset JOBBOT_DATA_DIR
```

#### Windows 11 PowerShell

Use PowerShell syntax when exporting environment variables. The CLI automatically
quotes Windows paths when invoking external tools (for example, custom speech
transcribers), so commands with spaces do not need manual escaping.

```powershell
$jobbotData = Join-Path $env:TEMP ([guid]::NewGuid())
New-Item -ItemType Directory -Path $jobbotData | Out-Null
$env:JOBBOT_DATA_DIR = $jobbotData
npm run lint
npm run test:ci
npx jobbot init
npx jobbot track add job-123 --status screening
Remove-Item $jobbotData -Recurse -Force
Remove-Item Env:JOBBOT_DATA_DIR
```

The `postinstall` script that provisions console fonts on Linux safely no-ops on
macOS, WSL, and Windows when those assets are unavailable.

See [docs/platform-support.md](docs/platform-support.md) for deeper platform
guidance, environment variable recipes, and troubleshooting notes.

```bash
# Clone your fork
git clone git@github.com:YOURNAME/jobbot3000.git
cd jobbot3000

# Verify Node.js version (requires 20 or newer)
node --version

# Install dependencies
npm ci

# Run repo checks
npm run lint
npm run test:ci

# Summarize a job description
# Works with sentences ending in ., ?, or !
# Keep two sentences with --sentences, output plain text with --text
echo "First. Second. Third." | npx jobbot summarize - --sentences 2 --text
# => First. Second.
# Non-numeric --sentences values fall back to 1 sentence

# Write a DOCX summary alongside the console output
npx jobbot summarize job.txt --docx output/summary.docx
# => Markdown summary prints to stdout; DOCX saved to output/summary.docx

# Bump the remote fetch limit to 5 MB when summarizing large postings
npx jobbot summarize https://example.com/job --max-bytes 5242880

# Localize summary headings in Spanish
npx jobbot summarize job.txt --docx output/summary-es.docx --locale es
# => Markdown and DOCX outputs use translated labels

# Track an application's status
npx jobbot track add job-123 --status screening
# => Recorded job-123 as screening

# Schedule a follow-up reminder when logging outreach
npx jobbot track log job-123 --channel follow_up --remind-at 2025-03-11T09:00:00Z --note "Check in"
# => Logged job-123 event follow_up
```

## Architecture map

New contributors can orient with the [jobbot3000 architecture map](docs/architecture.md), which
summarizes how CLI commands (`src/index.js`) fan out to ingestion, scoring, deliverables, and
analytics modules. The guide also links to the git-ignored `data/` directories so you know where
local artifacts land during dry runs.

# Continuous integration
GitHub Actions runs lint and test checks on each push and pull request that includes code changes.
Markdown-only updates skip CI to keep the pipeline fast, and in-progress runs for the same branch are
canceled when new commits arrive.

In code, import the `summarize` function and pass the number of sentences to keep:

```js
import { summarize } from './src/index.js';

const text = 'First sentence. Second sentence? Third!';
const summary = summarize(text, 2);
console.log(summary);
// "First sentence. Second sentence?"
```

Pass `0` to `summarize` to return an empty string.

Requesting more sentences than exist returns the entire text.

Invalid or non-numeric `count` values default to a single sentence.

The example below demonstrates this behavior:

```js
const all = summarize('Only one sentence.', 5);
console.log(all);
// "Only one sentence."
```

Fetch remote job listings, normalize HTML to plain text, and log the result using an async helper:

```js
import { fetchTextFromUrl } from './src/fetch.js';

const run = async () => {
  const text = await fetchTextFromUrl('https://example.com', {
    timeoutMs: 5000,
    headers: { 'User-Agent': 'jobbot' }
  });
  console.log(text);
  // "<job description text>"
};

run();
```

`fetchTextFromUrl` strips scripts, styles, navigation, header, footer, aside,
and noscript content, preserves image alt text or `aria-label` values (while
ignoring `aria-hidden` images—including boolean attributes without a value—or
those with `role="presentation"`/`"none"`), and collapses whitespace to single
spaces. Tests in [`test/fetch.test.js`](test/fetch.test.js) cover uppercase,
numeric, and valueless `aria-hidden` attributes alongside role variants so
regressions are caught early. Pass `timeoutMs` (milliseconds) to
override the 10s default, and `headers` to send custom HTTP headers. Requests
default to sending `User-Agent: jobbot3000`; provide a `User-Agent` header to
override it. Responses
over 1 MB are rejected; override with `maxBytes` to adjust. Only `http` and
`https` URLs are supported; other protocols throw an error. Requests to
loopback, link-local, carrier-grade NAT, or other private network addresses
are blocked to prevent server-side request forgery (SSRF). The CLI equivalents
(`jobbot summarize`, `jobbot match`, and `jobbot ingest url`) accept `--max-bytes`
to raise the limit for unusually large postings while retaining the default 1 MB
guardrail for typical runs. Hostnames that
resolve to those private ranges (for example, `127.0.0.1.nip.io`) are rejected
as well; `test/fetch.test.js` now asserts both generic and nip.io guardrails.
Calls targeting the same protocol/host pair are serialized so a host only sees
one in-flight request at a time while different hosts still run concurrently;
new queue tests cover the sequential, cross-host, and timeout-recovery cases.

Normalize existing HTML without fetching and log the result:

```js
import { extractTextFromHtml } from './src/fetch.js';

const text = extractTextFromHtml('<p>Hello</p>');
console.log(text);
// "Hello"
```

Load resume files and return plain text:

```js
import { loadResume } from './src/resume.js';

const run = async () => {
  const text = await loadResume('resume.mdx');
  console.log(text);
  // "Plain text resume"
};

run();
```

`loadResume` supports `.pdf`, `.md`, `.markdown`, and `.mdx` files; other
extensions are read as plain text.

Pass `{ withMetadata: true }` to capture basic file statistics alongside the
cleaned text:

## Call ATS APIs with the shared HTTP client

Normalize HTTP wiring across connectors with `createHttpClient`. It centralizes
default headers, rate limiting, retries, and timeouts so feature modules avoid
copying boilerplate:

```js
import { createHttpClient } from './src/services/http.js';

const client = createHttpClient({
  provider: 'greenhouse',
  defaultHeaders: { Accept: 'application/json' },
  defaultRateLimitMs: 750,
});

const response = await client.json('https://boards.greenhouse.io/v1/boards/acme/jobs', {
  headers: { Authorization: `Bearer ${process.env.GREENHOUSE_TOKEN}` },
  rateLimit: { key: 'greenhouse:acme' },
});

console.log(`Fetched ${response.jobs.length} jobs`);
```

`createHttpClient` automatically adds the repository's `User-Agent` header when
one is not provided, applies per-host rate limits, and aborts requests that
exceed the configured timeout. Pass `client.request(url, { fetchImpl })` to
bring your own `fetch` implementation or override `timeoutMs`, `retry`, and
`rateLimit` settings per call. Tests in
[`test/services-http.test.js`](test/services-http.test.js) cover header merges,
timeout aborts, and rate-limit propagation so connectors stay consistent.

```js
const { text, metadata } = await loadResume('resume.md', { withMetadata: true });
console.log(metadata);
// {
//   extension: '.md',
//   format: 'markdown',
//   bytes: 2312,
//   characters: 1980,
//   lineCount: 62,
//   wordCount: 340,
//   confidence: 0.9,
//   ambiguities: [
//     {
//       type: 'metrics',
//       message: 'No numeric metrics detected; consider adding quantified achievements.'
//     }
//   ],
//   warnings: [
//     {
//       type: 'tables',
//       message: 'Detected table formatting; ATS parsers often ignore table content.'
//     }
//   ],
//   confidence: {
//     score: 0.82,
//     signals: [
//       'Detected common resume headings: experience, education',
//       'Detected bullet formatting in experience sections'
//     ]
//   },
//   ambiguities: [
//     {
//       type: 'date',
//       value: '20XX',
//       message: 'Potential placeholder date detected',
//       location: { line: 42, column: 18 }
//     }
//   ]
// }
```

`test/resume.test.js` exercises the metadata branch so downstream callers can
depend on the shape. When tables or images appear in the source material, the
metadata includes `warnings` entries that flag ATS-hostile patterns; new tests
assert tables and images trigger the warnings so resume imports surface risks.
Confidence heuristics and placeholder detection keep resume imports trustworthy.
The suite also asserts the presence of parsing confidence signals and ambiguity
highlights (for example, placeholder dates like `20XX` or metrics such as `XX%`)
alongside ATS warnings so regressions surface quickly. Ambiguity heuristics now
emit `ambiguities` entries when month ranges omit years, job titles are missing,
or quantified metrics are absent, and the `confidence` score reflects those
signals so review tools can triage follow-up work. Ambiguity entries now include
the `{ line, column }` location of each occurrence and are emitted in document
order so callers can highlight every placeholder directly in downstream editors.
Plain text and PDF resumes receive the same aggregate `dates`, `metrics`, and
`titles` hints, with additional coverage in `test/resume.test.js` confirming the
non-Markdown path.
Month-range heuristics now tag the first ambiguous month with its source line and column even when no
placeholder tokens (such as `20XX`) exist, keeping plain-text imports aligned with the Markdown branch.

Initialize a JSON Resume skeleton when you do not have an existing file:

```bash
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot init
# Initialized profile at /tmp/jobbot-profile-XXXX/profile/resume.json

# The profile namespace exposes the same initializer
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot profile init
```

`jobbot init` (and its `jobbot profile init` alias) writes `profile/resume.json`
under the data directory with empty basics, work, education, skills, projects,
certificates, and languages sections. The command is idempotent and preserves
existing resumes; see `test/cli.test.js` and `test/profile.test.js` for
coverage of both entry points.

Import a LinkedIn profile export to seed the resume with verified contact,
work history, education, and skills:

```bash
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot import linkedin linkedin-profile.json
# Imported LinkedIn profile to /tmp/jobbot-profile-XXXX/profile/resume.json (basics +5, work +1, education +1, skills +3)

# The profile namespace forwards to the same importer
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot profile import linkedin linkedin-profile.json
```

The importer accepts LinkedIn JSON exports (downloadable from
`https://www.linkedin.com/psettings/member-data`) and merges them into the
existing resume without overwriting confirmed fields. Work history, education,
and skill entries are deduplicated so repeated imports keep the profile tidy.
See `test/profile-import.test.js` for normalization edge cases and
`test/cli.test.js` for CLI wiring (including the `jobbot profile import` path).

Format parsed results as Markdown. The exporters escape Markdown control characters so job
content cannot inject arbitrary links or formatting when rendered downstream:

```js
import { toMarkdownSummary } from './src/exporters.js';

const md = toMarkdownSummary({
  title: 'Engineer',
  company: 'ACME',
  location: 'Remote',
  url: 'https://example.com/job',
  summary: 'Short blurb.',
  requirements: ['3+ years JS'],
});

console.log(md);
// # Engineer
// **Company**: ACME
// **Location**: Remote
// **URL**: https://example.com/job
//
// ## Summary
//
// Short blurb.
//
// ## Requirements
// - 3+ years JS
```

Pass `url` to include a source link in the rendered Markdown output.
`toMarkdownMatch` accepts the same `url` field to link match reports back to the job posting.
If `summary` is omitted, the requirements section is still separated by a blank line.

`toDocxSummary` and `toDocxMatch` provide `.docx` exports with the same localized labels and bullet
structure. Automated coverage in [`test/exporters.test.js`](test/exporters.test.js) inspects the
generated `word/document.xml`, and [`test/cli.test.js`](test/cli.test.js) verifies the CLI's
`--docx` flag writes those documents without altering stdout output.

Both exporters accept an optional `locale` field to translate labels.
The default locale is `'en'`; Spanish (`'es'`) and French (`'fr'`) are also supported.
The CLI surfaces the same translations with `--locale <code>` on `jobbot summarize` and
`jobbot match` (including their `--docx` variants). Automated coverage in
[`test/cli.test.js`](test/cli.test.js) now verifies Spanish and French Markdown outputs so localized
paths stay working end to end.

Use `toMarkdownMatch` to format fit score results; it also accepts `url`:

```js
import { toMarkdownMatch } from './src/exporters.js';

const md = toMarkdownMatch({
  title: 'Engineer',
  url: 'https://example.com/job',
  score: 75,
  matched: ['JS'],
  missing: ['Rust'],
});

console.log(md);
// # Engineer
// **URL**: https://example.com/job
// **Fit Score**: 75%
//
// ## Matched
// - JS
//
// ## Missing
// - Rust
```

Orchestrate parsing and scoring in one call with `matchResumeToJob` from
[`src/match.js`](src/match.js). It accepts either raw job text or a parsed
object and returns the same shape the CLI prints, including `skills_hit`,
`skills_gap`, blocker detection, and optional localized explanations:

```js
import { matchResumeToJob } from './src/match.js';

const resume = 'Built Node.js services and automated Terraform deployments.';
const jobDescription = `Title: Platform Engineer\nRequirements:\n- Experience with Node.js\n- Must have Kubernetes certification\n- Terraform proficiency\n`;

const match = matchResumeToJob(resume, jobDescription, {
  includeExplanation: true,
  locale: 'fr',
});

console.log(match.score); // 67
console.log(match.matched); // ['Experience with Node.js', 'Terraform proficiency']
console.log(match.explanation);
// Correspond 2 sur 3 exigences (67 %).\n// Points forts: Experience with Node.js; Terraform proficiency\n// Lacunes: Must have Kubernetes certification\n// Blocages: Must have Kubernetes certification
```

When only the matched or missing lists are present, the Markdown output starts with the
corresponding section heading instead of an extra leading blank line.

The CLI surfaces the same explanation with `jobbot match --explain`, appending a narrative summary
of hits and gaps after the standard Markdown report. JSON output gains an `explanation` field when
the flag is supplied. JSON payloads also include `skills_hit` and `skills_gap` arrays that mirror the
matched/missing sections so downstream tools can treat them as normalized competency buckets without
having to re-scan Markdown output. A `must_haves_missed` array lists missing requirements flagged as
blockers (for example, entries containing 'must have', 'required', or specific clearance language)
so downstream tooling can highlight hard-stops without re-parsing the text. A `keyword_overlap` array
surfaces the lower-cased tokens and synonym phrases that triggered a match so follow-up tooling can
see which concrete words or abbreviations aligned without recomputing overlaps. The list is capped
at 12 entries and cached per resume/requirement pairing to keep repeated evaluations (like multi-job
comparisons) fast. Extremely large resumes (more than 5,000 unique tokens) skip overlap extraction to
preserve cold-start latency targets.

When a job already has tailoring or rehearsal artifacts, JSON match payloads attach a `prior_activity`
block summarizing deliverable runs and interview sessions (including the latest coaching notes). The
Markdown report mirrors the same insights in a `## Prior Activity` section so reviewers can spot the
most recent work without opening the underlying files. Interview summaries fall back to the
session's `started_at` timestamp—or, if that is unavailable, the recording's filesystem metadata—so
even partially captured sessions still surface when reviewing prior work. The session detail now
annotates the timestamp source via `recorded_at_source` (`recorded_at`, `started_at`, or
`file_mtime`) so reviewers know whether they're looking at an explicit log or a filesystem-derived
fallback. When `--locale` is provided, the Prior Activity heading and bullet labels respect the
requested language so localized reports stay consistent end to end.

```bash
cat <<'EOF' > resume.txt
Designed large-scale services and mentored senior engineers.
EOF

cat <<'EOF' > job.txt
Title: Staff Engineer
Requirements
- Distributed systems experience
- Certified Kubernetes administrator
- Mentors senior engineers
EOF

JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot match --resume resume.txt --job job.txt --explain
# # Staff Engineer
# ## Matched
# - Distributed systems experience
# - Mentors senior engineers
#
# ## Missing
# - Certified Kubernetes administrator
#
# ## Explanation
#
# Matched 2 of 3 requirements (67%).
# Hits: Distributed systems experience; Mentors senior engineers
# Gaps: Certified Kubernetes administrator
# Blockers: Certified Kubernetes administrator

# Persist a DOCX match report while keeping machine-readable output
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot match --resume resume.txt --job job.txt --json --docx match.docx
# => JSON match report prints to stdout; match.docx contains the formatted document

# Localize match reports and explanations
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot match --resume resume.txt --job job.txt --locale fr --docx match-fr.docx
# => Markdown and DOCX outputs render translated labels
```

Provide `--role <title>` and/or `--location <value>` when the source material omits those fields or
when you want to override parsed metadata for reporting purposes. The overrides flow into Markdown,
JSON, and DOCX outputs as well as the saved job snapshot so downstream tooling sees the adjusted
context.

Fit scoring recognizes common abbreviations so lexical-only resumes still match spelled-out
requirements. `AWS` on a resume matches `Amazon Web Services`, `ML` pairs with `Machine learning`,
`AI` aligns with `Artificial intelligence`, and `Postgres` maps to `PostgreSQL`. The matcher also
bridges `SaaS` with `Software as a Service`, `K8s` with `Kubernetes`, maps `CI/CD` to both `Continuous
integration` and `Continuous delivery` without conflating the two, and short forms like `JS`/`TS` with
`JavaScript`/`TypeScript`.
Automated coverage in [`test/scoring.test.js`](test/scoring.test.js) exercises these semantic
aliases and now verifies the exposed keyword overlap tokens for both lexical and synonym-driven
matches.

The explanation helper also highlights blockers when missing requirements look like must-haves.
Entries containing phrases such as “must”, “required”, “security clearance”, “visa”, “sponsorship”,
“certification”, “license”, “authorization”, or “citizenship” now share the same spotlight as
location constraints (“onsite”, “in-office”, “relocation”, “travel”), compensation language
(“salary”, “compensation”, “base pay”), and seniority signals (“senior-level”, “years of experience”,
“leadership”). They are surfaced in a dedicated line so reviewers can distinguish urgent gaps from
nice-to-have skills. Tests in [`test/exporters.test.js`](test/exporters.test.js) cover the expanded
blocker detection, localized blocker labels (including the French strings), and the fallback
message when no mandatory requirements are found.

The summarizer extracts the first sentence, handling `.`, `!`, `?`, and consecutive terminal
punctuation like `?!`, including when followed by closing quotes or parentheses. Terminators apply
only when followed by whitespace or the end of text, so decimals like `1.99` remain intact.
It ignores bare newlines.
It scans text character-by-character to avoid large intermediate arrays and regex performance
pitfalls, falling back to the trimmed input when no sentence punctuation is found.
Trailing quotes or parentheses are included when they immediately follow punctuation, and all
Unicode whitespace is treated as a sentence boundary.
If fewer complete sentences than requested exist, any remaining text is appended so no content
is lost. Parenthetical abbreviations like `(M.Sc.)` remain attached to their surrounding sentence.
Common honorifics such as `Mr.` and `Dr.` are recognized so summaries aren't cut mid-sentence.

Example: `summarize('"Hi!" Bye.')` returns `"Hi!"`.
It waits for whitespace (or the end of the text) after terminal punctuation, so
`summarize('Hi!Next steps.')` returns `"Hi!Next steps."`.
Unit tests exercise punctuation with and without trailing whitespace so the
summarizer keeps honoring these boundaries alongside abbreviations, decimals,
and nested punctuation edge cases.

## Job snapshots

Fetching remote listings or matching local job descriptions writes snapshots to
`data/jobs/{job_id}.json`. Snapshots include the raw body, parsed fields, the
source descriptor (URL or file path), request headers, and a capture timestamp
so the shortlist can be rebuilt later. Job identifiers are short SHA-256 hashes
derived from the source, giving deterministic filenames without leaking PII.

The CLI respects `JOBBOT_DATA_DIR`, mirroring the application lifecycle store,
so snapshots stay alongside other candidate data when the directory is moved.
`test/jobs.test.js` covers this behaviour to keep the contract stable.

## Job board ingestion

Fetch public boards directly with Greenhouse, Lever, Ashby, SmartRecruiters, or Workable pipelines:

```bash
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot ingest greenhouse --company example
# Imported 12 jobs from example

JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot ingest lever --company example
# Imported 8 jobs from example

JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot ingest ashby --company example
# Imported 6 jobs from example

JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot ingest smartrecruiters --company example
# Imported 5 jobs from example

JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot ingest workable --company example
# Imported 4 jobs from example

JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot ingest url https://example.com/jobs/staff-engineer
# Imported job 5d41402abc4b2a76 from https://example.com/jobs/staff-engineer

# Raise the ingest snapshot limit to 5 MB for unusually long postings
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot ingest url https://example.com/big-role --max-bytes 5242880
```

Each connector now exports a `JobSourceAdapter` (see
[`src/adapters/job-source.js`](src/adapters/job-source.js)) with standardized
`listOpenings`, `normalizeJob`, and `toApplicationEvent` helpers. The shared
contract keeps fetch logic consistent across providers and makes it easier to
add new adapters without rewriting snapshot plumbing. Automated coverage in
[`test/job-source-adapters.test.js`](test/job-source-adapters.test.js) exercises
the adapters directly so snapshot shapes, sanitized headers, and provider
metadata remain aligned with the CLI ingest flows.

Each listing in the response is normalised to plain text, parsed for title,
location, and requirements, and written to `data/jobs/{job_id}.json` with a
`source.type` reflecting the provider (`greenhouse`, `lever`, `ashby`,
`smartrecruiters`, `workable`, or `url`). Updates reuse the same job identifier so
downstream tooling can diff revisions over time. Tests in
[`test/greenhouse.test.js`](test/greenhouse.test.js),
[`test/lever.test.js`](test/lever.test.js), [`test/ashby.test.js`](test/ashby.test.js),
[`test/smartrecruiters.test.js`](test/smartrecruiters.test.js), and
[`test/workable.test.js`](test/workable.test.js) verify the ingest
pipelines fetch board content, persist structured snapshots, surface fetch
errors, and retain the `User-Agent: jobbot3000` request header alongside each
capture so fetches are reproducible. [`test/jobs.test.js`](test/jobs.test.js)
adds coverage for direct URL ingestion, ensuring snapshots store normalized
request headers and reject unsupported protocols.
Per-tenant rate limits prevent hammering board APIs: set
`JOBBOT_GREENHOUSE_RATE_LIMIT_MS`, `JOBBOT_LEVER_RATE_LIMIT_MS`,
`JOBBOT_ASHBY_RATE_LIMIT_MS`, `JOBBOT_SMARTRECRUITERS_RATE_LIMIT_MS`, or
`JOBBOT_WORKABLE_RATE_LIMIT_MS` to throttle repeat requests. Provide
`JOBBOT_WORKABLE_TOKEN` when your Workable tenant requires authenticated API
access; the CLI adds an `Authorization: Bearer …` header during ingest while
redacting the token from saved job snapshots. Greenhouse caches
the last fetch timestamp per board and seeds the limiter across CLI runs so
back-to-back syncs stay compliant. New coverage in
[`test/fetch.test.js`](test/fetch.test.js) exercises the limiter queue, and
[`test/greenhouse.test.js`](test/greenhouse.test.js) verifies consecutive syncs
defer the second fetch until the configured window elapses.
[`test/lever.test.js`](test/lever.test.js) now explicitly asserts the Lever
client forwards that header to the API and persists it in saved snapshots so
metadata stays consistent across providers. Automated coverage in
[`test/greenhouse.test.js`](test/greenhouse.test.js) also exercises the retry
logic so transient 5xx responses are retried before surfacing to callers. The
Greenhouse ingest client now caches `ETag`/`Last-Modified` validators and
replays them on the next fetch, skipping snapshot work when the board returns a
`304 Not Modified`. The command exits with `Greenhouse board <slug> unchanged`
so repeated syncs are noiseless, and the Greenhouse test suite verifies the
cache is written and that conditional requests short-circuit without touching
the filesystem when nothing has changed.

## Schedule recurring ingestion and matching

Automate board refreshes and fit-score runs with `jobbot schedule run`. Provide
tasks in a JSON file and let the CLI execute them on an interval:

```jsonc
{
  "tasks": [
    {
      "id": "greenhouse-hourly",
      "type": "ingest",
      "provider": "greenhouse",
      "company": "acme",
      "intervalMinutes": 60
    },
    {
      "id": "match-sample",
      "type": "match",
      "resume": "data/profile/resume.json",
      "jobId": "5d41402abc4b2a76",
      "intervalMinutes": 120,
      "output": "data/matches/job-5d4140.json"
    }
  ]
}
```

Run the scheduler and optionally limit each task to a fixed number of cycles
(useful for CI or scripted runs):

```bash
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot schedule run --config schedule.json --cycles 1
```

Omit `--cycles` to keep the process running until you interrupt it. Each
completion is logged with a timestamp and task identifier, and matching tasks
can persist their latest score summaries to disk when `output` is provided.
Configuration parsing, task orchestration, and the CLI surface are covered in
[`test/schedule-config.test.js`](test/schedule-config.test.js),
[`test/scheduler.test.js`](test/scheduler.test.js), and the scheduler scenario
in [`test/cli.test.js`](test/cli.test.js).

If a match task points to a `jobId` without a saved snapshot in
`$JOBBOT_DATA_DIR/jobs`, the scheduler now surfaces
`match task <id> could not find job snapshot <jobId>` and suggests running
`jobbot ingest` before re-queuing the task. Regression coverage lives alongside
the other scheduler tests listed above.

Job titles can be parsed from lines starting with `Title`, `Job Title`, `Position`, or `Role`.
Headers can use colons or dash separators (for example, `Role - Staff Engineer`), and the same
separators work for `Company` and `Location`. Parser unit tests cover both colon and dash cases so
this behavior stays locked in.

Job requirements may appear under headers like `Requirements`, `Qualifications`,
`What you'll need`, or `Responsibilities` (used if no other requirement headers are present).
They may start with `-`, `+`, `*`, `•`, `–` (en dash), `—` (em dash), alphabetical markers like `a.`
or `(a)`, or numeric markers like `1.` or `(1)`; these markers are stripped when parsing job text,
even when the first requirement follows
the header on the same line. Leading numbers without punctuation remain intact. Requirement headers
are located in a single pass to avoid re-scanning large job postings, and resume scoring tokenizes
via a manual scanner and caches tokens (up to 60k lines) to avoid repeated work. Automated tests
exercise this path with 120k-line resumes to ensure the tokenizer stays under 200ms on a cold run.
Requirement bullets
are scanned without regex or temporary arrays, improving large input performance. Blank or
non-string requirement entries are skipped so invalid bullets don't affect scoring.

## Shortlist tags and discards

Tag incoming roles with keywords or archive them with a rationale to guide future matches:

```bash
DATA_DIR=$(mktemp -d)
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist tag job-123 dream remote
# Tagged job-123 with dream, remote

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist discard job-123 --reason "Not remote" --tags "Remote,onsite"
# Discarded job-123: Not remote

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist sync job-123
# Synced job-123 metadata
# (synced_at defaults to the current timestamp when no metadata flags are provided)

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist sync job-123 --location Remote --level Senior --compensation "$185k" --synced-at 2025-03-06T08:00:00Z
# Synced job-123 metadata with refreshed fields

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist list --location remote
# job-123
#   Location: Remote
#   Level: Senior
#   Compensation: $185k
#   Synced At: 2025-03-06T08:00:00.000Z
#   Tags: dream, remote
#   Discard Count: 1
#   Last Discard: Not remote (2025-03-05T12:00:00.000Z)
#   Last Discard Tags: Remote, onsite

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist list --tag dream --tag remote
# job-123
#   Location: Remote
#   Level: Senior
#   Compensation: $185k
#   Synced At: 2025-03-06T08:00:00.000Z
#   Tags: dream, remote
#   Discard Count: 1
#   Last Discard: Not remote (2025-03-05T12:00:00.000Z)
#   Last Discard Tags: Remote, onsite

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist list --json
# {
#   "jobs": {
#     "job-123": {
#       "metadata": {
#         "location": "Remote",
#         "level": "Senior",
#         "compensation": "$185k",
#         "synced_at": "2025-03-06T08:00:00.000Z"
#       },
#       "tags": ["dream", "remote"],
#       "discarded": [
#         {
#           "reason": "Not remote",
#           "discarded_at": "2025-03-05T12:00:00.000Z",
#           "tags": ["Remote", "onsite"]
#         }
#       ],
#       "last_discard": {
#         "reason": "Not remote",
#         "discarded_at": "2025-03-05T12:00:00.000Z",
#         "tags": ["Remote", "onsite"]
#       },
#       "discard_count": 1
#     }
#   }
# }

# Persist the filtered shortlist to disk for sharing
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist list --json --out shortlist.json
# Saved shortlist snapshot to /tmp/jobbot-cli-XXXX/shortlist.json

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist archive job-123
# job-123
# - 2025-03-07T09:30:00.000Z — Focus changed
#   Tags: Focus, remote
# - 2025-03-05T12:00:00.000Z — Not remote
#   Tags: Remote, onsite
```

Automated CLI tests cover both the new-entry and refresh flows so `jobbot shortlist sync <job_id>`
continues to stamp `synced_at` when metadata flags are omitted and when existing records are
refreshed. These cases live alongside the broader shortlist suite in `test/cli.test.js`, and
`test/shortlist.test.js` now asserts that compensation filters succeed even when the query omits
currency symbols—mirroring the CLI example above for `--compensation 185k`.

Programmatic consumers can call `syncShortlistJob(jobId)` without metadata to refresh the
timestamp while leaving prior fields intact; `test/shortlist.test.js` now locks in that
touch-only coverage.

Shortlist tags deduplicate case-insensitively so reapplying a label with different casing keeps
filters tidy. Legacy discard tag history is normalized the same way so `Last Discard Tags` and
archive views never repeat labels when older records mix casing.

The CLI stores shortlist labels, discard history, and sync metadata in `data/shortlist.json`, keeping
reasons, timestamps, optional tags, and location/level/compensation fields so recommendations can
surface patterns later. Review past decisions with `jobbot shortlist archive [job_id]` (add `--json`
to inspect all records at once), which reads from `data/discarded_jobs.json` so archive lookups and
shortlist history stay in sync. Archive views list the newest discard first so the latest rationale is
visible immediately, while JSON exports include a newest-first `discarded` array,
`last_discard` summary, and `discard_count`
so downstream tools can surface the most recent rationale and how often a role has been reconsidered
without traversing the full history. Missing timestamps surface as the shared `(unknown time)` placeholder
in both CLI and JSON responses so downstream tooling can rely on a single sentinel. Add `--json` to the
shortlist list command when piping entries into other tools; include `--out <path>` to persist the
snapshot on disk. Filter by metadata or tags (`--location`, `--level`, `--compensation`, or repeated
`--tag` flags) when triaging opportunities. Text output also surfaces `Discard Count` and `Last Discard Tags`
when history exists so the rationale stays visible without opening the archive. Entries without discard history
omit those lines entirely to keep summaries compact. CLI coverage in [`test/cli.test.js`](test/cli.test.js)
asserts the omission so regressions are caught early. When the latest discard omits
tags, the summary prints `Last Discard Tags: (none)` so the absence is explicit. The archive reader trims
messy history entries, sorts them chronologically, and fills missing timestamps with `(unknown time)`
so legacy discards still surface their rationale. Metadata syncs stamp a `synced_at` ISO 8601 timestamp for
refresh schedulers. Shells treat `$` as a variable prefix, so `--compensation "$185k"` expands to
`85k`. The CLI re-attaches a default currency symbol so the stored value becomes `$85k`; escape the
dollar sign (`--compensation "\$185k"`) when you need the digits preserved. Override the auto-attached
symbol by setting `JOBBOT_SHORTLIST_CURRENCY` (for example, `JOBBOT_SHORTLIST_CURRENCY='€'`).
Existing shortlist files missing a currency symbol are normalized on read using the same default so
filters and reports stay consistent. Programmatic filters apply the same default when the
compensation criterion omits a symbol, letting `filterShortlist({ compensation: '185k' })`
match stored `$185k` entries just like the CLI.
Newest-first shortlist snapshots saved by earlier releases now derive `last_discard` from the
leading entry, keeping the summary aligned with the exported history. Unit coverage in
[`test/shortlist.test.js`](test/shortlist.test.js) locks in this legacy scenario alongside the discard
ordering assertions so downstream tooling always sees the latest rationale in both fields.
Unit tests in [`test/shortlist.test.js`](test/shortlist.test.js) and the CLI suite in
[`test/cli.test.js`](test/cli.test.js) exercise metadata updates, tag filters, discard tags, archive
exports, and the persisted format. Additional CLI coverage locks in the `(unknown time)` placeholder
for legacy discard entries so missing timestamps remain readable in archive output, and the shortlist
unit tests now assert that JSON snapshots propagate the same `(unknown time)` sentinel so downstream
consumers see identical state whether they read from the CLI or the JSON file.
[`test/discards.test.js`](test/discards.test.js) now asserts archive order returns the latest discard
first even when older entries remain, keeping the newest-first guarantee enforced.

## Intake responses

Capture intake conversations and keep the answers alongside your profile:

```bash
DATA_DIR=$(mktemp -d)
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot intake record \
  --question "What motivates you?" \
  --answer "Building accessible tools" \
  --tags "growth,mission" \
  --notes "Prefers collaborative teams" \
  --asked-at 2025-02-01T12:34:56Z
# Recorded intake response 123e4567-e89b-12d3-a456-426614174000

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot intake list
# What motivates you?
#   Answer: Building accessible tools
#   Tags: growth, mission
#   Notes: Prefers collaborative teams
#   Asked At: 2025-02-01T12:34:56.000Z
#   Recorded At: 2025-02-01T12:40:00.000Z
#   ID: 123e4567-e89b-12d3-a456-426614174000

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot intake record \
  --question "Which benefits matter most?" \
  --skip \
  --notes "Circle back after research"
# Recorded intake response 987e6543-e21b-45d3-a456-426614174001

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot intake list --json | jq '.responses[1]'
# {
#   "question": "Which benefits matter most?",
#   "answer": "",
#   "status": "skipped",
#   "notes": "Circle back after research",
#   "asked_at": "2025-02-01T12:40:00.000Z",
#   "recorded_at": "2025-02-01T12:40:00.000Z",
#   "id": "987e6543-e21b-45d3-a456-426614174001"
# }

# Surface pending follow-ups:
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot intake list --skipped-only
# Which benefits matter most?
#   Status: Skipped
#   Answer: (skipped)
#   Notes: Circle back after research
#   Asked At: 2025-02-01T12:40:00.000Z
#   Recorded At: 2025-02-01T12:40:00.000Z
#   ID: 987e6543-e21b-45d3-a456-426614174001

# Turn answered prompts into bullet suggestions tagged by competency
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot intake bullets --json
# {
#   "bullets": [
#     {
#       "text": "Led SRE incident response overhaul",
#       "tags": ["Leadership", "SRE"],
#       "source": {
#         "question": "Tell me about a leadership win",
#         "response_id": "123e4567-e89b-12d3-a456-426614174000"
#       }
#     }
#   ]
# }
# Filter suggestions to specific skills
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot intake bullets --tag metrics
```

Entries are appended to `data/profile/intake.json` with normalized timestamps, optional tags, notes,
and a `status` field so follow-up planning can reference prior answers and revisit skipped prompts.
Run `jobbot intake` without a subcommand to see the available modes (`record`, `list`, and `bullets`);
the CLI suite in [`test/cli.test.js`](test/cli.test.js) keeps this usage output aligned.
Recorded timestamps reflect when the command runs. Automated coverage in
[`test/intake.test.js`](test/intake.test.js) and [`test/cli.test.js`](test/cli.test.js) verifies the
stored shape, CLI workflows, and the skipped-only view for follow-up planning.

## Conversion funnel analytics

Build a quick snapshot of outreach ➜ screening ➜ onsite ➜ offer ➜ acceptance conversions:

```bash
DATA_DIR=$(mktemp -d)
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track log job-1 --channel email --date 2025-01-02
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track add job-1 --status screening

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track log job-2 --channel referral --date 2025-01-03
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track add job-2 --status onsite

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track log job-3 --channel email --date 2025-01-04
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track add job-3 --status offer
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track log job-3 --channel offer_accepted --date 2025-02-01

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track log job-4 --channel email --date 2025-01-05
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track add job-4 --status rejected

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track history job-3
# job-3
# - email (2025-01-04T00:00:00.000Z)
#   Documents: resume.pdf
#   Note: Submitted via referral portal
# - offer_accepted (2025-02-01T00:00:00.000Z)
#   Reminder: 2025-02-10T09:00:00.000Z

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot analytics funnel
# Outreach: 4
# Screening: 1 (25% conversion, 3 drop-off)
# Onsite: 1 (100% conversion)
# Offer: 1 (100% conversion)
# Acceptance: 1 (100% conversion)
# Largest drop-off: Outreach → Screening (3 lost)
# Tracked jobs: 5 total; 4 with outreach events

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot analytics funnel --json | jq '.stages[0]'
# {
#   "key": "outreach",
#   "label": "Outreach",
#   "count": 4,
#   "dropOff": 0,
#   "conversionRate": 1
# }

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot analytics export --out analytics.json
# Saved analytics snapshot to /tmp/jobbot-cli-XXXX/analytics.json
# jq '.channels' analytics.json
# {
#   "email": 1,
#   "offer_accepted": 1,
#   "referral": 1
# }

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot analytics compensation
# Compensation summary (3 parsed of 4 entries; 1 unparsed)
# - $ — 1 job
#   Range: $185,000 – $185,000
#   Average midpoint: $185,000
#   Median midpoint: $185,000
# - € — 2 jobs (1 range)
#   Range: €95,000 – €140,000
#   Average midpoint: €107,500
#   Median midpoint: €107,500
# Unparsed entries:
# - job-unparsed: Competitive

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot analytics compensation --json | jq '.currencies[0].stats'
# {
#   "count": 1,
#   "single_value": 1,
#   "range": 0,
#   "minimum": 185000,
#   "maximum": 185000,
#   "average": 185000,
#   "median": 185000
# }
```

Analytics helpers respect `JOBBOT_DATA_DIR` and `setAnalyticsDataDir()` overrides for shortlist
metadata as well as lifecycle records, so temporary fixtures and tests can point compensation
reports at isolated directories without touching production data. The corresponding unit tests in
[`test/analytics.test.js`](test/analytics.test.js) assert this override propagation.

The analytics command reads `applications.json` and `application_events.json`, summarising stage
counts, drop-offs, and conversion percentages. A dedicated unit test in
[`test/analytics.test.js`](test/analytics.test.js) and a CLI flow in [`test/cli.test.js`](test/cli.test.js)
cover outreach counts, acceptance detection, JSON formatting, the largest drop-off highlight, and the
anonymized snapshot export. Additional analytics coverage in those suites exercises the compensation
summary so currency ranges, averages, and text/JSON formatting stay stable. The `analytics export`
subcommand captures aggregate status counts and event channels without embedding raw job identifiers
so personal records stay scrubbed. JSON exports now include a `funnel.sankey` payload describing nodes
and links for outreach ➜ acceptance flows, making it trivial to render Sankey diagrams without
recomputing the stage math. They also surface an `activity` summary that counts how many deliverable
runs and interview sessions exist across the data directory without revealing the associated job IDs,
giving the recommender a privacy-preserving signal about tailoring and rehearsal momentum. Legacy
deliverable folders that store files directly under a job directory are counted as a single run so
older tailoring archives stay visible in the activity totals.

When outreach events exist without a matching lifecycle status, the report now prints a
`Missing data: …` line listing the affected job IDs so you can backfill outcomes quickly.
Exported snapshots expose only a count in `funnel.missing.statuslessJobs` so shared analytics stay
anonymized.

## Interview session logs

Capture rehearsal transcripts, reflections, and coach feedback per interview loop:

```bash
DATA_DIR=$(mktemp -d)
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot interviews record job-123 prep-2025-02-01 \
  --stage Onsite \
  --mode Voice \
  --transcript "Practiced STAR story covering situation, task, action, and result." \
  --reflections "Tighten capacity estimates" \
  --feedback "Great storytelling" \
  --notes "Follow up on salary research" \
  --started-at 2025-02-01T09:00:00Z \
  --ended-at 2025-02-01T10:15:00Z
# Recorded session prep-2025-02-01 for job-123

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot interviews show job-123 prep-2025-02-01
# {
#   "job_id": "job-123",
#   "session_id": "prep-2025-02-01",
#   "recorded_at": "2025-02-01T09:00:00.000Z",
#   "stage": "Onsite",
#   "mode": "Voice",
#   "transcript": "Practiced STAR story covering situation, task, action, and result.",
#   "reflections": ["Tighten capacity estimates"],
#   "feedback": ["Great storytelling"],
#   "notes": "Follow up on salary research",
#   "started_at": "2025-02-01T09:00:00.000Z",
#   "ended_at": "2025-02-01T10:15:00.000Z",
#   "heuristics": {
#     "brevity": {
#       "word_count": 9,
#       "sentence_count": 1,
#       "average_sentence_words": 9,
#       "estimated_wpm": 0.1
#     },
#     "filler_words": {
#       "total": 0,
#       "counts": {}
#     },
#     "structure": {
#       "star": {
#         "mentioned": ["situation", "task", "action", "result"],
#         "missing": []
#       }
#     }
#   }
# }

# Generate a system design rehearsal plan tailored to the role
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot interviews plan --stage system-design --role "Staff Engineer"
# System Design rehearsal plan
# Role focus: Staff Engineer
# Suggested duration: 75 minutes
#
# Draft scalable architectures that balance user impact, cost, and reliability.
#
# Flashcards
# - Capacity planning → Quantify QPS, latency budgets, and storage needs upfront.
# - Resilience checklist → Map failure domains, redundancy, and rollback strategies.
#
# Question bank
# 1. Design a multi-region feature flag service. (Reliability)
# 2. Scale a read-heavy API to millions of users. (Scalability)
#
# Dialog tree
# - opener — Walk me through a recent project you led end-to-end.
#   Follow-ups:
#   * What made it high impact for the business?
#   * Which metrics or signals proved it worked?
#   * How did you bring partners along the way?
# - resilience — Share a time you navigated conflict with a stakeholder.
#   Follow-ups:
#   * How did you surface the disagreement early?
#   * What trade-offs or data helped resolve it?
#
# Requirements
# - Clarify functional and non-functional requirements along with success metrics.
# - List constraints around traffic, latency budgets, data retention, and compliance.
#
# Architecture
# - Sketch the high-level architecture with labeled components, data flow, and ownership for Staff Engineer use cases.
# - Call out storage choices, consistency trade-offs, and critical dependencies.
#
# Scaling & reliability
# - Estimate capacity, identify bottlenecks, and outline mitigation strategies.
# - Define observability signals, failure modes, and a rollout or migration plan.
#
# Reflection
# - Document follow-up topics or gaps to research before the next session.
# - Summarize trade-offs to communicate during the interview debrief.
#
# Resources
# - System design checklist
# - Capacity planning worksheet

# Keep recruiter phone screens tight by centering the pitch, motivators, and logistics
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot interviews plan --stage screen --role "Engineering Manager"
# Screen rehearsal plan
# Role focus: Engineering Manager
# Suggested duration: 30 minutes
#
# Lead the recruiter screen with a crisp narrative, clear motivators, and shared expectations.
#
# Pitch warm-up
# - Draft a 60-second story tying recent wins to the Engineering Manager opportunity.
# - Line up 2-3 follow-up examples with metrics and outcomes ready to share.
#
# Logistics & next steps
# - Confirm timeline, interview loop, and decision process before hanging up.
# - Prepare salary, location, and availability guardrails with data points.

# Prep the onsite loop with logistics, dialog drills, and follow-up checklists
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot interviews plan --onsite
# Onsite rehearsal plan
# Suggested duration: 150 minutes
#
# Coordinate the onsite loop with smooth transitions, steady energy, and clear follow-ups.
#
# Flashcards
# - Panel transitions → Reset, summarize, and confirm expectations between interviews.
# - Energy reset → Plan hydration, nutrition, and breaks to stay sharp all day.
#
# Question bank
# 1. How will you tailor your opener for each onsite session? (Communication)
# 2. What signals do you want every interviewer to carry into the debrief? (Strategy)
#
# Dialog tree
# - transitions — Walk me through how you reset between onsite sessions and stay present.
#   Follow-ups:
#   * What cues help you tailor intros for each interviewer?
#   * How do you capture notes for thank-you follow-ups before the next room?
# - debrief — Outline your plan for the onsite debrief once the loop wraps up.
#   Follow-ups:
#   * Which signals confirm the loop went well or needs triage?
#   * How do you close the loop on commitments after the thank-you emails?
#
# Agenda review
# - Confirm interview schedule, formats, and expectations with your recruiter.
# - Note interviewer backgrounds and tailor intros for each panel.
#
# Energy & logistics
# - Plan meals, breaks, wardrobe, workspace, and travel buffers for the onsite day.
# - Stage materials (resume variants, notebook, metrics) and reminders for check-ins.
#
# Story rotation
# - Map STAR stories to each session and vary examples across interviews.
# - List clarifying questions to open and close each room confidently.
#
# Follow-up
# - Draft thank-you note bullet points per interviewer while details are fresh.
# - Capture risks, commitments, and next steps immediately after the loop.

# Capture a quick behavioral rehearsal with generated session IDs (defaults to Behavioral/Voice)
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot rehearse job-123 \
  --transcript "Walked through leadership story" \
  --reflections "Add quantified wins" \
  --feedback "Great pacing" \
  --notes "Send thank-you email"
# Recorded rehearsal prep-2025-02-01T09-00-00Z for job-123

# Transcribe a quick voice rehearsal with a local STT command
JOBBOT_SPEECH_TRANSCRIBER="node local/transcribe.js --file {{input}}" \
  JOBBOT_DATA_DIR=$DATA_DIR npx jobbot rehearse job-123 --audio recordings/answer.wav
# Recorded rehearsal prep-2025-02-01T09-00-00Z for job-123

# Read behavioral dialog prompts aloud with a local TTS command
JOBBOT_SPEECH_SYNTHESIZER="node local/say.js --text {{input}}" \
  JOBBOT_DATA_DIR=$DATA_DIR npx jobbot interviews plan --stage behavioral --speak
```

Sessions are stored under `data/interviews/{job_id}/{session_id}.json` with ISO 8601 timestamps so
coaches and candidates can revisit transcripts later. Stage and mode default to `Behavioral` and
`Voice` when omitted, mirroring the quick-runthrough workflow. Run `jobbot rehearse <job_id>` with no
additional flags to log a placeholder session that captures those defaults before you add richer
transcripts or feedback. Configure
`JOBBOT_SPEECH_TRANSCRIBER` with a local command that accepts the audio path via `{{input}}`
(or pass `--transcriber <command>` at runtime) to automatically transcribe recordings;
the CLI records the derived transcript alongside an `audio_source` marker. Set
`JOBBOT_SPEECH_SYNTHESIZER` (or pass `--speaker <command>`) to narrate the entire study packet when
`jobbot interviews plan --speak` is used—the stage header, role focus, suggested duration, summary,
section checklists, resources, flashcards, question bank prompts, and dialog tree follow-ups all
stream through the synthesizer so candidates can drill hands-free. The CLI accepts `--*-file`
options for longer inputs (for example,
`--transcript-file transcript.md`). Automated coverage in
[`test/interviews.test.js`](test/interviews.test.js) and [`test/cli.test.js`](test/cli.test.js)
verifies persistence, retrieval paths, stage/mode shortcuts, the defaulted rehearse metadata, audio
transcription integration, synthesizer execution for the narrated sections (including resources and
flashcards), manual recordings inheriting the same Behavioral/Voice defaults (even when no
transcript is provided), and the stage-specific rehearsal plans emitted by `jobbot interviews plan`.
Plans now include a `Flashcards` checklist, a numbered `Question bank`, and a branching `Dialog tree`
so candidates can drill concepts by focus area and practice follow-ups; the updated tests assert that
all sections appear in JSON and CLI output. New coverage in
[`test/interviews.test.js`](test/interviews.test.js) locks in the Onsite logistics plan’s dialog
prompts alongside the recruiter screen pitch and timeline checkpoints, while
[`test/cli.test.js`](test/cli.test.js) confirms the CLI surfaces the screen plan’s timeline
reminders, stage transitions, audio metadata, and synthesized study-packet narration consistently
across releases.

Recorded sessions now attach a `heuristics` block that summarizes brevity (word count, sentence
count, average sentence length, and estimated words per minute when timestamps are present), filler
phrases, and STAR coverage so coaches can spot habits that need refinement. A new
`critique.tighten_this` array highlights the biggest opportunities to tighten delivery—flagging
missing STAR components, filler-word spikes, or overlong answers. Updated coverage in
[`test/interviews.test.js`](test/interviews.test.js) exercises filler detection, STAR summaries, and
the tighten-this critique, and the CLI suite in [`test/cli.test.js`](test/cli.test.js) asserts those
heuristics persist in the archived JSON payloads.

## Deliverable bundles

Export the most recent deliverables run for a job—resume, cover letter, prep notes—into a single
archive:

```bash
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot deliverables bundle job-123 --out job-123-bundle.zip
# Bundled job-123 deliverables to /tmp/jobbot-cli-XXXX/job-123-bundle.zip
```

The bundler targets the newest timestamped directory under `data/deliverables/{job_id}/` by
default. Pass `--timestamp <iso8601>` to capture an earlier run. Bundles retain nested folder
structure (for example, `notes/interview.txt`). Automated coverage in
[`test/deliverables.test.js`](test/deliverables.test.js) exercises latest-run selection and explicit
timestamps, and the CLI suite verifies `jobbot deliverables bundle` writes archives to disk.

See [DESIGN.md](DESIGN.md) for architecture details and roadmap.
See [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) for a list of prompt documents.
See [docs/chore-catalog.md](docs/chore-catalog.md) for the recurring chores and required commands
that keep those workflows green.

## Raspberry Pi console fonts

Pi images bake a default console font so `setfont -d` works out of the box.
The Pi image build config copies a fallback font into
`/usr/share/consolefonts` when no default is present, letting you change the
font size immediately after logging in.

## Tracking Application Lifecycle

Application statuses such as `no_response`, `screening`, `onsite`, `offer`, `rejected`,
`withdrawn`, and acceptance outcomes (`accepted`, `acceptance`, `hired`) are saved to
`data/applications.json`, a git-ignored file. Legacy entries using `next_round` still load for
backward compatibility. Set `JOBBOT_DATA_DIR` to change the directory. These records power local
Sankey diagrams so progress isn't lost between sessions.
Writes are serialized to avoid dropping entries when recording multiple applications at once.
If the file is missing it will be created, but other file errors or malformed JSON will throw.
Unit tests cover each status, concurrent writes, missing files, invalid JSON, and rejection of
unknown values.

Record and track your applications directly from the CLI—never edit JSON by hand.

To capture statuses:

```bash
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot track add job-123 --status screening \
  --note "Emailed hiring manager"
# Recorded job-123 as screening
```

This persists entries to `applications.json` as objects that record the status,
an `updated_at` ISO 8601 timestamp, and optional notes:

```json
{
  "job-123": {
    "status": "screening",
    "note": "Emailed hiring manager",
    "updated_at": "2025-02-01T10:00:00.000Z"
  }
}
```

Unit coverage in [`test/lifecycle.test.js`](test/lifecycle.test.js) and CLI
automation in [`test/cli.test.js`](test/cli.test.js) verify note persistence and
timestamp normalization alongside the existing status checks.

To capture outreach history:

Use `jobbot track log <job_id> --channel <channel>` to record the outreach trail
for each application. The command accepts optional metadata such as `--date`,
`--contact`, `--documents` (comma-separated), `--note`, and `--remind-at`.
Events are appended to `data/application_events.json`, grouped by job
identifier, with timestamps normalized to ISO 8601.

Review the full history for a job with `jobbot track history <job_id>`. Pass
`--json` to integrate with other tooling:

```bash
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track history job-1
# job-1
# - follow_up (2025-03-01T08:00:00.000Z)
#   Note: Send status update
# - call (2025-03-05T09:00:00.000Z)
#   Contact: Avery Hiring Manager
#   Reminder: 2025-03-07T12:00:00.000Z
```

Tests in `test/application-events.test.js` ensure that new log entries do not
clobber history and that invalid channels or dates are rejected.
`test/cli.test.js` adds coverage for the history subcommand's text and JSON
outputs, including channel-first bullet formatting and reminder labels, so the
note-taking surface stays reliable.

Summarize the lifecycle board with `jobbot track board` to see which stage each
application currently occupies. The board prints lifecycle columns in the
defined order (including `next_round` and the acceptance synonyms) and orders
entries newest-first within each column:

```bash
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track board
# No Response
# - job-4 (2025-03-02T17:30:00.000Z)
#
# Screening
# - job-1 (2025-03-05T12:00:00.000Z)
#   Note: Awaiting recruiter reply
#   Reminder: 2025-03-07T09:00:00.000Z (follow_up, upcoming)
#   Reminder Note: Send prep agenda
#   Reminder Contact: Avery Hiring Manager
#
# Onsite
# - job-2 (2025-03-06T15:45:00.000Z)
#
# Offer
# - job-3 (2025-03-07T10:15:00.000Z)
#   Note: Prep for negotiation call
#   Reminder: 2025-03-08T16:00:00.000Z (call, upcoming)

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track board --json | jq '.columns[1]'
# {
#   "status": "screening",
#   "jobs": [
#     {
#       "job_id": "job-1",
#       "status": "screening",
#       "updated_at": "2025-03-05T12:00:00.000Z",
#       "note": "Awaiting recruiter reply",
#       "reminder": {
#         "job_id": "job-1",
#         "remind_at": "2025-03-07T09:00:00.000Z",
#         "past_due": false,
#         "channel": "follow_up",
#         "note": "Send prep agenda",
#         "contact": "Avery Hiring Manager"
#       }
#     }
#   ]
# }
```

Jobs that do not have a scheduled follow-up still include a `"reminder": null`
placeholder in the JSON payload so downstream tooling can distinguish an
explicit "no reminder" state without checking for a missing field. The text
board continues to print `Reminder: (none)` in the same scenario.

Notes stay attached to each entry so checklists remain visible alongside due
reminders and outreach history when triaging the pipeline. Each job now shows
the next reminder (with channel, note, and contact) directly on the board, and
JSON payloads expose the same `reminder` object for downstream tooling.
Jobs without a scheduled follow-up display `Reminder: (none)` so you can confirm
nothing is queued for that opportunity. When a job carries multiple reminders,
the board surfaces the soonest upcoming entry and falls back to the most recent
past-due reminder when no future timestamp is scheduled.

### Lifecycle experiment playbooks

Every lifecycle column now publishes pre-registered experiment scaffolding so we
can run small, statistically sound A/B tests without forcing applicants to write
custom math. The new [`src/lifecycle-experiments.js`](src/lifecycle-experiments.js)
module exposes helpers that map lifecycle stages to ready-to-run experiments,
including hypotheses, minimum sample sizes, guardrail metrics, and sequential
stopping rules. Use them to compare resume tone variations, onsite follow-up
cadences, or offer-negotiation scripts while automatically adjusting for multiple
comparisons and guarding against p-hacking/data dredging anti-patterns.

```js
import {
  listExperimentsForStatus,
  analyzeExperiment,
} from 'jobbot3000';

const experiments = listExperimentsForStatus('screening');
const analysis = analyzeExperiment('screening_resume_language', {
  primaryMetric: {
    control: { successes: 18, trials: 200 },
    variants: {
      warm_language: { successes: 34, trials: 200 },
    },
  },
});

console.log(analysis.recommendationSummary);
```

Actionable summaries pair recommendations with the supporting effect sizes, guardrail
checks, and adjusted p-values so users can make confident changes quickly. See
[`docs/lifecycle-experiments.md`](docs/lifecycle-experiments.md) for the full set of
experiments, analysis plans, and reporting guardrails.

Surface follow-up work with `jobbot track reminders`. Pass `--now` to view from a
given timestamp (defaults to the current time), `--upcoming-only` to suppress past-due
entries, and `--json` for structured output. The digest groups results by urgency so
past-due work stays visible without scanning the whole list. Empty sections print `(none)` so
you can confirm there isn't hidden work before moving on. When no reminders exist, the command
still prints the `Past Due` and `Upcoming` headings with `(none)` placeholders so the absence is
explicit; the CLI suite in [`test/cli.test.js`](test/cli.test.js) now covers the zero-reminder
case to keep that behavior locked in:

```bash
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track reminders --now 2025-03-06T00:00:00Z
# Past Due
# job-1 — 2025-03-05T09:00:00.000Z (follow_up)
#   Note: Send status update
#
# Upcoming
# job-2 — 2025-03-07T15:00:00.000Z (call)
#   Contact: Avery Hiring Manager
```

Unit tests in [`test/application-events.test.js`](test/application-events.test.js)
cover reminder extraction, including past-due filtering. The CLI suite in
[`test/cli.test.js`](test/cli.test.js) verifies the `--json` output and ensures the
`Past Due`/`Upcoming` headings stick around with `(none)` placeholders when a bucket is empty.

To capture discard reasons for shortlist triage:

```bash
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot track discard job-456 --reason "Salary too low"
# Discarded job-456: Salary too low
```

Discarded roles are archived in `data/discarded_jobs.json` with their reasons,
timestamps, and optional tags so future recommendations can reference prior
decisions. The `track discard` command shares the shortlist writer so history in
`data/shortlist.json` stays aligned even when discards originate from the track
workflow. Unit tests in `test/discards.test.js` and the CLI suite cover the JSON
format and command invocation.

## Documentation

- [DESIGN.md](DESIGN.md) – architecture details and roadmap
- [SECURITY.md](SECURITY.md) – security guidelines
- [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) – prompt reference index
- [docs/user-journeys.md](docs/user-journeys.md) – primary user journeys and flows

## License

This project is licensed under the terms of the [MIT License](LICENSE).
