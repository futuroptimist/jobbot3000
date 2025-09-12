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

# Install dependencies (requires Node.js 20 or newer)
npm ci

# Run repo checks
npm run lint
npm run test:ci

# Summarize a job description
# Works with sentences ending in ., ?, or !
# Keep two sentences with --sentences, output plain text with --text
echo "First. Second. Third." | jobbot summarize - --sentences 2 --text
```

In code, import the `summarize` function and pass the number of sentences to keep:

```js
import { summarize } from './src/index.js';

const text = 'First sentence. Second sentence? Third!';
const summary = summarize(text, 2);
console.log(summary);
// "First sentence. Second sentence?"
```

Pass `0` to `summarize` to return an empty string.

Fetch remote job listings, normalize HTML to plain text, and log the result:

```js
import { fetchTextFromUrl } from './src/fetch.js';

const text = await fetchTextFromUrl('https://example.com/job', {
  timeoutMs: 5000,
  headers: { 'User-Agent': 'jobbot' }
});
console.log(text);
// "<job description text>"
```

`fetchTextFromUrl` strips scripts, styles, navigation, footer, and aside content, preserves image
alt text, and collapses whitespace to single spaces. Pass `timeoutMs` (milliseconds) to override the
10s default,
and `headers` to send custom HTTP headers. Only `http` and `https` URLs are supported; other
protocols throw an error.

Normalize existing HTML without fetching:

```js
import { extractTextFromHtml } from './src/fetch.js';

const text = extractTextFromHtml('<p>Hello</p>');
```

Format parsed results as Markdown:

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
//
// Short blurb.
//
// ## Requirements
// - 3+ years JS
```

Pass `url` to include a source link in the rendered Markdown output.
If `summary` is omitted, the requirements section is still separated by a blank line.

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

Job requirements may appear under headers like `Requirements`, `Qualifications`,
`What you'll need`, or `Responsibilities` (used if no other requirement headers are present).
They may start with `-`, `+`, `*`, `•`, `–` (en dash), `—` (em dash), or numeric markers like `1.`
or `(1)`; these markers are stripped when parsing job text, even when the first requirement follows
the header on the same line. Leading numbers without punctuation remain intact. Requirement headers
are located in a single pass to avoid rescanning large job postings, and resume scoring tokenizes
via a manual scanner and caches tokens (up to 60k lines) to avoid repeated work. Requirement bullets
are scanned without regex or temporary arrays, improving large input performance.

See [DESIGN.md](DESIGN.md) for architecture details and roadmap.
See [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) for a list of prompt documents.

## Documentation

- [DESIGN.md](DESIGN.md) – architecture details and roadmap
- [SECURITY.md](SECURITY.md) – security guidelines
- [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) – prompt reference index

## License

This project is licensed under the terms of the [MIT License](LICENSE).
