# 🎯 jobbot3000

**jobbot3000** is a self-hosted, open-source job search copilot.
It was bootstrapped from
[futuroptimist/flywheel](https://github.com/futuroptimist/flywheel) and uses its
practices for linting, testing, and documentation.

## Getting Started

Requires [Node.js](https://nodejs.org/) 20 or newer.

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

# Track an application's status
npx jobbot track add job-123 --status screening
# => Recorded job-123 as screening

# Schedule a follow-up reminder when logging outreach
npx jobbot track log job-123 --channel follow_up --remind-at 2025-03-11T09:00:00Z --note "Check in"
# => Logged job-123 event follow_up
```

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
ignoring `aria-hidden` images or those with `role="presentation"`/`"none"`), and
collapses whitespace to single spaces. Pass `timeoutMs` (milliseconds) to
override the 10s default, and `headers` to send custom HTTP headers. Requests
default to sending `User-Agent: jobbot3000`; provide a `User-Agent` header to
override it. Responses
over 1 MB are rejected; override with `maxBytes` to adjust. Only `http` and
`https` URLs are supported; other protocols throw an error. Requests to
loopback, link-local, carrier-grade NAT, or other private network addresses
are blocked to prevent server-side request forgery (SSRF). Hostnames that
resolve to those private ranges (for example, `127.0.0.1.nip.io`) are rejected
as well; `test/fetch.test.js` now asserts both generic and nip.io guardrails.

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

```js
const { text, metadata } = await loadResume('resume.md', { withMetadata: true });
console.log(metadata);
// {
//   extension: '.md',
//   format: 'markdown',
//   bytes: 2312,
//   characters: 1980,
//   lineCount: 62,
//   wordCount: 340
// }
```

`test/resume.test.js` exercises the metadata branch so downstream callers can
depend on the shape.

Initialize a JSON Resume skeleton when you do not have an existing file:

```bash
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot init
# Initialized profile at /tmp/jobbot-profile-XXXX/profile/resume.json
```

`jobbot init` writes `profile/resume.json` under the data directory with empty
basics, work, education, skills, projects, certificates, and languages
sections. The command is idempotent and preserves existing resumes; see
`test/cli.test.js` and `test/profile.test.js` for coverage.

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
The default locale is `'en'`; Spanish (`'es'`) is also supported.

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

When only the matched or missing lists are present, the Markdown output starts with the
corresponding section heading instead of an extra leading blank line.

The CLI surfaces the same explanation with `jobbot match --explain`, appending a narrative summary
of hits and gaps after the standard Markdown report. JSON output gains an `explanation` field when
the flag is supplied.

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

# Persist a DOCX match report while keeping machine-readable output
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot match --resume resume.txt --job job.txt --json --docx match.docx
# => JSON match report prints to stdout; match.docx contains the formatted document
```

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
```

Each listing in the response is normalised to plain text, parsed for title,
location, and requirements, and written to `data/jobs/{job_id}.json` with a
`source.type` reflecting the provider (`greenhouse`, `lever`, `ashby`,
`smartrecruiters`, or `workable`). Updates reuse the same job identifier so
downstream tooling can diff revisions over time. Tests in
[`test/greenhouse.test.js`](test/greenhouse.test.js),
[`test/lever.test.js`](test/lever.test.js), [`test/ashby.test.js`](test/ashby.test.js),
[`test/smartrecruiters.test.js`](test/smartrecruiters.test.js), and
[`test/workable.test.js`](test/workable.test.js) verify the ingest
pipelines fetch board content, persist structured snapshots, surface fetch
errors, and retain the `User-Agent: jobbot3000` request header alongside each
capture so fetches are reproducible.
[`test/lever.test.js`](test/lever.test.js) now explicitly asserts the Lever
client forwards that header to the API and persists it in saved snapshots so
metadata stays consistent across providers. Automated coverage in
[`test/greenhouse.test.js`](test/greenhouse.test.js) also exercises the retry
logic so transient 5xx responses are retried before surfacing to callers.

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
exercise this path with 120k-line resumes to ensure the tokenizer stays under 200ms. Requirement bullets
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

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist sync job-123 --location Remote --level Senior --compensation "$185k" --synced-at 2025-03-06T08:00:00Z
# Synced job-123 metadata

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist list --location remote
# job-123
#   Location: Remote
#   Level: Senior
#   Compensation: $185k
#   Synced At: 2025-03-06T08:00:00.000Z
#   Tags: dream, remote
#   Last Discard: Not remote (2025-03-05T12:00:00.000Z)

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist list --tag dream --tag remote
# job-123
#   Location: Remote
#   Level: Senior
#   Compensation: $185k
#   Synced At: 2025-03-06T08:00:00.000Z
#   Tags: dream, remote
#   Last Discard: Not remote (2025-03-05T12:00:00.000Z)

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
#       ]
#     }
#   }
# }

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist archive job-123
# job-123
# - 2025-03-05T12:00:00.000Z — Not remote
#   Tags: Remote, onsite
```

The CLI stores shortlist labels, discard history, and sync metadata in `data/shortlist.json`, keeping
reasons, timestamps, optional tags, and location/level/compensation fields so recommendations can
surface patterns later. Review past decisions with `jobbot shortlist archive [job_id]` (add `--json`
to inspect all records at once), which reads from `data/discarded_jobs.json` so archive lookups and
shortlist history stay in sync. Add `--json` to the shortlist list command when piping entries into
other tools, and filter by metadata or tags (`--location`, `--level`, `--compensation`, or repeated
`--tag` flags) when triaging opportunities. Metadata syncs stamp a `synced_at` ISO 8601 timestamp for
refresh schedulers. Unit tests in [`test/shortlist.test.js`](test/shortlist.test.js) and the CLI suite in
[`test/cli.test.js`](test/cli.test.js) exercise metadata updates, tag filters, discard tags, archive
exports, and the persisted format.

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
```

Entries are appended to `data/profile/intake.json` with normalized timestamps, optional tags, and
notes so follow-up planning can reference prior answers. Recorded timestamps reflect when the
command runs. Automated coverage in
[`test/intake.test.js`](test/intake.test.js) and [`test/cli.test.js`](test/cli.test.js) verifies the
stored shape and CLI workflows.

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
```

The analytics command reads `applications.json` and `application_events.json`, summarising stage
counts, drop-offs, and conversion percentages. A dedicated unit test in
[`test/analytics.test.js`](test/analytics.test.js) and a CLI flow in [`test/cli.test.js`](test/cli.test.js)
cover outreach counts, acceptance detection, JSON formatting, the largest drop-off highlight, and the
anonymized snapshot export. The `analytics export` subcommand captures aggregate status counts and
event channels without embedding raw job identifiers so personal records stay scrubbed.

## Interview session logs

Capture rehearsal transcripts, reflections, and coach feedback per interview loop:

```bash
DATA_DIR=$(mktemp -d)
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot interviews record job-123 prep-2025-02-01 \
  --stage Onsite \
  --mode Voice \
  --transcript "Practiced system design walkthrough" \
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
#   "transcript": "Practiced system design walkthrough",
#   "reflections": ["Tighten capacity estimates"],
#   "feedback": ["Great storytelling"],
#   "notes": "Follow up on salary research",
#   "started_at": "2025-02-01T09:00:00.000Z",
#   "ended_at": "2025-02-01T10:15:00.000Z"
# }
```

Sessions are stored under `data/interviews/{job_id}/{session_id}.json` with ISO 8601 timestamps so
coaches and candidates can revisit transcripts later. The CLI accepts `--*-file` options for longer
inputs (for example, `--transcript-file transcript.md`). Automated coverage in
[`test/interviews.test.js`](test/interviews.test.js) and [`test/cli.test.js`](test/cli.test.js)
verifies persistence and retrieval paths.

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

Surface follow-up work with `jobbot track reminders`. Pass `--now` to view from a
given timestamp (defaults to the current time), `--upcoming-only` to suppress past-due
entries, and `--json` for structured output:

```bash
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot track reminders --now 2025-03-06T00:00:00Z
# job-1 — 2025-03-05T09:00:00.000Z (follow_up, past due)
#   Note: Send status update
# job-2 — 2025-03-07T15:00:00.000Z (call, upcoming)
#   Contact: Avery Hiring Manager
```

Unit tests in [`test/application-events.test.js`](test/application-events.test.js)
cover reminder extraction, including past-due filtering. The CLI suite in
[`test/cli.test.js`](test/cli.test.js) verifies the `--json` output.

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
