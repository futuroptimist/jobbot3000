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

# Install dependencies (requires Node.js 20)
npm ci

# Run repo checks
npm run lint
npm run test:ci

# Summarize a job description
# Works with sentences ending in ., ?, or !
# Keep two sentences with --sentences
echo "First. Second. Third." | jobbot summarize - --sentences 2
```

In code, pass the number of sentences to keep:

```js
import { summarize } from './src/index.js';

const text = 'First sentence. Second sentence? Third!';
console.log(summarize(text, 2));
// → "First sentence. Second sentence?"
```

Fetch remote job listings and normalize HTML to plain text:

```js
import { fetchTextFromUrl } from './src/fetch.js';

const text = await fetchTextFromUrl('https://example.com/job');
```
`fetchTextFromUrl` strips scripts, styles, navigation, and footer content and collapses
whitespace to single spaces.

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

Example: `summarize('"Hi!" Bye.')` returns `"Hi!"`.

Job requirements may appear under headers like `Requirements`, `Qualifications`,
`What you'll need`, or `Responsibilities` (used if no other requirement headers are present).
They may start with `-`, `+`, `*`, `•`, `–` (en dash), or `—` (em dash); these markers are stripped
when parsing job text, even when the first requirement follows the header on the same line.  
Parsing scans lines once to extract title, company, and requirements, reducing overhead.  
Resume scoring tokenizes via a manual scanner and caches tokens to avoid repeated work.

See [DESIGN.md](DESIGN.md) for architecture details and roadmap.
See [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) for a list of prompt documents.

## Documentation

- [DESIGN.md](DESIGN.md) – architecture details and roadmap
- [SECURITY.md](SECURITY.md) – security guidelines
- [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) – prompt reference index

## License

This project is licensed under the terms of the [MIT License](LICENSE).
