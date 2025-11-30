import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import http from 'node:http';

import { startWebServer } from '../src/web/server.js';
import { runAccessibilityAudit, runPerformanceAudit } from '../src/web/audits.js';

describe('web interface audits', () => {
  let server;

  async function fetchRawAsset(pathname) {
    const url = new URL(server.url);
    const options = {
      host: url.hostname,
      port: url.port,
      path: pathname,
      method: 'GET',
      headers: { 'accept-encoding': 'gzip' },
    };

    return new Promise((resolve, reject) => {
      const request = http.request(options, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          resolve({ headers: response.headers, body: Buffer.concat(chunks) });
        });
      });
      request.on('error', reject);
      request.end();
    });
  }

  beforeAll(async () => {
    server = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      commandAdapter: {},
      csrfToken: 'test-token',
      csrfHeaderName: 'x-test-csrf',
      rateLimit: { windowMs: 1000, max: 5 },
      info: { service: 'jobbot-web', version: 'test' },
    });
  });

  afterAll(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it('meets the documented accessibility and performance baselines', async () => {
    const homepageUrl = `${server.url}/`;
    const response = await fetch(homepageUrl);
    expect(response.ok).toBe(true);
    const html = await response.text();

    const accessibilityReport = await runAccessibilityAudit(html);
    expect(accessibilityReport.violations).toEqual([]);

    const performanceReport = await runPerformanceAudit(homepageUrl);
    expect(performanceReport.score).toBeGreaterThanOrEqual(0.9);

    // Budget accounts for the record status panel while keeping HTML lean.
    const MAX_TRANSFER_SIZE = 80_000;
    expect(performanceReport.metrics.transferSize).toBeLessThan(MAX_TRANSFER_SIZE);
  });

  it('sends a hardened CSP without allowing blob script sources', async () => {
    const homepageUrl = `${server.url}/`;
    const response = await fetch(homepageUrl);
    expect(response.ok).toBe(true);

    const csp = response.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*blob:/);

    const assetResponse = await fetch(`${server.url}/assets/status-hub.js`);
    expect(assetResponse.ok).toBe(true);
    expect(assetResponse.headers.get('content-security-policy')).toBe(csp);
  });

  it('serves HTML under the transfer budget', async () => {
    const homepageUrl = `${server.url}/`;
    const response = await fetch(homepageUrl);
    expect(response.ok).toBe(true);
    const html = await response.text();

    // Regression guard: keep the status hub HTML lean now that scripts and
    // styles ship as external assets, staying well under the 74 KB budget.
    const MAX_HTML_BYTES = 56_000;
    const byteLength = Buffer.byteLength(html, 'utf8');
    expect(byteLength).toBeLessThan(MAX_HTML_BYTES);
  });

  it('compresses status hub assets under transfer budgets', async () => {
    const scriptAsset = await fetchRawAsset('/assets/status-hub.js');
    expect(scriptAsset.headers['content-encoding']).toBe('gzip');
    const MAX_SCRIPT_BYTES = 80_000;
    expect(scriptAsset.body.byteLength).toBeLessThan(MAX_SCRIPT_BYTES);

    const styleAsset = await fetchRawAsset('/assets/status-hub.css');
    expect(styleAsset.headers['content-encoding']).toBe('gzip');
    const MAX_STYLE_BYTES = 12_000;
    expect(styleAsset.body.byteLength).toBeLessThan(MAX_STYLE_BYTES);
  });

  it('does not execute page scripts during the accessibility audit', async () => {
    const maliciousHtml = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>axe script isolation test</title>
          <script>
            window.__scriptExecuted = true;
            throw new Error('embedded scripts must not run during audits');
          </script>
        </head>
        <body>
          <main id="main-content">
            <h1>Audit target</h1>
            <p>Accessibility checks should only read the DOM tree.</p>
          </main>
        </body>
      </html>
    `;

    const report = await runAccessibilityAudit(maliciousHtml);
    expect(Array.isArray(report.violations)).toBe(true);
    expect(Array.isArray(report.passes)).toBe(true);
  });
});
