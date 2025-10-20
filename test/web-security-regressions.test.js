import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const activeServers = [];

async function startServer(options = {}) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'test-security-token',
    rateLimit: { windowMs: 1000, max: 25 },
    info: { service: 'jobbot-web', version: 'test' },
    ...options,
  });
  activeServers.push(server);
  return server;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('web security regressions', () => {
  it('rejects protocol-relative plugin bundle URLs', async () => {
    const protocolRelativeIntegrity =
      'sha256-3a2Fvf1HnT8G1B6+V8df8jbbg0v1rlQ2d6Fnz3eVnPM=';
    const secureIntegrity = 'sha256-o8jS8jZ0pniS3pS3p9DOMkMt2rt7NmBGG99nmHn7f3g=';
    const server = await startServer({
      features: {
        plugins: {
          entries: [
            {
              id: 'protocol-relative',
              name: 'Protocol Relative Plugin',
              url: '//plugins.example.com/protocol.js',
              integrity: protocolRelativeIntegrity,
            },
            {
              id: 'secure-remote',
              name: 'Secure Remote Plugin',
              url: 'https://plugins.example.com/secure.js',
              integrity: secureIntegrity,
            },
          ],
        },
      },
    });

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    const dom = new JSDOM(html);

    const manifestScript = dom.window.document.getElementById('jobbot-plugin-manifest');
    expect(manifestScript).not.toBeNull();
    const manifest = JSON.parse(manifestScript?.textContent || '[]');

    expect(manifest.some(entry => entry.id === 'secure-remote')).toBe(true);
    expect(manifest.some(entry => entry.id === 'protocol-relative')).toBe(false);

    const protocolScript = dom.window.document.querySelector(
      'script[data-plugin-id="protocol-relative"]',
    );
    expect(protocolScript).toBeNull();

    const secureScript = dom.window.document.querySelector(
      'script[data-plugin-id="secure-remote"]',
    );
    expect(secureScript).not.toBeNull();
    expect(secureScript?.getAttribute('integrity')).toBe(secureIntegrity);
    expect(secureScript?.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('issues HttpOnly session cookies linked to the session header', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);

    const headerSessionId = response.headers.get('x-jobbot-session-id');
    expect(typeof headerSessionId).toBe('string');
    expect(headerSessionId).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

    const cookies = response.headers.getSetCookie?.() ?? [];
    expect(cookies.length).toBeGreaterThan(0);
    const sessionCookie = cookies.find(cookie => cookie.startsWith('jobbot_session_id='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/SameSite=Lax/);
    expect(sessionCookie).toMatch(/Path=\//);

    const cookieValue = sessionCookie?.split(';')[0]?.split('=')[1] ?? '';
    const decodedValue = decodeURIComponent(cookieValue);
    expect(decodedValue).toBe(headerSessionId);
  });
});
