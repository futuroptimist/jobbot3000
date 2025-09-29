#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';
import { startWebServer } from '../src/web/server.js';

function getFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printUsage() {
  console.error('Usage: node scripts/web-server.js [--port <number>] [--host <value>]');
}

async function main() {
  const args = process.argv.slice(2);
  const host = getFlag(args, '--host') ?? '127.0.0.1';
  const portArg = getFlag(args, '--port');
  const port = portArg === undefined ? 3000 : Number(portArg);

  if (Number.isNaN(port) || port < 0 || port > 65535) {
    printUsage();
    throw new Error('--port must be a number between 0 and 65535');
  }

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

  const server = await startWebServer({
    host,
    port,
    info: { service: 'jobbot-web', version },
    healthChecks: [],
  });

  console.log(`jobbot web server listening on ${server.url}`);
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
