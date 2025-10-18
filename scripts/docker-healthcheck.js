#!/usr/bin/env node

import process from 'node:process';

const target = process.env.JOBBOT_WEB_HEALTH_URL ?? 'http://127.0.0.1:3000/health';
const rawTimeout = Number.parseInt(process.env.JOBBOT_WEB_HEALTH_TIMEOUT ?? '4000', 10);
const signal =
  Number.isFinite(rawTimeout) && rawTimeout > 0
    ? AbortSignal.timeout(rawTimeout)
    : undefined;

async function checkHealth() {
  const response = await fetch(target, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`unexpected status ${response.status}`);
  }
  const body = await response.json();
  if (!body || body.status !== 'ok') {
    const status = body && typeof body.status === 'string' ? body.status : 'unknown';
    throw new Error(`unexpected body status: ${status}`);
  }
}

checkHealth()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    const message = error && typeof error.message === 'string' ? error.message : String(error);
    console.error('[healthcheck] failed:', message);
    process.exit(1);
  });
