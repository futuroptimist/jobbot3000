# 🎯 jobbot3000

**jobbot3000** is a self-hosted, open-source job search copilot. It was bootstrapped from [futuroptimist/flywheel](https://github.com/futuroptimist/flywheel) and uses its practices for linting, testing, and documentation.

## Getting Started

```bash
# Clone your fork
git clone git@github.com:<YOUR_NAME>/jobbot3000.git
cd jobbot3000

# Install dependencies
npm ci

# Run repo checks
npm run lint
npm run test:ci

# Summarize a job description
echo "First sentence. Second sentence." | npm run summarize
```

See [DESIGN.md](DESIGN.md) for architecture details and roadmap.

For security guidelines, read [SECURITY.md](SECURITY.md).

## License

This project is licensed under the terms of the [MIT](LICENSE) license.
