# Getting Started

This guide covers installation, development, and the experimental web interface.

## Prerequisites

- Node.js 20+
- macOS, Linux, WSL, or Windows 11

## Install

```bash
npm install
```

## Run the web interface

```bash
npm run dev
# jobbot web server listening on http://127.0.0.1:3100
```

Visit http://127.0.0.1:3100 and use the tabs to explore.

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
- `npx jobbot shortlist ...` | `npx jobbot track ...`

For deeper docs, see:
- Architecture: `docs/architecture.md`
- Web Operations: `docs/web-operational-playbook.md`
- Job Source Adapters: `docs/job-source-adapters-guide.md`
