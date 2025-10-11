import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

let activeServers = [];

async function startServer(options) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'test-csrf-token',
    rateLimit: { windowMs: 1000, max: 50 },
    ...options,
  });
  activeServers.push(server);
  return server;
}

async function fetchStatusHtml(server) {
  const response = await fetch(`${server.url}/`);
  expect(response.status).toBe(200);
  return response.text();
}

async function loadStatusHubScript(server, dom) {
  const asset = await fetch(`${server.url}/assets/status-hub.js`);
  expect(asset.status).toBe(200);
  const code = await asset.text();
  dom.window.eval(code);
}

async function renderStatusDom(server, options = {}) {
  const { autoBoot = true, ...jsdomOptions } = options;
  const html = await fetchStatusHtml(server);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: `${server.url}/`,
    ...jsdomOptions,
  });
  if (!dom.window.fetch) {
    dom.window.fetch = (input, init) => fetch(input, init);
  }

  const boot = async () => {
    if (dom.__jobbotBooted) return;
    await loadStatusHubScript(server, dom);
    dom.__jobbotBooted = true;
  };

  if (autoBoot) {
    await boot();
  }

  return { dom, html, boot };
}

function waitForDomEvent(dom, name, timeout = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out`)), timeout);
    dom.window.document.addEventListener(
      name,
      event => {
        clearTimeout(timer);
        resolve(event);
      },
      { once: true },
    );
  });
}

function buildCommandHeaders(server, overrides = {}) {
  const headerName = server?.csrfHeaderName ?? 'x-jobbot-csrf';
  const token = server?.csrfToken ?? 'test-csrf-token';
  return {
    'content-type': 'application/json',
    [headerName]: token,
    ...overrides,
  };
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('web server health endpoint', () => {
  it('reports ok status with metadata when all checks pass', async () => {
    const server = await startServer({
      info: { service: 'jobbot-web', version: '0.1.0-test' },
      healthChecks: [
        {
          name: 'cli',
          async run() {
            return { details: { command: 'jobbot --help' } };
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'ok',
      service: 'jobbot-web',
      version: '0.1.0-test',
    });
    expect(typeof payload.uptime).toBe('number');
    expect(payload.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date');
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]).toMatchObject({
      name: 'cli',
      status: 'ok',
      details: { command: 'jobbot --help' },
    });
    expect(typeof payload.checks[0].duration_ms).toBe('number');
  });

  it('bubbles check failures and returns a 503 status', async () => {
    const server = await startServer({
      healthChecks: [
        {
          name: 'resume-pipeline',
          async run() {
            throw new Error('resume pipeline unavailable');
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.status).toBe('error');
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]).toMatchObject({
      name: 'resume-pipeline',
      status: 'error',
      error: 'resume pipeline unavailable',
    });
  });

  it('surface warn statuses without failing the overall health', async () => {
    const server = await startServer({
      healthChecks: [
        {
          name: 'queue-depth',
          async run() {
            return { status: 'warn', details: { depth: 42 } };
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('warn');
    expect(payload.checks[0]).toMatchObject({
      name: 'queue-depth',
      status: 'warn',
      details: { depth: 42 },
    });
  });

  it('rejects invalid health check definitions', async () => {
    const { startWebServer } = await import('../src/web/server.js');
    expect(() => startWebServer({ healthChecks: [{ name: 'bad-check' }] })).toThrow(
      /health check/,
    );
  });
});

describe('web server status page', () => {
  it('exposes a theme toggle that persists the preferred mode', async () => {
    const server = await startServer();

    const html = await fetchStatusHtml(server);
    expect(html).toContain('data-theme-toggle');

    const asset = await fetch(`${server.url}/assets/status-hub.js`);
    expect(asset.status).toBe(200);
    const code = await asset.text();
    expect(code).toMatch(/jobbot:web:theme/);
    expect(code).toMatch(/prefers-color-scheme/);
  });

  it('links to the web operations playbook for on-call guidance', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html);
    const operationsLink = dom.window.document.querySelector(
      'nav[aria-label="Documentation links"] a[href$="docs/web-operational-playbook.md"]',
    );

    expect(operationsLink?.textContent).toMatch(/Operations playbook/i);
  });

  it('serves the status hub script via an external asset endpoint', async () => {
    const server = await startServer();

    const homepage = await fetch(`${server.url}/`);
    expect(homepage.status).toBe(200);
    const html = await homepage.text();
    const dom = new JSDOM(html);
    const scriptEl = dom.window.document.querySelector('script[src="/assets/status-hub.js"]');

    expect(scriptEl).not.toBeNull();
    expect(scriptEl?.getAttribute('defer')).not.toBeNull();

    const asset = await fetch(`${server.url}/assets/status-hub.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(asset.headers.get('cache-control')).toBe('no-store');
    const code = await asset.text();
    expect(code.trim().startsWith('(() => {')).toBe(true);
    expect(code).toContain('jobbot:status-panels-ready');
    expect(code.trim().endsWith('})();')).toBe(true);
  });

  it('supports hash-based navigation between status sections', async () => {
    const server = await startServer();

    const { dom, boot } = await renderStatusDom(server, { autoBoot: false });

    const routerReady = waitForDomEvent(dom, 'jobbot:router-ready');
    await boot();
    await routerReady;

    const { document } = dom.window;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    const overview = document.querySelector('[data-route="overview"]');
    const commands = document.querySelector('[data-route="commands"]');
    const overviewLink = document.querySelector('[data-route-link="overview"]');
    const commandsLink = document.querySelector('[data-route-link="commands"]');

    expect(overview).not.toBeNull();
    expect(commands).not.toBeNull();
    expect(overview?.hasAttribute('hidden')).toBe(false);
    expect(commands?.hasAttribute('hidden')).toBe(true);
    expect(overviewLink?.getAttribute('aria-current')).toBe('page');
    expect(commandsLink?.hasAttribute('aria-current')).toBe(false);

    dom.window.location.hash = '#commands';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    expect(commands?.hasAttribute('hidden')).toBe(false);
    expect(overview?.hasAttribute('hidden')).toBe(true);
    expect(commandsLink?.getAttribute('aria-current')).toBe('page');
    expect(overviewLink?.hasAttribute('aria-current')).toBe(false);
  });

  it('exposes status panels with loading and error states', async () => {
    const server = await startServer();

    const { dom, boot } = await renderStatusDom(server, { autoBoot: false });

    const panelsReady = waitForDomEvent(dom, 'jobbot:status-panels-ready');
    await boot();
    await panelsReady;

    const { document } = dom.window;
    const api = dom.window.JobbotStatusHub;

    expect(typeof api).toBe('object');
    expect(typeof api?.setPanelState).toBe('function');
    expect(typeof api?.getPanelState).toBe('function');

    const commandsPanel = document.querySelector('[data-status-panel="commands"]');
    expect(commandsPanel).not.toBeNull();
    expect(commandsPanel?.getAttribute('data-state')).toBe('ready');

    const readySlot = commandsPanel?.querySelector('[data-state-slot="ready"]');
    const loadingSlot = commandsPanel?.querySelector('[data-state-slot="loading"]');
    const errorSlot = commandsPanel?.querySelector('[data-state-slot="error"]');

    expect(readySlot?.hasAttribute('hidden')).toBe(false);
    expect(loadingSlot?.hasAttribute('hidden')).toBe(true);
    expect(errorSlot?.hasAttribute('hidden')).toBe(true);

    expect(api?.getPanelState('commands')).toBe('ready');

    expect(api?.setPanelState('commands', 'loading')).toBe(true);
    expect(commandsPanel?.getAttribute('data-state')).toBe('loading');
    expect(loadingSlot?.hasAttribute('hidden')).toBe(false);
    expect(readySlot?.hasAttribute('hidden')).toBe(true);

    expect(api?.setPanelState('commands', 'error', { message: 'Failed to load' })).toBe(true);
    expect(commandsPanel?.getAttribute('data-state')).toBe('error');
    expect(errorSlot?.hasAttribute('hidden')).toBe(false);
    const errorMessage = errorSlot?.querySelector('[data-error-message]');
    expect(errorMessage?.textContent).toContain('Failed to load');

    expect(api?.setPanelState('commands', 'unknown')).toBe(true);
    expect(commandsPanel?.getAttribute('data-state')).toBe('ready');
    expect(readySlot?.hasAttribute('hidden')).toBe(false);

    expect(api?.setPanelState('missing', 'loading')).toBe(false);
  });

  it('renders the applications view with shortlist filters and pagination markup', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('data-route="applications"');
    expect(html).toContain('data-shortlist-filters');
    expect(html).toContain('data-shortlist-table');
    expect(html).toContain('data-shortlist-pagination');
  });

  it('loads shortlist entries and paginates the applications view with filters', async () => {
    const jobs = [
      {
        id: 'job-1',
        metadata: {
          location: 'Remote',
          level: 'Senior',
          compensation: '$185k',
          synced_at: '2025-03-06T08:00:00.000Z',
        },
        tags: ['remote', 'dream'],
        discard_count: 0,
      },
      {
        id: 'job-2',
        metadata: {
          location: 'Remote',
          level: 'Senior',
          compensation: '$185k',
          synced_at: '2025-03-04T09:00:00.000Z',
        },
        tags: ['remote'],
        discard_count: 1,
        last_discard: {
          reason: 'Paused hiring',
          discarded_at: '2025-03-02T10:00:00.000Z',
          tags: ['paused'],
        },
      },
    ];

    const commandAdapter = {
      'shortlist-list': vi.fn(async payload => {
        const offset = Number(payload.offset ?? 0);
        const limit = Number(payload.limit ?? 20);
        const slice = jobs.slice(offset, offset + limit);
        return {
          command: 'shortlist-list',
          format: 'json',
          stdout: '',
          stderr: '',
          data: {
            total: jobs.length,
            offset,
            limit,
            filters: { ...payload },
            items: slice,
            hasMore: offset + limit < jobs.length,
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter['shortlist-list'];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) => waitForDomEvent(dom, name, timeout);

    vi.spyOn(dom.window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const readyPromise = waitForEvent('jobbot:applications-ready');
    await boot();
    const readyEvent = await readyPromise;
    expect(readyEvent.detail).toMatchObject({ available: true });

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(1);

    const document = dom.window.document;
    const tableBody = document.querySelector('[data-shortlist-body]');
    expect(tableBody?.children.length).toBe(2);
    expect(tableBody?.children[0].querySelector('td')?.textContent).toBe('job-1');

    const locationInput = document.querySelector('[data-shortlist-filter="location"]');
    const tagsInput = document.querySelector('[data-shortlist-filter="tags"]');
    const limitInput = document.querySelector('[data-shortlist-filter="limit"]');
    if (locationInput) locationInput.value = 'Remote';
    if (tagsInput) tagsInput.value = 'remote';
    if (limitInput) limitInput.value = '1';

    const form = document.querySelector('[data-shortlist-filters]');
    form?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(2);
    const latestCall = commandAdapter['shortlist-list'].mock.calls.at(-1)?.[0] ?? {};
    expect(latestCall).toMatchObject({ location: 'Remote', tags: ['remote'], limit: 1, offset: 0 });

    expect(tableBody?.children.length).toBe(1);
    expect(tableBody?.children[0].querySelector('td')?.textContent).toBe('job-1');
    const range = document.querySelector('[data-shortlist-range]');
    expect(range?.textContent).toContain('Showing 1-1 of 2');

    const nextButton = document.querySelector('[data-shortlist-next]');
    nextButton?.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(3);
    const nextCall = commandAdapter['shortlist-list'].mock.calls.at(-1)?.[0] ?? {};
    expect(nextCall).toMatchObject({ offset: 1, limit: 1 });
    expect(tableBody?.children.length).toBe(1);
    expect(tableBody?.children[0].querySelector('td')?.textContent).toBe('job-2');
    expect(range?.textContent).toContain('Showing 2-2 of 2');
  });

  it('shows application detail drawer with timeline and attachments', async () => {
    const shortlistEntry = {
      id: 'job-42',
      metadata: {
        location: 'Remote',
        level: 'Staff',
        compensation: '$200k',
        synced_at: '2025-03-05T12:00:00.000Z',
      },
      tags: ['remote', 'priority'],
      discard_count: 1,
      last_discard: {
        reason: 'Paused hiring',
        discarded_at: '2025-03-04T18:00:00.000Z',
      },
    };

    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: [shortlistEntry],
        },
      })),
      'shortlist-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-42' });
        return {
          command: 'shortlist-show',
          format: 'json',
          stdout: '',
          stderr: '',
          returnValue: 0,
          data: {
            job_id: 'job-42',
            metadata: {
              location: 'Remote',
              level: 'Staff',
              compensation: '$200k',
              synced_at: '2025-03-05T12:00:00.000Z',
            },
            tags: ['remote', 'priority'],
            discard_count: 1,
            last_discard: {
              reason: 'Paused hiring',
              discarded_at: '2025-03-04T18:00:00.000Z',
            },
            events: [
              {
                channel: 'email',
                contact: 'Recruiter',
                note: 'Sent resume',
                documents: ['resume.pdf', 'cover-letter.pdf'],
                remind_at: '2025-03-06T15:00:00.000Z',
              },
              {
                channel: 'call',
                note: 'Follow-up scheduled',
                date: '2025-03-07T09:00:00.000Z',
              },
            ],
          },
        };
      }),
      'track-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-42' });
        return {
          command: 'track-show',
          format: 'json',
          stdout: '',
          stderr: '',
          returnValue: 0,
          data: {
            job_id: 'job-42',
            status: {
              status: 'screening',
              note: 'Waiting for feedback',
              updated_at: '2025-03-05T16:00:00.000Z',
            },
            events: [
              {
                channel: 'interview',
                note: 'Scheduled technical interview',
                date: '2025-03-06T18:00:00.000Z',
              },
            ],
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.shortlistShow = commandAdapter['shortlist-show'];
    commandAdapter.trackShow = commandAdapter['track-show'];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) => waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent('jobbot:applications-ready');
    await boot();
    await readyPromise;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector('[data-shortlist-view]');
    expect(detailToggle?.getAttribute('data-shortlist-view')).toBe('job-42');

    const detailLoaded = waitForEvent('jobbot:application-detail-loaded');
    detailToggle?.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await detailLoaded;

    expect(commandAdapter['shortlist-show']).toHaveBeenCalledTimes(1);
    expect(commandAdapter['track-show']).toHaveBeenCalledTimes(1);

    const detailPanel = dom.window.document.querySelector('[data-application-detail]');
    expect(detailPanel?.hasAttribute('hidden')).toBe(false);
    expect(detailPanel?.textContent).toContain('job-42');
    expect(detailPanel?.textContent).toContain('Remote');
    expect(detailPanel?.textContent).toContain('Sent resume');
    expect(detailPanel?.textContent).toContain('resume.pdf');
    expect(detailPanel?.textContent).toContain('Follow-up scheduled');
  });

  it('merges attachments from shortlist events when track detail omits them', async () => {
    const shortlistEntry = {
      id: 'job-77',
      metadata: {
        location: 'Remote',
        level: 'Senior',
        compensation: '$180k',
        synced_at: '2025-03-02T15:00:00.000Z',
      },
      tags: ['priority'],
      discard_count: 0,
    };

    const shortlistEvents = [
      {
        channel: 'email',
        date: '2025-03-03T09:00:00.000Z',
        documents: [' portfolio.pdf ', 'resume.pdf'],
      },
      {
        channel: 'call',
        date: '2025-03-04T11:30:00.000Z',
        documents: ['resume.pdf', 'notes.txt'],
      },
    ];

    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: [shortlistEntry],
        },
      })),
      'shortlist-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-77' });
        return {
          command: 'shortlist-show',
          format: 'json',
          stdout: '',
          stderr: '',
          returnValue: 0,
          data: {
            job_id: 'job-77',
            metadata: shortlistEntry.metadata,
            tags: shortlistEntry.tags,
            discard_count: shortlistEntry.discard_count,
            events: shortlistEvents,
          },
        };
      }),
      'track-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-77' });
        return {
          command: 'track-show',
          format: 'json',
          stdout: '',
          stderr: '',
          returnValue: 0,
          data: {
            job_id: 'job-77',
            status: {
              status: 'screening',
              note: 'Waiting for feedback',
              updated_at: '2025-03-04T12:00:00.000Z',
            },
            events: [],
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.shortlistShow = commandAdapter['shortlist-show'];
    commandAdapter.trackShow = commandAdapter['track-show'];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) => waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent('jobbot:applications-ready');
    await boot();
    await readyPromise;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector('[data-shortlist-view]');
    expect(detailToggle?.getAttribute('data-shortlist-view')).toBe('job-77');

    const detailLoaded = waitForEvent('jobbot:application-detail-loaded');
    detailToggle?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await detailLoaded;

    expect(commandAdapter['shortlist-show']).toHaveBeenCalledTimes(1);
    expect(commandAdapter['track-show']).toHaveBeenCalledTimes(1);

    const detailPanel = dom.window.document.querySelector('[data-application-detail]');
    expect(detailPanel?.hasAttribute('hidden')).toBe(false);
    expect(detailPanel?.textContent).toContain('Attachments: portfolio.pdf, resume.pdf, notes.txt');
  });

  it('renders analytics funnel dashboard from CLI data', async () => {
    const commandAdapter = {
      'analytics-funnel': vi.fn(async () => ({
        command: 'analytics-funnel',
        format: 'json',
        stdout: '',
        stderr: '',
        returnValue: 0,
        data: {
          totals: { trackedJobs: 7, withEvents: 5 },
          stages: [
            { key: 'outreach', label: 'Outreach', count: 5, conversionRate: 1 },
            {
              key: 'screening',
              label: 'Screening',
              count: 3,
              conversionRate: 0.6,
              dropOff: 2,
            },
            {
              key: 'onsite',
              label: 'Onsite',
              count: 2,
              conversionRate: 0.6666666667,
              dropOff: 1,
            },
            {
              key: 'offer',
              label: 'Offer',
              count: 1,
              conversionRate: 0.5,
              dropOff: 1,
            },
          ],
          largestDropOff: {
            from: 'screening',
            fromLabel: 'Screening',
            to: 'onsite',
            toLabel: 'Onsite',
            dropOff: 1,
          },
          missing: {
            statuslessJobs: {
              count: 2,
            },
          },
          sankey: {
            nodes: [
              { key: 'outreach', label: 'Outreach' },
              { key: 'screening', label: 'Screening' },
              { key: 'onsite', label: 'Onsite' },
            ],
            links: [
              { source: 'outreach', target: 'screening', value: 3 },
              { source: 'outreach', target: 'outreach_drop', value: 2, drop: true },
              { source: 'screening', target: 'onsite', value: 2 },
            ],
          },
        },
      })),
    };

    commandAdapter.analyticsFunnel = commandAdapter['analytics-funnel'];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) => waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent('jobbot:analytics-ready');
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#analytics';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForEvent('jobbot:analytics-loaded');

    expect(commandAdapter['analytics-funnel']).toHaveBeenCalledTimes(1);

    const navLink = dom.window.document.querySelector('[data-route-link="analytics"]');
    expect(navLink?.textContent).toContain('Analytics');

    const summary = dom.window.document.querySelector('[data-analytics-summary]');
    expect(summary?.textContent).toContain('Tracked jobs: 7');
    expect(summary?.textContent).toContain('Outreach events: 5');
    expect(summary?.textContent).toContain('Largest drop-off: Screening → Onsite (1)');

    const table = dom.window.document.querySelector('[data-analytics-table]');
    expect(table?.textContent).toContain('Outreach');
    expect(table?.textContent).toContain('Screening');
    expect(table?.textContent).toContain('100%');
    expect(table?.textContent).toContain('60%');

    const missing = dom.window.document.querySelector('[data-analytics-missing]');
    expect(missing?.textContent).toContain('2 jobs with outreach but no status recorded');

    const sankey = dom.window.document.querySelector('[data-analytics-sankey]');
    expect(sankey?.textContent).toContain('3 links');
    expect(sankey?.textContent).toContain('drop-off edges: 1');
  });

  it('downloads analytics exports as JSON and CSV', async () => {
    const funnelPayload = {
      totals: { trackedJobs: 4, withEvents: 3 },
      stages: [
        { key: 'outreach', label: 'Outreach', count: 4, conversionRate: 1, dropOff: 0 },
      ],
      largestDropOff: null,
      missing: { statuslessJobs: { count: 0 } },
      sankey: { nodes: [], links: [] },
    };

    const snapshot = {
      generated_at: '2025-03-09T09:30:00.000Z',
      totals: funnelPayload.totals,
      funnel: { stages: funnelPayload.stages },
      statuses: { outreach: 4 },
      channels: { email: 3 },
      activity: { interviewsScheduled: 1 },
      companies: [{ name: 'Acme', status: 'onsite' }],
    };

    const commandAdapter = {
      'analytics-funnel': vi.fn(async () => ({
        command: 'analytics-funnel',
        format: 'json',
        stdout: '',
        stderr: '',
        returnValue: 0,
        data: funnelPayload,
      })),
      'analytics-export': vi.fn(async payload => {
        expect(payload).toEqual({ redact: true });
        return {
          command: 'analytics-export',
          format: 'json',
          stdout: '',
          stderr: '',
          returnValue: 0,
          data: snapshot,
        };
      }),
    };

    commandAdapter.analyticsFunnel = commandAdapter['analytics-funnel'];
    commandAdapter.analyticsExport = commandAdapter['analytics-export'];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) => waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent('jobbot:analytics-ready');
    await boot();
    await readyPromise;

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#analytics';
    dom.window.dispatchEvent(new HashChange('hashchange'));
    await waitForEvent('jobbot:analytics-loaded');

    const { URL } = dom.window;
    URL.createObjectURL = vi.fn(() => 'blob:analytics');
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi
      .spyOn(dom.window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const jsonButton = dom.window.document.querySelector('[data-analytics-export-json]');
    const csvButton = dom.window.document.querySelector('[data-analytics-export-csv]');
    const message = dom.window.document.querySelector('[data-analytics-export-message]');

    const click = () =>
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });

    jsonButton?.dispatchEvent(click());

    await waitForEvent('jobbot:analytics-exported');

    expect(commandAdapter['analytics-export']).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const jsonBlob = URL.createObjectURL.mock.calls[0]?.[0];
    expect(jsonBlob).toBeInstanceOf(dom.window.Blob);
    expect(jsonBlob.type).toBe('application/json');
    expect(jsonBlob.size).toBeGreaterThan(0);
    expect(message?.textContent).toContain('analytics-snapshot.json');

    csvButton?.dispatchEvent(click());

    await waitForEvent('jobbot:analytics-exported');

    expect(commandAdapter['analytics-export']).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(anchorClick).toHaveBeenCalledTimes(2);
    const csvBlob = URL.createObjectURL.mock.calls[1]?.[0];
    expect(csvBlob).toBeInstanceOf(dom.window.Blob);
    expect(csvBlob.type).toBe('text/csv');
    expect(csvBlob.size).toBeGreaterThan(0);
    expect(message?.textContent).toContain('analytics-stages.csv');
  });

  it('records status updates from the applications action panel', async () => {
    const shortlistEntry = {
      id: 'job-42',
      metadata: {
        location: 'Remote',
        level: 'Staff',
        compensation: '$200k',
        synced_at: '2025-03-05T12:00:00.000Z',
      },
      tags: ['remote', 'priority'],
      discard_count: 0,
    };

    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        returnValue: 0,
        data: {
          total: 1,
          offset: 0,
          limit: 20,
          filters: {},
          hasMore: false,
          items: [shortlistEntry],
        },
      })),
      'shortlist-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-42' });
        return {
          command: 'shortlist-show',
          format: 'json',
          stdout: '',
          stderr: '',
          returnValue: 0,
          data: {
            job_id: 'job-42',
            metadata: shortlistEntry.metadata,
            tags: shortlistEntry.tags,
            discard_count: 0,
            events: [],
          },
        };
      }),
      'track-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-42' });
        return {
          command: 'track-show',
          format: 'json',
          stdout: '',
          stderr: '',
          returnValue: 0,
          data: {
            job_id: 'job-42',
            status: {
              status: 'screening',
              note: 'Initial screening',
              updated_at: '2025-03-05T12:30:00.000Z',
            },
            events: [],
          },
        };
      }),
      'track-record': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-42', status: 'offer', note: 'Signed offer' });
        return {
          command: 'track-record',
          format: 'text',
          stdout: 'Recorded job-42 as offer\n',
          stderr: '',
          returnValue: 0,
          data: {
            message: 'Recorded job-42 as offer',
            jobId: 'job-42',
            status: 'offer',
            note: 'Signed offer',
          },
        };
      }),
    };

    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.shortlistShow = commandAdapter['shortlist-show'];
    commandAdapter.trackShow = commandAdapter['track-show'];
    commandAdapter.trackRecord = commandAdapter['track-record'];

    const server = await startServer({ commandAdapter });
    const { dom, boot } = await renderStatusDom(server, {
      pretendToBeVisual: true,
      autoBoot: false,
    });

    const waitForEvent = (name, timeout = 500) => waitForDomEvent(dom, name, timeout);

    const readyPromise = waitForEvent('jobbot:applications-ready');
    await boot();
    await readyPromise;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(1);

    const detailToggle = dom.window.document.querySelector('[data-shortlist-view]');
    expect(detailToggle?.getAttribute('data-shortlist-view')).toBe('job-42');

    const detailLoaded = waitForEvent('jobbot:application-detail-loaded');
    detailToggle?.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await detailLoaded;
    expect(commandAdapter['track-show']).toHaveBeenCalledTimes(1);

    const statusSelect = dom.window.document.querySelector('[data-application-status]');
    expect(statusSelect).not.toBeNull();
    statusSelect.value = 'offer';
    statusSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const noteInput = dom.window.document.querySelector('[data-application-note]');
    expect(noteInput).not.toBeNull();
    noteInput.value = 'Signed offer';
    noteInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const form = dom.window.document.querySelector('[data-application-status-form]');
    expect(form).not.toBeNull();

    const statusRecorded = waitForEvent('jobbot:application-status-recorded');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await statusRecorded;

    expect(commandAdapter['track-record']).toHaveBeenCalledTimes(1);
    const message = dom.window.document.querySelector('[data-action-message]');
    expect(message?.textContent).toContain('Recorded job-42 as offer');
  });
});

