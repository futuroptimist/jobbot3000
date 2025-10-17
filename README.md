# 🎯 jobbot3000

[![CI](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/ci.yml?label=ci)](https://github.com/futuroptimist/jobbot3000/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/codeql.yml?label=codeql)](https://github.com/futuroptimist/jobbot3000/actions/workflows/codeql.yml)
[![Web screenshots](https://img.shields.io/github/actions/workflow/status/futuroptimist/jobbot3000/.github/workflows/web-screenshots.yml?label=web%20screenshots)](https://github.com/futuroptimist/jobbot3000/actions/workflows/web-screenshots.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

**jobbot3000** is a self-hosted, open-source job search copilot.

## Quickstart

Requires Node.js 20+.

```bash
npm install
npm run dev
# Open http://127.0.0.1:3100
```

That's it! The web server will start with all backend functionality enabled.

For detailed setup, CLI usage, and environment options, see [docs/getting-started.md](docs/getting-started.md).

## HTTP client example

Use the built-in HTTP client helper when integrating with external services:

```js
import { createHttpClient } from './src/services/http.js';

const client = createHttpClient({
  baseUrl: 'https://api.example.com',
});

const response = await client.get('/status');
console.log(await response.json());
```

Run the snippet with `node example.js` after saving it to a file in the project root.

## Documentation

- [DESIGN.md](DESIGN.md) – architecture details and roadmap
- [SECURITY.md](SECURITY.md) – security guidelines
- [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) – prompt reference index
- [docs/user-journeys.md](docs/user-journeys.md) – primary user journeys and flows
- [GitHub Actions: web-screenshots.yml](https://github.com/futuroptimist/jobbot3000/actions/workflows/web-screenshots.yml) – captures the latest UI flows for regressions

## UI screenshots

![Overview screen](docs/screenshots/overview.png "Overview screen")
![Applications pipeline](docs/screenshots/applications.png "Applications pipeline")
![Command palette](docs/screenshots/commands.png "Command palette")
![Audit log](docs/screenshots/audits.png "Audit log")
![Analytics dashboard](docs/screenshots/analytics.png "Analytics dashboard")

## License

This project is licensed under the terms of the [MIT License](LICENSE).
