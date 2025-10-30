# 🎯 jobbot3000

[![CI](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/ci.yml?label=ci)](https://github.com/futuroptimist/jobbot3000/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/codeql.yml?label=codeql)](https://github.com/futuroptimist/jobbot3000/actions/workflows/codeql.yml)
[![Web screenshots](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/web-screenshots.yml?label=web%20screenshots)](https://github.com/futuroptimist/jobbot3000/actions/workflows/web-screenshots.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

**jobbot3000** is a self-hosted, open-source job search copilot.

> [!WARNING]
> The web interface is an experimental preview for local use only. Running production builds or
> deploying to shared or cloud infrastructure can leak secrets, PII, and other sensitive data.
> Operate on trusted hardware while we implement hardened authentication, storage, and network
> isolation. Track the hardening plan in [docs/web-security-roadmap.md](docs/web-security-roadmap.md).

## Quickstart

Requires Node.js 20+.

```bash
npm install
npm run dev
# Open http://127.0.0.1:3100
```

That's it! The web server will start with all backend functionality enabled.
Use `npm run web:server -- --disable-native-cli` if you want to explore the
mock-only UI without spawning CLI subprocesses.

For detailed setup, CLI usage, and environment options, see [docs/getting-started.md](docs/getting-started.md).

## Onboarding checklist

New contributors can ramp up quickly by following this short checklist:

1. Review the architecture map in [docs/architecture.md](docs/architecture.md) to understand how the
   CLI, web adapter, and data stores fit together.
2. Skim the [Configuration Cookbook](docs/configuration-cookbook.md) for required environment
   variables and managed secret options before running commands.
3. Run `npm ci`, `npm run lint`, and `npm run test:ci` to ensure your environment matches CI before
   making changes.
4. Browse the regression suites in [`test/`](test) to see how critical flows are covered and where to
   add new scenarios.

### Recruiter reach-outs

1. Save the raw email to disk, then ingest it: `node bin/ingest-recruiter.ts --source emails/recruiter.txt`.
2. Open **Opportunities ▸ New → Recruiter outreach** to paste additional emails directly from the UI.
3. Confirm the parsed phone screen details (`Phone screen: Thu Oct 23, 2:00 PM PT`) and advance the
   lifecycle when the call finishes. The modal previews the sanitized outreach summary and immediately
   refreshes the applications list so the new event is visible without a page reload.

Automated tests cover both halves of the flow: `test/web-command-adapter.test.js` validates the
`recruiter-ingest` command sanitizes data and closes repositories, while
`test/web-server.test.js` exercises the web modal end-to-end, including the shortlist refresh and
success preview.

Ingestion is idempotent: running the CLI twice for the same email will update the existing
opportunity instead of creating duplicates.

## API Setup (Optional)

By default, jobbot3000 runs with mock data enabled, so you can explore the interface without API tokens. When you're ready to connect to real job boards, follow these steps:

### 1. Create your environment file

```bash
cp .env.example .env
```

### 2. Get your API tokens

Visit each provider's developer portal to generate API tokens:

| Provider            | Documentation                                                                      | Where to get it                                                              |
| ------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Greenhouse**      | [API Documentation](https://developers.greenhouse.io/harvest.html#authentication)  | Your Greenhouse account → Configure → Dev Center → API Credential Management |
| **Lever**           | [API Documentation](https://hire.lever.co/developer/documentation#authentication)  | Settings → Integrations → API                                                |
| **SmartRecruiters** | [API Documentation](https://developers.smartrecruiters.com/docs/getting-started)   | Settings → API & Integrations → API Credentials                              |
| **Workable**        | [API Documentation](https://workable.readme.io/reference/generate-an-access-token) | Settings → Integrations → API                                                |

### 3. Add tokens to your `.env` file

```bash
# Required for live job scraping
JOBBOT_GREENHOUSE_TOKEN=your_greenhouse_token_here
JOBBOT_LEVER_API_TOKEN=your_lever_token_here
JOBBOT_SMARTRECRUITERS_TOKEN=your_smartrecruiters_token_here
JOBBOT_WORKABLE_TOKEN=your_workable_token_here

# Disable mocks to use real APIs
JOBBOT_FEATURE_SCRAPING_MOCKS=false
```

### Update tokens from the web app

Prefer to manage secrets in the UI? Open the **Listings** tab and use the **Provider tokens** panel
to paste each API token. The server writes changes back to your local `.env` file, so manual edits and
web updates stay in sync.

### 4. Restart the server

```bash
npm run dev
```

Your server will now connect to live job boards! 🚀 The development server and CLI automatically
load your `.env` file on startup, so no additional export commands are required.

> **Note:** The `.env` file is gitignored and will never be committed. Keep your tokens secure and never share them publicly.

For advanced configuration options, see [docs/configuration-cookbook.md](docs/configuration-cookbook.md).

### Configure inference & privacy defaults

Use the `settings` command to select your preferred inference provider and align privacy
defaults:

```bash
# Switch to vLLM and choose a model preset
jobbot settings configure --model-provider vllm --model gpt-4o-mini

# Enable analytics redaction and keep interview transcripts stored locally
jobbot settings configure --privacy-redact-analytics on --privacy-store-transcripts on

# Inspect the current configuration
jobbot settings show --json
```

Analytics exports automatically honor the redaction toggle unless you override it with
`--no-redact`, and disabling transcript storage prevents interview sessions from persisting
verbatim transcripts on disk.

## HTTP client example

Use the built-in HTTP client helper when integrating with external services:

```js
import { createHttpClient } from "./src/services/http.js";

const client = createHttpClient({
  baseUrl: "https://api.example.com",
});

const response = await client.get("/status");
console.log(await response.json());
```

Run the snippet with `node example.js` after saving it to a file in the project root.

## Documentation

- [DESIGN.md](DESIGN.md) – architecture details and roadmap
- [SECURITY.md](SECURITY.md) – security guidelines
- [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) – prompt reference index
- [docs/user-journeys.md](docs/user-journeys.md) – primary user journeys and flows
- [docs/backup-restore-guide.md](docs/backup-restore-guide.md) – backup, restore, and verification
  steps
- [GitHub Actions: web-screenshots.yml](https://github.com/futuroptimist/jobbot3000/actions/workflows/web-screenshots.yml) – captures the latest UI flows for regressions

### Durable data export/import

All recruiter outreach, contacts, and lifecycle events live in `data/opportunities.db` (SQLite via
Drizzle ORM). Use the bundled scripts to back up or restore records:

```bash
# Export every table as newline-delimited JSON
node scripts/export-data.ts > backups/opportunities.ndjson

# Validate and import (dry-run)
node scripts/import-data.ts --source backups/opportunities.ndjson --dry-run

# Apply the import
node scripts/import-data.ts --source backups/opportunities.ndjson
```

Both scripts respect `JOBBOT_DATA_DIR` so you can point to alternate data directories during tests or
migrations.

## UI screenshots

![Overview screen](docs/screenshots/overview.png "Overview screen")
![Applications pipeline](docs/screenshots/applications.png "Applications pipeline")
![Command palette](docs/screenshots/commands.png "Command palette")
![Audit log](docs/screenshots/audits.png "Audit log")
![Analytics dashboard](docs/screenshots/analytics.png "Analytics dashboard")

## License

This project is licensed under the terms of the [MIT License](LICENSE).
