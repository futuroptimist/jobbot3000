# 🎯 jobbot3000

**jobbot3000** is a self-hosted, open-source job search copilot. It was bootstrapped from [futuroptimist/flywheel](https://github.com/futuroptimist/flywheel) and uses its practices for linting, testing, and documentation.

Requires [Node.js](https://nodejs.org) 20.

## Getting Started

```bash
# Clone your fork
git clone git@github.com:YOURNAME/jobbot3000.git
cd jobbot3000

# Install dependencies
npm ci

# Run repo checks
npm run lint
npm run test:ci

# Summarize a job description
echo "First sentence. Second sentence." | npm run summarize
```

## Docs

- [DESIGN.md](DESIGN.md) – architecture details and roadmap.
- [SECURITY.md](SECURITY.md) – security guidelines.
- [docs/prompt-docs-summary.md](docs/prompt-docs-summary.md) – prompt reference index.

## License

This project is licensed under the terms of the [MIT](LICENSE) license.
