#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';
import { loadWebConfig } from '../src/web/config.js';
import { startWebServer } from '../src/web/server.js';

function getFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printUsage() {
  console.error(
    'Usage: node scripts/web-server.js [--env <environment>] [--host <value>] [--port <number>] ' +
      '[--rate-limit-window-ms <number>] [--rate-limit-max <number>] [--csrf-header <value>] ' +
      '[--csrf-token <value>]',
  );
}

async function main() {
  const args = process.argv.slice(2);
  const env = getFlag(args, '--env');
  const hostOverride = getFlag(args, '--host');
  const portOverride = getFlag(args, '--port');
  const rateWindowOverride = getFlag(args, '--rate-limit-window-ms');
  const rateMaxOverride = getFlag(args, '--rate-limit-max');
  const csrfHeaderOverride = getFlag(args, '--csrf-header');
  const csrfTokenOverride = getFlag(args, '--csrf-token');

  let version = 'dev';
  try {
    const packageJsonUrl = new URL('../package.json', import.meta.url);
    const raw = await fs.readFile(packageJsonUrl, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === 'string' && parsed.version.trim()) {
      version = parsed.version.trim();
    }
  } catch {
    // Ignore version lookup failures; fall back to "dev".
  }

  let config;
  try {
    config = loadWebConfig({
      env,
      host: hostOverride,
      port: portOverride,
      rateLimit: {
        windowMs: rateWindowOverride,
        max: rateMaxOverride,
      },
      csrfHeaderName: csrfHeaderOverride,
      csrfToken: csrfTokenOverride,
      version,
    });
  } catch (err) {
    printUsage();
    throw err;
  }

  const server = await startWebServer({
    host: config.host,
    port: config.port,
    info: config.info,
    healthChecks: [],
    rateLimit: config.rateLimit,
    csrfToken: config.csrfToken,
    csrfHeaderName: config.csrfHeaderName,
  });

  console.log(`jobbot web server listening on ${server.url}`);
  console.log(`Environment: ${config.env}`);
  console.log(
    `Attach ${server.csrfHeaderName}: ${server.csrfToken} to POST /commands requests.`,
  );
  console.log('Treat the CSRF token as a secret.');
  console.log('Press Ctrl+C to stop.');

  await new Promise((resolve, reject) => {
    const signals = ['SIGINT', 'SIGTERM'];
    const cleanup = async signal => {
      try {
        await server.close();
      } catch (err) {
        reject(err);
        return;
      }
      console.log(`Received ${signal}; server stopped.`);
      resolve();
    };

    for (const signal of signals) {
      process.once(signal, cleanup);
    }
  });
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
