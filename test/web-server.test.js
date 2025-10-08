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

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('data-theme-toggle');
    expect(html).toMatch(/jobbot:web:theme/);
    expect(html).toMatch(/prefers-color-scheme/);
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

  it('supports hash-based navigation between status sections', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('router never became ready')), 200);
      dom.window.document.addEventListener('jobbot:router-ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

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

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('status panels never became ready')), 200);
      dom.window.document.addEventListener('jobbot:status-panels-ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

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
    expect(html).toContain('data-status-panel="track-action"');
    expect(html).toContain('data-status-panel="track-detail"');
    expect(html).toContain('data-status-panel="track-reminders"');

    const dom = new JSDOM(html);
    const actionPanel = dom.window.document.querySelector('[data-status-panel="track-action"]');
    expect(actionPanel).not.toBeNull();
    const statusSelect = actionPanel?.querySelector('[data-track-field="status"]');
    expect(statusSelect).not.toBeNull();
    const options = Array.from(statusSelect?.querySelectorAll('option') ?? []).map(option =>
      option.getAttribute('value'),
    );
    expect(options).toEqual(
      expect.arrayContaining([
        'no_response',
        'screening',
        'onsite',
        'offer',
        'rejected',
        'withdrawn',
        'next_round',
        'accepted',
        'acceptance',
        'hired',
      ]),
    );

    const detailPanel = dom.window.document.querySelector('[data-status-panel="track-detail"]');
    expect(detailPanel).not.toBeNull();
    const detailForm = detailPanel?.querySelector('[data-track-detail-form]');
    expect(detailForm).not.toBeNull();
    expect(detailPanel?.querySelector('[data-track-detail-field="jobId"]')).not.toBeNull();
    expect(detailPanel?.querySelector('[data-track-detail-result]')).not.toBeNull();
    expect(detailPanel?.querySelector('[data-track-detail-empty]')).not.toBeNull();

    const remindersPanel = dom.window.document.querySelector(
      '[data-status-panel="track-reminders"]',
    );
    expect(remindersPanel).not.toBeNull();
    expect(remindersPanel?.querySelector('[data-track-reminders-download]')).not.toBeNull();
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
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: `${server.url}/`,
      pretendToBeVisual: true,
    });
    dom.window.fetch = (input, init) => fetch(input, init);

    const waitForEvent = (name, timeout = 500) =>
      new Promise((resolve, reject) => {
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

    const readyEvent = await waitForEvent('jobbot:applications-ready');
    expect(readyEvent.detail).toMatchObject({ available: true });

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(1);

    const document = dom.window.document;
    const tableBody = document.querySelector('[data-shortlist-body]');
    expect(tableBody?.children.length).toBe(2);
    expect(
      tableBody?.children[0]
        .querySelector('[data-shortlist-job-id]')
        ?.textContent?.trim(),
    ).toBe('job-1');

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
    expect(
      tableBody?.children[0]
        .querySelector('[data-shortlist-job-id]')
        ?.textContent?.trim(),
    ).toBe('job-1');
    const range = document.querySelector('[data-shortlist-range]');
    expect(range?.textContent).toContain('Showing 1-1 of 2');

    const nextButton = document.querySelector('[data-shortlist-next]');
    nextButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(3);
    const nextCall = commandAdapter['shortlist-list'].mock.calls.at(-1)?.[0] ?? {};
    expect(nextCall).toMatchObject({ offset: 1, limit: 1 });
    expect(tableBody?.children.length).toBe(1);
    expect(
      tableBody?.children[0]
        .querySelector('[data-shortlist-job-id]')
        ?.textContent?.trim(),
    ).toBe('job-2');
    expect(range?.textContent).toContain('Showing 2-2 of 2');
  });

  it('loads track show details into the application detail panel', async () => {
    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        data: { total: 0, offset: 0, limit: 10, items: [] },
      })),
      'track-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-42' });
        return {
          command: 'track-show',
          format: 'json',
          stdout: JSON.stringify({ job_id: 'job-42' }),
          stderr: '',
          correlationId: 'corr-123',
          data: {
            job_id: 'job-42',
            status: {
              value: 'screening',
              updated_at: '2025-03-05T12:30:00.000Z',
              note: 'Awaiting hiring manager feedback',
            },
            timeline: [
              {
                channel: 'applied',
                date: '2025-03-01T08:00:00.000Z',
                note: 'Submitted via referral portal',
                documents: ['resume.pdf', 'portfolio.pdf'],
              },
              {
                channel: 'interview',
                date: '2025-03-08T15:45:00.000Z',
                contact: 'Jordan Interviewer',
                documents: ['portfolio.pdf', 'feedback.docx'],
                note: 'Panel interview completed',
              },
            ],
            attachments: {
              documents: ['resume.pdf', 'portfolio.pdf', 'feedback.docx'],
            },
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.trackShow = commandAdapter['track-show'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: `${server.url}/`,
      pretendToBeVisual: true,
    });
    dom.window.fetch = (input, init) => fetch(input, init);

    const waitForEvent = (name, timeout = 500) =>
      new Promise((resolve, reject) => {
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

    const waitForCondition = async (predicate, timeout = 500) => {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          if (predicate()) {
            resolve();
            return;
          }
          if (Date.now() - start > timeout) {
            reject(new Error('Condition timed out'));
            return;
          }
          setTimeout(check, 10);
        };
        check();
      });
    };

    await waitForEvent('jobbot:status-panels-ready');

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForCondition(
      () => dom.window.JobbotStatusHub?.getPanelState('applications') === 'ready',
    );

    const form = dom.window.document.querySelector('[data-track-detail-form]');
    const jobInput = dom.window.document.querySelector('[data-track-detail-field="jobId"]');
    expect(form).not.toBeNull();
    expect(jobInput).not.toBeNull();
    if (jobInput) {
      jobInput.value = 'job-42';
    }
    form?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

    await waitForCondition(() => commandAdapter['track-show'].mock.calls.length > 0);
    await waitForCondition(() => {
      const panel = dom.window.document.querySelector('[data-status-panel="track-detail"]');
      const result = panel?.querySelector('[data-track-detail-result]');
      return (
        panel?.getAttribute('data-state') === 'ready' &&
        result?.hasAttribute('hidden') === false
      );
    });

    const panel = dom.window.document.querySelector('[data-status-panel="track-detail"]');
    expect(panel?.getAttribute('data-state')).toBe('ready');
    const result = panel?.querySelector('[data-track-detail-result]');
    expect(result?.hasAttribute('hidden')).toBe(false);
    const heading = panel?.querySelector('[data-track-detail-heading]');
    expect(heading?.textContent).toContain('job-42');
    const statusValues = Array.from(
      panel?.querySelectorAll('[data-track-detail-status] dd') ?? [],
    ).map(node => node.textContent?.trim());
    expect(statusValues).toEqual(
      expect.arrayContaining([
        'screening',
        '2025-03-05T12:30:00.000Z',
        'Awaiting hiring manager feedback',
      ]),
    );
    const attachments = panel?.querySelector('[data-track-detail-attachments-list]');
    expect(attachments?.textContent).toContain('resume.pdf');
    expect(attachments?.textContent).toContain('feedback.docx');
    const timelineList = panel?.querySelector('[data-track-detail-timeline-list]');
    expect(timelineList?.children.length).toBe(2);
    expect(timelineList?.textContent).toContain('applied');
    expect(timelineList?.textContent).toContain('interview');
    const correlation = panel?.querySelector('[data-track-detail-correlation-value]');
    expect(correlation?.textContent).toBe('corr-123');
  });

  it('opens the job detail drawer from shortlist rows and supports sharing', async () => {
    const jobs = [
      {
        id: 'job-drawer',
        metadata: {
          location: 'Remote',
          level: 'Staff',
          compensation: '$210k',
          synced_at: '2025-03-07T18:30:00.000Z',
        },
        tags: ['remote', 'priority'],
        discard_count: 0,
      },
    ];

    const commandAdapter = {
      'shortlist-list': vi.fn(async payload => {
        expect(payload).toMatchObject({ offset: 0 });
        return {
          command: 'shortlist-list',
          format: 'json',
          stdout: '',
          stderr: '',
          data: {
            total: jobs.length,
            offset: 0,
            limit: Number(payload.limit ?? 10),
            items: jobs,
          },
        };
      }),
      'track-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-drawer' });
        return {
          command: 'track-show',
          format: 'json',
          stdout: JSON.stringify({ job_id: 'job-drawer' }),
          stderr: '',
          correlationId: 'corr-drawer-1',
          data: {
            job_id: 'job-drawer',
            status: {
              value: 'onsite',
              updated_at: '2025-03-08T15:00:00.000Z',
              note: 'Scheduled recruiter call',
            },
            timeline: [
              {
                type: 'note',
                note: 'Sent follow-up email to recruiter',
                recorded_at: '2025-03-06T11:00:00.000Z',
                author: 'Jordan Recruiter',
              },
              {
                type: 'status',
                status: 'onsite',
                recorded_at: '2025-03-08T15:00:00.000Z',
                note: 'Scheduled recruiter call',
              },
            ],
            attachments: {
              documents: ['portfolio.pdf'],
            },
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.trackShow = commandAdapter['track-show'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: `${server.url}/`,
      pretendToBeVisual: true,
    });
    dom.window.fetch = (input, init) => fetch(input, init);

    const waitForEvent = (name, timeout = 500) =>
      new Promise((resolve, reject) => {
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

    const waitForCondition = async (predicate, timeout = 500) => {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          if (predicate()) {
            resolve();
            return;
          }
          if (Date.now() - start > timeout) {
            reject(new Error('Condition timed out'));
            return;
          }
          setTimeout(check, 10);
        };
        check();
      });
    };

    await waitForEvent('jobbot:status-panels-ready');
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForEvent('jobbot:applications-loaded');
    expect(commandAdapter['shortlist-list']).toHaveBeenCalledTimes(1);

    const document = dom.window.document;
    const detailButton = document.querySelector('[data-shortlist-detail-trigger]');
    expect(detailButton).not.toBeNull();

    dom.window.navigator.clipboard = {
      writeText: vi.fn(() => Promise.resolve()),
    };

    detailButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    await waitForCondition(() => commandAdapter['track-show'].mock.calls.length > 0);
    await waitForCondition(() => {
      const drawer = document.querySelector('[data-job-detail-drawer]');
      return drawer?.getAttribute('data-open') === 'true';
    });

    const drawer = document.querySelector('[data-job-detail-drawer]');
    expect(drawer).not.toBeNull();
    const heading = drawer?.querySelector('[data-job-detail-drawer-heading]');
    expect(heading?.textContent).toContain('job-drawer');
    const timelineList = drawer?.querySelector('[data-job-detail-drawer-timeline-list]');
    await waitForCondition(() => (timelineList?.children.length ?? 0) > 0);
    expect(timelineList?.textContent).toContain('Sent follow-up email to recruiter');

    const updateButton = drawer?.querySelector('[data-job-detail-drawer-update]');
    updateButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const trackActionJobId = document.querySelector('[data-track-field="jobId"]');
    expect(trackActionJobId?.value).toBe('job-drawer');

    const shareButton = drawer?.querySelector('[data-job-detail-drawer-share]');
    shareButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await waitForCondition(
      () =>
        Boolean(dom.window.navigator.clipboard?.writeText) &&
        dom.window.navigator.clipboard.writeText.mock.calls.length > 0,
    );
    const sharedText = dom.window.navigator.clipboard.writeText.mock.calls.at(-1)?.[0];
    expect(sharedText).toContain('job-drawer');
    expect(sharedText).toContain('\nStatus: onsite');
    expect(sharedText).toContain('Scheduled recruiter call');

    const closeButton = drawer?.querySelector('[data-job-detail-drawer-close]');
    closeButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await waitForCondition(() => drawer?.getAttribute('data-open') !== 'true');
  });

  it('escapes newline sequences in the job detail share helper script', async () => {
    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        data: { total: 0, offset: 0, limit: 10, items: [] },
      })),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html);
    const scripts = Array.from(dom.window.document.querySelectorAll('script'));
    const shareScript = scripts.find(script =>
      script?.textContent?.includes('function buildShareSummary'),
    );

    expect(shareScript).toBeDefined();
    expect(shareScript?.textContent).toContain("return lines.join('\\n');");
  });

  it('shows an empty state when track show returns no lifecycle data', async () => {
    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        data: { total: 0, offset: 0, limit: 10, items: [] },
      })),
      'track-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-empty' });
        return {
          command: 'track-show',
          format: 'json',
          stdout: JSON.stringify({ job_id: 'job-empty' }),
          stderr: '',
          data: {
            job_id: 'job-empty',
            status: null,
            timeline: [],
            attachments: { documents: [] },
          },
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.trackShow = commandAdapter['track-show'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: `${server.url}/`,
      pretendToBeVisual: true,
    });
    dom.window.fetch = (input, init) => fetch(input, init);

    const waitForCondition = async (predicate, timeout = 500) => {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          if (predicate()) {
            resolve();
            return;
          }
          if (Date.now() - start > timeout) {
            reject(new Error('Condition timed out'));
            return;
          }
          setTimeout(check, 10);
        };
        check();
      });
    };

    const waitForEvent = (name, timeout = 500) =>
      new Promise((resolve, reject) => {
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

    await waitForEvent('jobbot:status-panels-ready');
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForCondition(
      () => dom.window.JobbotStatusHub?.getPanelState('applications') === 'ready',
    );

    const form = dom.window.document.querySelector('[data-track-detail-form]');
    const jobInput = dom.window.document.querySelector('[data-track-detail-field="jobId"]');
    expect(form).not.toBeNull();
    expect(jobInput).not.toBeNull();
    if (jobInput) {
      jobInput.value = ' job-empty ';
    }
    form?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

    await waitForCondition(() => commandAdapter['track-show'].mock.calls.length > 0);
    await waitForCondition(() => {
      const panel = dom.window.document.querySelector('[data-status-panel="track-detail"]');
      return panel?.getAttribute('data-state') === 'ready';
    });

    const panel = dom.window.document.querySelector('[data-status-panel="track-detail"]');
    const emptyState = panel?.querySelector('[data-track-detail-empty]');
    const result = panel?.querySelector('[data-track-detail-result]');
    expect(emptyState?.hasAttribute('hidden')).toBe(false);
    expect(result?.hasAttribute('hidden')).toBe(true);
  });

  it('serves upcoming reminders as an ICS feed', async () => {
    const commandAdapter = {
      'track-reminders': vi.fn(async payload => {
        expect(payload).toEqual({
          includePastDue: false,
          calendarName: 'Team Sync',
          now: '2025-10-05T12:00:00Z',
        });
        return {
          command: 'track-reminders',
          format: 'json',
          stdout: '',
          stderr: '',
          data: {
            reminders: [
              {
                job_id: 'job-1',
                remind_at: '2025-10-06T09:00:00Z',
                note: 'Call hiring manager (Bearer sk_test_1234567890)',
                channel: 'phone',
              },
              {
                job_id: 'job-2',
                remind_at: '2025-10-04T09:00:00Z',
                note: 'Bearer sk_test_1234567890',
                past_due: true,
              },
            ],
          },
          correlationId: 'corr-789',
        };
      }),
    };
    commandAdapter.trackReminders = commandAdapter['track-reminders'];

    const server = await startServer({ commandAdapter });
    const headers = buildCommandHeaders(server);
    const response = await fetch(
      `${server.url}/commands/track-reminders.ics?calendarName=Team Sync&now=2025-10-05T12:00:00Z`,
      { headers },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/calendar');
    expect(response.headers.get('x-jobbot-calendar-filename')).toBe('team-sync.ics');
    expect(response.headers.get('x-jobbot-correlation-id')).toBe('corr-789');
    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('SUMMARY:job-1 — phone');
    const unfoldedBody = body.replace(/\r\n /g, '');
    expect(unfoldedBody).toContain('Note: Call hiring manager (Bearer ***)');
    expect(unfoldedBody).not.toContain('job-2');
  });

  it('returns validation errors when the calendar query is invalid', async () => {
    const server = await startServer();
    const headers = buildCommandHeaders(server);

    const response = await fetch(
      `${server.url}/commands/track-reminders.ics?now=not-a-date`,
      { headers },
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain('ISO 8601');
  });

  it('surfaces sanitized errors when generating the calendar fails', async () => {
    const commandAdapter = {
      'track-reminders': vi.fn(async () => {
        const error = new Error('reminders command failed');
        error.stdout = 'raw stdout';
        error.stderr = 'Bearer sk_live_abcdef123456';
        throw error;
      }),
    };
    commandAdapter.trackReminders = commandAdapter['track-reminders'];

    const server = await startServer({ commandAdapter });
    const headers = buildCommandHeaders(server);

    const response = await fetch(`${server.url}/commands/track-reminders.ics`, { headers });
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error).toContain('reminders command failed');
    expect(payload.stderr).toBe('Bearer ***');
  });

  it('downloads the reminders calendar through the status panel UI', async () => {
    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        data: { total: 0, offset: 0, limit: 10, items: [] },
      })),
      'track-reminders': vi.fn(async payload => {
        expect(payload).toEqual({ includePastDue: false });
        return {
          command: 'track-reminders',
          format: 'json',
          stdout: '',
          stderr: '',
          data: {
            reminders: [
              {
                job_id: 'job-1',
                remind_at: '2025-10-06T09:00:00Z',
                note: 'Check in with recruiter',
              },
            ],
          },
          correlationId: 'corr-ui-1',
        };
      }),
    };
    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.trackReminders = commandAdapter['track-reminders'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: `${server.url}/`,
      pretendToBeVisual: true,
    });
    dom.window.fetch = (input, init) => fetch(input, init);

    const blobTexts = [];
    dom.window.URL.createObjectURL = vi.fn(blob => {
      if (blob && typeof blob.text === 'function') {
        blobTexts.push(blob.text());
      }
      return 'blob:ics';
    });
    dom.window.URL.revokeObjectURL = vi.fn();

    const waitForEvent = eventName =>
      new Promise(resolve => {
        dom.window.document.addEventListener(eventName, resolve, { once: true });
      });

    const waitForCondition = async (predicate, timeout = 500) => {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          if (predicate()) {
            resolve();
            return;
          }
          if (Date.now() - start > timeout) {
            reject(new Error('Condition timed out'));
            return;
          }
          setTimeout(check, 10);
        };
        check();
      });
    };

    const remindersEvent = waitForEvent('jobbot:reminders-calendar-downloaded');
    await waitForEvent('jobbot:status-panels-ready');

    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    dom.window.location.hash = '#applications';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    await waitForCondition(
      () => dom.window.JobbotStatusHub?.getPanelState('track-reminders') === 'ready',
    );

    const downloadResult = await dom.window.JobbotStatusHub.downloadRemindersCalendar();
    expect(downloadResult).toMatchObject({ filename: 'jobbot-reminders.ics' });

    const event = await remindersEvent;
    const eventDetail = event?.detail ?? {};
    expect(eventDetail.filename).toBe('jobbot-reminders.ics');
    expect(eventDetail.correlationId).toBe('corr-ui-1');

    expect(dom.window.URL.createObjectURL).toHaveBeenCalledTimes(1);
    const [icsBody] = await Promise.all(blobTexts);
    expect(icsBody).toContain('job-1');
    expect(icsBody).toContain('Check in with recruiter');

    const panel = dom.window.document.querySelector('[data-status-panel="track-reminders"]');
    expect(panel?.getAttribute('data-state')).toBe('success');
    const successDetails = panel?.querySelector('[data-track-reminders-details]');
    expect(successDetails?.hasAttribute('hidden')).toBe(false);
    const filenameNode = panel?.querySelector('[data-track-reminders-filename]');
    expect(filenameNode?.textContent).toBe('jobbot-reminders.ics');
  });

  it('reports errors in the calendar panel when downloads fail', async () => {
    const commandAdapter = {
      'shortlist-list': vi.fn(async () => ({
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        data: { total: 0, offset: 0, limit: 10, items: [] },
      })),
      'track-reminders': vi.fn(async () => {
        const error = new Error('calendar generation failed');
        throw error;
      }),
    };
    commandAdapter.shortlistList = commandAdapter['shortlist-list'];
    commandAdapter.trackReminders = commandAdapter['track-reminders'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/`);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: `${server.url}/`,
      pretendToBeVisual: true,
    });
    dom.window.fetch = (input, init) => fetch(input, init);
    dom.window.URL.createObjectURL = vi.fn();
    dom.window.URL.revokeObjectURL = vi.fn();

    await new Promise(resolve => {
      dom.window.document.addEventListener('jobbot:status-panels-ready', resolve, {
        once: true,
      });
    });

    await expect(dom.window.JobbotStatusHub.downloadRemindersCalendar()).rejects.toThrow(
      'calendar generation failed',
    );

    const panel = dom.window.document.querySelector('[data-status-panel="track-reminders"]');
    expect(panel?.getAttribute('data-state')).toBe('error');
    const errorMessage = panel?.querySelector('[data-error-message]');
    expect(errorMessage?.textContent).toContain('calendar generation failed');
    expect(dom.window.URL.createObjectURL).not.toHaveBeenCalled();
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

  it('executes track-show commands and redacts secret-like fields', async () => {
    const commandAdapter = {
      'track-show': vi.fn(async payload => {
        expect(payload).toEqual({ jobId: 'job-99' });
        return {
          command: 'track-show',
          stdout: '{"status":{"note":"API_KEY=abcd1234secret"}}',
          stderr: 'Bearer sk_live_1234567890',
          data: {
            job_id: 'job-99',
            status: { value: 'screening', note: 'API_KEY=abcd1234secret' },
            timeline: [],
            attachments: { documents: [] },
          },
        };
      }),
    };
    commandAdapter.trackShow = commandAdapter['track-show'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/track-show`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ jobId: ' job-99 ' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.command).toBe('track-show');
    expect(payload.stdout).toBe('{"status":{"note":"API_KEY=***"}}');
    expect(payload.stderr).toBe('Bearer ***');
    expect(payload.data).toEqual({
      job_id: 'job-99',
      status: { value: 'screening', note: 'API_KEY=***' },
      timeline: [],
      attachments: { documents: [] },
    });
    expect(commandAdapter['track-show']).toHaveBeenCalledTimes(1);
  });

  it('executes track-add commands with sanitized payloads', async () => {
    const commandAdapter = {
      'track-add': vi.fn(async payload => {
        expect(payload).toEqual({
          jobId: 'job-77',
          status: 'offer',
          note: 'Offer accepted',
          date: '2025-01-02T15:00:00Z',
        });
        return {
          command: 'track-add',
          stdout: 'Recorded job-77 as offer',
          stderr: 'Bearer sk_live_1234567890',
        };
      }),
    };
    commandAdapter.trackAdd = commandAdapter['track-add'];

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/track-add`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({
        jobId: ' job-77 ',
        status: ' Offer ',
        note: ' Offer accepted ',
        date: '2025-01-02T15:00:00Z',
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      command: 'track-add',
      stdout: 'Recorded job-77 as offer',
      stderr: 'Bearer ***',
    });
    expect(commandAdapter['track-add']).toHaveBeenCalledTimes(1);
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