describe('web server command endpoint', () => {
  it('executes allow-listed commands with validated payloads', async () => {
    const commandAdapter = {
      summarize: vi.fn(async options => {
        expect(options).toEqual({
          input: 'job.txt',
          format: 'json',
          sentences: 2,
          locale: 'en',
          timeoutMs: 5000,
          maxBytes: 2048,
        });
        return {
          command: 'summarize',
          format: 'json',
          stdout: '{"summary":"ok"}',
          stderr: '',
          data: { summary: 'ok' },
        };
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({
        input: 'job.txt',
        format: 'json',
        sentences: '2',
        locale: 'en',
        timeoutMs: 5000,
        maxBytes: 2048,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      command: 'summarize',
      format: 'json',
      stdout: '{"summary":"ok"}',
      stderr: '',
      data: { summary: 'ok' },
    });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown commands', async () => {
    const server = await startServer({ commandAdapter: {} });
    const response = await fetch(`${server.url}/commands/unknown`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toMatch(/unknown command/i);
  });

  it('rejects payloads with unexpected fields', async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt', unexpected: true }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/unexpected/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it('returns a 502 status when the CLI invocation fails', async () => {
    const error = new Error('summarize command failed: boom');
    error.stdout = 'cli-out';
    error.stderr = 'cli-error';
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: 'summarize command failed: boom',
      stdout: 'cli-out',
      stderr: 'cli-error',
    });
  });

  it('includes trace identifiers in error responses when available', async () => {
    const error = new Error('summarize command failed: sanitized');
    error.stdout = '';
    error.stderr = 'boom';
    error.correlationId = 'trace-42';
    error.traceId = 'trace-42';
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: 'summarize command failed: sanitized',
      correlationId: 'trace-42',
      traceId: 'trace-42',
      stderr: 'boom',
    });
  });

  it('rejects malformed JSON payloads before invoking the CLI', async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: '{',
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/invalid json payload/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it('redacts secret-like tokens from command responses', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({
        command: 'summarize',
        format: 'json',
        stdout: 'API_KEY=abcd1234secret',
        stderr: 'Bearer sk_live_1234567890',
        data: {
          token: 'abcd1234secret',
          nested: { client_secret: 'supersecret' },
        },
      })),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt', format: 'json' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stdout).toBe('API_KEY=***');
    expect(payload.stderr).toBe('Bearer ***');
    expect(payload.data).toEqual({ token: '***', nested: { client_secret: '***' } });
  });

  it('executes shortlist-list commands with sanitized payloads', async () => {
    const commandAdapter = {
      'shortlist-list': vi.fn(async payload => {
        expect(payload).toEqual({
          location: 'Remote',
          level: 'Senior',
          compensation: '$185k',
          tags: ['remote', 'dream'],
          offset: 5,
          limit: 25,
        });
        return {
          command: 'shortlist-list',
          format: 'json',
          stdout: '',
          stderr: '',
          data: {
            total: 1,
            offset: 5,
            limit: 25,
            filters: payload,
            items: [
              {
                id: 'job-remote',
                metadata: { location: 'Remote', level: 'Senior', compensation: '$185k' },
                tags: ['remote', 'dream'],
                discard_count: 0,
              },
            ],
            hasMore: false,
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter['shortlist-list'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/shortlist-list`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({
        location: 'Remote',
        level: 'Senior',
        compensation: '$185k',
        tags: ['remote', 'dream'],
        offset: 5,
        limit: 25,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.command).toBe('shortlist-list');
    expect(payload.data).toMatchObject({
      total: 1,
      offset: 5,
      limit: 25,
      hasMore: false,
    });
    expect(Array.isArray(payload.data.items)).toBe(true);
    expect(payload.data.items[0]).toMatchObject({ id: 'job-remote' });
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(1);
  });

  it('preserves primitive command responses while sanitizing strings', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => 'API_KEY=abcd1234secret\u0007'),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toBe('API_KEY=***');
  });

  it('rejects command requests without a valid CSRF token', async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/csrf/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it('requires a valid authorization token when configured', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auth: { tokens: ['secret-token-123'] },
    });
    const body = JSON.stringify({ input: 'job.txt' });

    const missingAuth = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
      },
      body,
    });
    expect(missingAuth.status).toBe(401);
    expect(await missingAuth.json()).toMatchObject({
      error: expect.stringMatching(/authorization/i),
    });
    expect(commandAdapter.summarize).not.toHaveBeenCalled();

    const invalidAuth = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        authorization: 'Bearer nope',
      },
      body,
    });
    expect(invalidAuth.status).toBe(401);
    expect(await invalidAuth.json()).toMatchObject({
      error: expect.stringMatching(/authorization/i),
    });
    expect(commandAdapter.summarize).not.toHaveBeenCalled();

    const validAuth = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        authorization: 'Bearer secret-token-123',
      },
      body,
    });
    expect(validAuth.status).toBe(200);
    expect(await validAuth.json()).toEqual({ ok: true });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it('supports custom authorization headers without schemes', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auth: { tokens: ['magic-token'], headerName: 'x-api-key', scheme: '' },
    });

    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        'x-api-key': 'magic-token',
      },
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it('logs telemetry when commands succeed', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const commandAdapter = {
      summarize: vi.fn(async options => {
        expect(options).toEqual({ input: 'job.txt' });
        return {
          command: 'summarize',
          stdout: 'ok',
          stderr: '',
          correlationId: 'corr-123',
          traceId: 'corr-123',
        };
      }),
    };

    const server = await startServer({ commandAdapter, logger });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(200);
    await response.json();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    const entry = logger.info.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: 'web.command',
      command: 'summarize',
      status: 'success',
      httpStatus: 200,
      correlationId: 'corr-123',
      traceId: 'corr-123',
      payloadFields: ['input'],
    });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.stdoutLength).toBe(2);
    expect(entry.stderrLength).toBe(0);
  });

  it('logs telemetry when commands fail', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const error = new Error('summarize command failed: boom');
    error.stdout = 'oops';
    error.stderr = 'fail';
    error.correlationId = 'corr-err';
    error.traceId = 'corr-err';
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter, logger });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(502);
    await response.json();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);

    const entry = logger.error.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: 'web.command',
      command: 'summarize',
      status: 'error',
      httpStatus: 502,
      correlationId: 'corr-err',
      traceId: 'corr-err',
      payloadFields: ['input'],
      errorMessage: 'summarize command failed: boom',
    });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.stdoutLength).toBe(4);
    expect(entry.stderrLength).toBe(4);
  });

  it('rate limits repeated command requests per client', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      rateLimit: { windowMs: 5000, max: 2 },
    });

    const headers = buildCommandHeaders(server);
    const body = JSON.stringify({ input: 'job.txt' });

    const first = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers,
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers,
      body,
    });
    expect(second.status).toBe(200);

    const third = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers,
      body,
    });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: expect.stringMatching(/too many/i) });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(2);
  });
});
