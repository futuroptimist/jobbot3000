import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

const activeServers = [];

const STATUS_LISTENER_PLUGIN_SOURCE = `
  window.jobbotPluginHost.register({
    id: 'status-listener',
    activate({ manifest, on, listPanels, logger, getPanelState, setPanelState }) {
      window.__pluginManifest = manifest;
      window.__pluginPanelIds = listPanels();
      window.__pluginPanelsReady = [];
      on('jobbot:status-panels-ready', detail => {
        window.__pluginPanelsReady = detail.panels.slice();
        logger.info('panels ready', detail.panels);
      });
      on('jobbot:route-changed', detail => {
        window.__pluginLastRoute = detail.route;
      });
      return {
        deactivate() {
          window.__pluginPanelsReady = [];
        },
      };
    },
  });
`;

async function startServer(options = {}) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'test-plugin-token',
    rateLimit: { windowMs: 1000, max: 25 },
    info: { service: 'jobbot-web', version: 'test' },
    ...options,
  });
  activeServers.push(server);
  return server;
}

async function loadScript(dom, url) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  const code = await response.text();
  dom.window.eval(code);
}

async function loadPluginScripts(dom, server) {
  const scripts = Array.from(dom.window.document.querySelectorAll('script[data-plugin-id]'));
  for (const script of scripts) {
    const src = script.getAttribute('src');
    if (!src) continue;
    const url = src.startsWith('http') ? src : `${server.url}${src}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const code = await response.text();
    dom.window.eval(code);
  }
}

function waitForDocumentEvent(target, name, { timeout = 200 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(name, listener);
    };

    const listener = event => {
      cleanup();
      resolve(event.detail);
    };

    target.addEventListener(name, listener, { once: true });
  });
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('web plugin system', () => {
  it('activates configured plugins and exposes the plugin API', async () => {
    const server = await startServer({
      features: {
        plugins: {
          entries: [
            {
              id: 'status-listener',
              name: 'Status Listener',
              source: STATUS_LISTENER_PLUGIN_SOURCE,
              events: ['jobbot:status-panels-ready'],
            },
          ],
        },
      },
    });

    const homepage = await fetch(`${server.url}/`);
    expect(homepage.status).toBe(200);
    const html = await homepage.text();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    if (!dom.window.fetch) {
      dom.window.fetch = (input, init) => fetch(input, init);
    }

    const panelsReadyPromise = new Promise(resolve => {
      dom.window.document.addEventListener(
        'jobbot:status-panels-ready',
        event => resolve(event.detail),
        { once: true },
      );
    });

    await loadScript(dom, `${server.url}/assets/status-hub.js`);
    await loadPluginScripts(dom, server);

    if (typeof dom.window.jobbotPluginHost.whenReady === 'function') {
      await dom.window.jobbotPluginHost.whenReady();
    }

    const readyDetail = await panelsReadyPromise;
    await new Promise(resolve => setTimeout(resolve, 10));

    const pluginScript = dom.window.document.querySelector(
      'script[data-plugin-id="status-listener"]',
    );
    expect(pluginScript).toBeTruthy();
    const integrityAttr = pluginScript?.getAttribute('integrity');
    expect(integrityAttr).toMatch(/^sha256-/);

    const response = await fetch(`${server.url}${pluginScript?.getAttribute('src')}`);
    expect(response.status).toBe(200);
    const code = await response.text();
    const expectedIntegrity = `sha256-${createHash('sha256').update(code).digest('base64')}`;
    expect(integrityAttr).toBe(expectedIntegrity);

    expect(dom.window.__pluginManifest).toMatchObject({
      id: 'status-listener',
      name: 'Status Listener',
      events: ['jobbot:status-panels-ready'],
    });
    expect(Array.isArray(dom.window.__pluginPanelIds)).toBe(true);
    expect(dom.window.__pluginPanelIds.length).toBeGreaterThan(0);
    expect(Array.isArray(dom.window.__pluginPanelsReady)).toBe(true);
    expect(Array.isArray(readyDetail?.panels)).toBe(true);
    expect(readyDetail.panels.length).toBeGreaterThan(0);

    const manifest = dom.window.jobbotPluginHost.getManifest();
    expect(manifest.some(entry => entry.id === 'status-listener')).toBe(true);
  });

  it('requires integrity metadata for remote plugin bundles', async () => {
    const integrity = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const server = await startServer({
      features: {
        plugins: {
          entries: [
            {
              id: 'remote-plugin',
              name: 'Remote Plugin',
              url: 'https://cdn.example.com/jobbot/plugin.js',
              integrity,
            },
          ],
        },
      },
    });

    const homepage = await fetch(`${server.url}/`);
    expect(homepage.status).toBe(200);
    const html = await homepage.text();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    const script = dom.window.document.querySelector('script[data-plugin-id="remote-plugin"]');
    expect(script).toBeTruthy();
    expect(script?.getAttribute('src')).toBe('https://cdn.example.com/jobbot/plugin.js');
    expect(script?.getAttribute('integrity')).toBe(integrity);
    expect(script?.getAttribute('crossorigin')).toBe('anonymous');

    const manifestScript = dom.window.document.getElementById('jobbot-plugin-manifest');
    expect(manifestScript).toBeTruthy();
    const manifest = JSON.parse(manifestScript?.textContent ?? '[]');
    const entry = manifest.find(item => item.id === 'remote-plugin');
    expect(entry).toMatchObject({
      id: 'remote-plugin',
      scriptUrl: 'https://cdn.example.com/jobbot/plugin.js',
      integrity,
    });
  });

  it('drops remote plugin entries that lack integrity metadata', async () => {
    const server = await startServer({
      features: {
        plugins: {
          entries: [
            {
              id: 'remote-no-integrity',
              url: 'https://cdn.example.com/jobbot/without.js',
            },
            {
              id: 'inline-safe',
              source: STATUS_LISTENER_PLUGIN_SOURCE,
            },
          ],
        },
      },
    });

    const homepage = await fetch(`${server.url}/`);
    expect(homepage.status).toBe(200);
    const html = await homepage.text();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    const missingScript = dom.window.document.querySelector(
      'script[data-plugin-id="remote-no-integrity"]',
    );
    expect(missingScript).toBeNull();

    const inlineScript = dom.window.document.querySelector('script[data-plugin-id="inline-safe"]');
    expect(inlineScript).toBeTruthy();
    expect(inlineScript?.getAttribute('integrity')).toMatch(/^sha256-/);

    const manifestScript = dom.window.document.getElementById('jobbot-plugin-manifest');
    expect(manifestScript).toBeTruthy();
    const manifest = JSON.parse(manifestScript?.textContent ?? '[]');
    expect(manifest.some(entry => entry.id === 'remote-no-integrity')).toBe(false);
    expect(manifest.some(entry => entry.id === 'inline-safe')).toBe(true);
  });

  it('replays status panel readiness events to late-loading plugins', async () => {
    const server = await startServer({
      features: {
        plugins: {
          entries: [
            {
              id: 'status-listener',
              name: 'Status Listener',
              source: STATUS_LISTENER_PLUGIN_SOURCE,
              events: ['jobbot:status-panels-ready'],
            },
          ],
        },
      },
    });

    const homepage = await fetch(`${server.url}/`);
    expect(homepage.status).toBe(200);
    const html = await homepage.text();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    if (!dom.window.fetch) {
      dom.window.fetch = (input, init) => fetch(input, init);
    }

    const initialPanelsReady = waitForDocumentEvent(
      dom.window.document,
      'jobbot:status-panels-ready',
    );

    await loadScript(dom, `${server.url}/assets/status-hub.js`);

    const initialDetail = await initialPanelsReady;
    expect(Array.isArray(initialDetail?.panels)).toBe(true);
    expect(initialDetail.panels.length).toBeGreaterThan(0);

    const replayPromise = waitForDocumentEvent(
      dom.window.document,
      'jobbot:status-panels-ready',
      { timeout: 200 },
    );

    await loadPluginScripts(dom, server);

    if (typeof dom.window.jobbotPluginHost.whenReady === 'function') {
      await dom.window.jobbotPluginHost.whenReady();
    }

    const replayDetail = await replayPromise;
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(Array.isArray(replayDetail?.panels)).toBe(true);
    expect(replayDetail.panels.length).toBeGreaterThan(0);
    expect(replayDetail.panels).toEqual(initialDetail.panels);
    expect(dom.window.__pluginPanelsReady).toEqual(replayDetail.panels);
  });
});
