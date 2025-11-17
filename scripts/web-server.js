#!/usr/bin/env node
import '../src/shared/config/initialize-env.js';
import fs from 'node:fs/promises';
import process from 'node:process';
import { loadWebConfig } from '../src/web/config.js';
import { resolveEnableNativeCli } from '../src/web/resolve-native-cli-flag.js';
import { startWebServer } from '../src/web/server.js';
import { createDefaultHealthChecks } from '../src/web/health-checks.js';

function getFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printUsage() {
  console.error(
    'Usage: node scripts/web-server.js [--env <environment>] [--host <value>] [--port <number>] ' +
      '[--rate-limit-window-ms <number>] [--rate-limit-max <number>] [--csrf-header <value>] ' +
      '[--csrf-token <value>] [--trust-proxy <value>] [--enable-native-cli] [--disable-native-cli]',
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
  const trustProxyOverride = getFlag(args, '--trust-proxy');
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
    config = await loadWebConfig({
      env,
      host: hostOverride,
      port: portOverride,
      rateLimit: {
        windowMs: rateWindowOverride,
        max: rateMaxOverride,
      },
      csrfHeaderName: csrfHeaderOverride,
      csrfToken: csrfTokenOverride,
      trustProxy: trustProxyOverride,
      version,
    });
  } catch (err) {
    printUsage();
    throw err;
  }

  const healthChecks = createDefaultHealthChecks();

  const enableNativeCli = resolveEnableNativeCli({
    args,
    env: process.env,
    configEnv: config?.env,
  });

  const server = await startWebServer({
    host: config.host,
    port: config.port,
    info: config.info,
    healthChecks,
    rateLimit: config.rateLimit,
    trustProxy: config.trustProxy,
    csrfToken: config.csrfToken,
    csrfHeaderName: config.csrfHeaderName,
    enableNativeCli,
    audit: config.audit,
    features: config.features,
    auth: config.auth,
  });

  console.log(`jobbot web server listening on ${server.url}`);
  console.log(`Environment: ${config.env}`);
  console.log(`Attach ${server.csrfHeaderName} to POST /commands requests.`);
  console.log('Retrieve the CSRF token from the configured secrets store.');
  console.log('Treat the CSRF token as a secret.');
  console.log('Press Ctrl+C to stop.');

  if (config.missingSecrets?.length) {
    console.warn('Missing secrets:', config.missingSecrets.join(', '));
  }

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

main().catch(() => {
  const debugEnabled = process.env.JOBBOT_DEBUG === '1';
  console.error(
    'Failed to start web server. Sensitive diagnostics have been suppressed to protect secrets.',
  );
  if (debugEnabled) {
    console.error(
      'JOBBOT_DEBUG=1 is enabled; inspect local development logs for detailed error output.',
    );
  } else {
    console.error('Run with JOBBOT_DEBUG=1 locally to print sanitized diagnostics.');
  }
  process.exit(1);
});
