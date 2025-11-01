# Getting Started

This guide covers installation, development, and the experimental web interface.

## Project setup

Follow these steps the first time you clone the repository:

```bash
npm ci                # Install exact lockfile dependencies
cp .env.example .env  # Optional: customize environment overrides locally
npm run dev           # Start the fully functional web server with backend
```

The web server will be available at http://127.0.0.1:3100 with all features enabled. Use
`npm run web:server -- --disable-native-cli` if you want to explore the mock-only UI without
spawning CLI subprocesses.

> **Note:** For running tests, you'll need to install Playwright first: `npm run prepare:test`

## CLI dependencies

- Node.js 20+
- npm (bundled with Node) for executing `npx jobbot` commands and project scripts
- Optional: `docker` if you plan to run the hardened compose stack documented in
  [`docs/web-operational-playbook.md`](web-operational-playbook.md)

When invoking CLI workflows, prefer the bundled executables so global installs stay optional:

```bash
npx jobbot init
npx jobbot summarize <file-or-url>
npx jobbot match --resume <file> --job <file>
npx jobbot profile snapshot --note "First draft"
npx jobbot shortlist ... | npx jobbot track ...
```

## Test commands

Run these commands before committing to keep trunk green and match CI:

```bash
npm run lint
npm run test:ci
npm run test -- --watch  # Focus on a single suite when iterating locally
```

Vitest runs in a single worker to avoid RPC timeouts. Expect `npm run test:ci` to take a few minutes on
slower machines. Install Playwright browsers with `npm run prepare:test` before executing UI suites.

## Connecting to Real Job Boards

By default, jobbot3000 runs with `JOBBOT_FEATURE_SCRAPING_MOCKS=true`, allowing you to explore without API tokens. To connect to
real job boards:

1. **Copy the example environment file:**

   ```bash
   cp .env.example .env
   ```

2. **Get API tokens** from each provider you want to use:
   - [Greenhouse API Token](https://developers.greenhouse.io/harvest.html#authentication)
   - [Lever API Token](https://hire.lever.co/developer/documentation#authentication)
   - [SmartRecruiters Token](https://developers.smartrecruiters.com/docs/getting-started)
   - [Workable API Token](https://workable.readme.io/reference/generate-an-access-token)

3. **Add tokens to `.env`** and set `JOBBOT_FEATURE_SCRAPING_MOCKS=false`

4. **Restart the server:** `npm run dev`

See the [README API Setup section](../README.md#api-setup-optional) for detailed instructions, or [docs/configuration-cookbook.md](configuration-cookbook.md) for advanced configuration.

## Environment overrides

- `JOBBOT_WEB_ENV`: `development` | `staging` | `production`
- `JOBBOT_WEB_HOST`: host (default `127.0.0.1` in development)
- `JOBBOT_WEB_PORT`: port (default `3100` in development)
- `JOBBOT_WEB_RATE_LIMIT_WINDOW_MS`, `JOBBOT_WEB_RATE_LIMIT_MAX`
- `JOBBOT_WEB_CSRF_HEADER`, `JOBBOT_WEB_CSRF_TOKEN`

## CLI quick reference

- `npx jobbot init`
- `npx jobbot summarize <file-or-url>`
- `npx jobbot match --resume <file> --job <file>`
- `npx jobbot profile snapshot --note "First draft"`
- `npx jobbot shortlist ...` | `npx jobbot track ...`

For deeper docs, see:

- Architecture: `docs/architecture.md`
- Web Operations: `docs/web-operational-playbook.md`
- Job Source Adapters: `docs/job-source-adapters-guide.md`
