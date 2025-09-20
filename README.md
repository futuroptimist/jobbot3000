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

# Track an application's status
npx jobbot track add job-123 --status screening
# => Recorded job-123 as screening
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
override the 10s default, and `headers` to send custom HTTP headers. Responses
over 1 MB are rejected; override with `maxBytes` to adjust. Only `http` and
`https` URLs are supported; other protocols throw an error. Requests to
loopback, link-local, carrier-grade NAT, or other private network addresses
are blocked to prevent server-side request forgery (SSRF).

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

~~~bash
DATA_DIR=$(mktemp -d)
JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist tag job-123 dream remote
# Tagged job-123 with dream, remote

JOBBOT_DATA_DIR=$DATA_DIR npx jobbot shortlist discard job-123 --reason "Not remote"
# Discarded job-123: Not remote
~~~

The CLI stores shortlist labels and discard history in `data/shortlist.json`, keeping reasons and
timestamps so recommendations can surface patterns later. CLI tests in
[`test/cli.test.js`](test/cli.test.js) cover both commands to lock in the persisted format.

See [DESIGN.md](DESIGN.md) for architecture details and roadmap.
See [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) for a list of prompt documents.

## Raspberry Pi console fonts

Pi images bake a default console font so `setfont -d` works out of the box.
The Pi image build config copies a fallback font into
`/usr/share/consolefonts` when no default is present, letting you change the
font size immediately after logging in.

## Tracking Application Lifecycle

Application statuses such as `no_response`, `screening`, `onsite`, `offer`, `rejected`, and
`withdrawn` are saved to `data/applications.json`, a git-ignored file. Legacy entries using
`next_round` still load for backward compatibility. Set `JOBBOT_DATA_DIR` to change the directory.
These records power local Sankey diagrams so progress isn't lost between sessions.
Writes are serialized to avoid dropping entries when recording multiple applications at once.
If the file is missing it will be created, but other file errors or malformed JSON will throw.
Unit tests cover each status, concurrent writes, missing files, invalid JSON, and rejection of
unknown values.

Record and track your applications directly from the CLI—never edit JSON by hand.

To capture statuses:

~~~bash
JOBBOT_DATA_DIR=$(mktemp -d) npx jobbot track add job-123 --status screening
# Recorded job-123 as screening
~~~

This persists entries to `applications.json`. CLI tests assert that
`jobbot track add` correctly appends and updates statuses.

To capture outreach history:

Use `jobbot track log <job_id> --channel <channel>` to record the outreach trail
for each application. The command accepts optional metadata such as `--date`,
`--contact`, `--documents` (comma-separated), and `--note`. Events are appended
to `data/application_events.json`, grouped by job identifier, with timestamps
normalized to ISO 8601.

Tests in `test/application-events.test.js` ensure that new log entries do not
clobber history and that invalid channels or dates are rejected.

## Documentation

- [DESIGN.md](DESIGN.md) – architecture details and roadmap
- [SECURITY.md](SECURITY.md) – security guidelines
- [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) – prompt reference index
- [docs/user-journeys.md](docs/user-journeys.md) – primary user journeys and flows

## License

This project is licensed under the terms of the [MIT License](LICENSE).
