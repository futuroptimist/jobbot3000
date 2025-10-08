import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startWebServer } from '../src/web/server.js';
import { runAccessibilityAudit, runPerformanceAudit } from '../src/web/audits.js';

describe('web interface audits', () => {
  let server;

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
    expect(performanceReport.metrics.transferSize).toBeLessThan(120_000);
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
