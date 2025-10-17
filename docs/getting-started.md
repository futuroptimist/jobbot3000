# Getting Started

This guide covers installation, development, and the experimental web interface.

## Prerequisites

- Node.js 20+
- macOS, Linux, WSL, or Windows 11

## Quick Start

Get up and running in two steps:

```bash
npm install       # Install dependencies (fast - no heavy test tools)
npm run dev       # Start the fully functional web server with backend
```

The web server will be available at http://127.0.0.1:3100 with all features enabled.

> **Note:** For running tests, you'll need to install Playwright first: `npm run prepare:test`

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
