#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { setTimeout as delay } from 'node:timers/promises';

import puppeteer from 'puppeteer';

import { startWebServer } from '../src/web/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function buildShortlistFixtures() {
  const shortlistItems = [
    {
      id: 'acme-senior-fe',
      metadata: {
        location: 'Remote (US)',
        level: 'Staff Frontend',
        compensation: '$210k base + equity',
        synced_at: '2025-01-15T10:30:00Z',
      },
      tags: ['React', 'TypeScript', 'Design systems'],
      discard_count: 1,
      last_discard: {
        reason: 'Team paused hiring for Q4',
        discarded_at: '2024-12-18T18:45:00Z',
        tags: ['timing'],
      },
    },
    {
      id: 'aurora-ml-eng',
      metadata: {
        location: 'Hybrid (SF)',
        level: 'Senior ML',
        compensation: '$245k base + bonus',
        synced_at: '2025-01-08T16:15:00Z',
      },
      tags: ['Machine Learning', 'LLM Ops', 'MLOps'],
      discard_count: 0,
      last_discard: null,
    },
  ];

  const shortlistDetails = {
    'acme-senior-fe': {
      job_id: 'acme-senior-fe',
      metadata: {
        location: 'Remote (US)',
        level: 'Staff Frontend',
        compensation: '$210k base + equity',
        synced_at: '2025-01-15T10:30:00Z',
      },
      tags: ['React', 'TypeScript', 'Design systems'],
      attachments: ['acme-brief.pdf', 'system-architecture.png'],
      discard_count: 1,
      last_discard: {
        reason: 'Team paused hiring for Q4',
        discarded_at: '2024-12-18T18:45:00Z',
        tags: ['timing'],
      },
      events: [
        {
          channel: 'Referral',
          date: '2025-01-05',
          contact: 'Dana – Director of Engineering',
          note: 'Warm intro from former teammate; portfolio requested.',
          documents: ['intro-notes.md'],
        },
        {
          channel: 'Phone',
          date: '2025-01-12',
          contact: 'Alex – Hiring Manager',
          note: 'Deep dive into design system roadmap and leadership expectations.',
          documents: ['system-architecture.png'],
          remind_at: '2025-01-19',
        },
      ],
    },
    'aurora-ml-eng': {
      job_id: 'aurora-ml-eng',
      metadata: {
        location: 'Hybrid (SF)',
        level: 'Senior ML',
        compensation: '$245k base + bonus',
        synced_at: '2025-01-08T16:15:00Z',
      },
      tags: ['Machine Learning', 'LLM Ops', 'MLOps'],
      attachments: ['aurora-case-study.pdf'],
      discard_count: 0,
      last_discard: null,
      events: [
        {
          channel: 'Email',
          date: '2025-01-07',
          contact: 'Priya – Lead Recruiter',
          note: 'Shared current LLM deployment stack and interview loop overview.',
        },
      ],
    },
  };

  const trackDetails = {
    'acme-senior-fe': {
      job_id: 'acme-senior-fe',
      status: 'onsite',
      note: 'Panel scheduled for Feb 03 with product design walkthrough.',
      attachments: ['onsite-agenda.pdf'],
      events: [
        {
          channel: 'Email',
          date: '2025-01-16',
          contact: 'Jamie – Recruiter',
          note: 'Sent onsite prep packet and travel details.',
          documents: ['onsite-agenda.pdf'],
        },
      ],
    },
    'aurora-ml-eng': {
      job_id: 'aurora-ml-eng',
      status: 'phone-screen',
      note: 'Follow-up technical round pending final schedule.',
      attachments: [],
      events: [
        {
          channel: 'Phone',
          date: '2025-01-10',
          contact: 'Kevin – Staff ML Engineer',
          note: 'Discussed experimentation platform and feature store.',
        },
      ],
    },
  };

  return { shortlistItems, shortlistDetails, trackDetails };
}

function buildAnalyticsFixture() {
  return {
    totals: {
      trackedJobs: 18,
      withEvents: 14,
    },
    largestDropOff: {
      fromLabel: 'Onsite interviews',
      toLabel: 'Offer extended',
      dropOff: 4,
    },
    missing: {
      statuslessJobs: { count: 1 },
    },
    stages: [
      {
        key: 'applied',
        label: 'Applied',
        count: 18,
        conversionRate: 1,
        dropOff: 0,
      },
      {
        key: 'recruiter_screen',
        label: 'Recruiter screen',
        count: 16,
        conversionRate: 0.89,
        dropOff: 2,
      },
      {
        key: 'phone_screen',
        label: 'Phone screen',
        count: 12,
        conversionRate: 0.75,
        dropOff: 4,
      },
      {
        key: 'onsite',
        label: 'Onsite interviews',
        count: 6,
        conversionRate: 0.5,
        dropOff: 6,
      },
      {
        key: 'offer',
        label: 'Offer extended',
        count: 2,
        conversionRate: 0.33,
        dropOff: 4,
      },
    ],
    sankey: {
      nodes: [
        { id: 'applied', label: 'Applied' },
        { id: 'recruiter_screen', label: 'Recruiter screen' },
        { id: 'phone_screen', label: 'Phone screen' },
        { id: 'onsite', label: 'Onsite interviews' },
        { id: 'offer', label: 'Offer extended' },
        { id: 'archived', label: 'Archived' },
      ],
      links: [
        { source: 'applied', target: 'recruiter_screen', value: 16 },
        { source: 'recruiter_screen', target: 'phone_screen', value: 12 },
        { source: 'phone_screen', target: 'onsite', value: 6 },
        { source: 'onsite', target: 'offer', value: 2 },
        { source: 'recruiter_screen', target: 'archived', value: 4, drop: true },
        { source: 'phone_screen', target: 'archived', value: 6, drop: true },
        { source: 'onsite', target: 'archived', value: 4, drop: true },
      ],
    },
  };
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function buildCommandAdapter(fixtures) {
  const { shortlistItems, shortlistDetails, trackDetails } = fixtures;
  const shortlistMap = new Map(Object.entries(shortlistDetails));
  const trackMap = new Map(Object.entries(trackDetails));
  const analyticsSnapshot = buildAnalyticsFixture();

  return {
    async ['shortlist-list'](payload = {}) {
      const limit = Number.isFinite(payload?.limit) ? payload.limit : shortlistItems.length;
      const offset = Number.isFinite(payload?.offset) ? payload.offset : 0;
      const safeOffset = Math.max(0, Math.min(offset, shortlistItems.length));
      const safeLimit = Math.max(1, Math.min(limit, shortlistItems.length));
      const slice = shortlistItems.slice(safeOffset, safeOffset + safeLimit);
      return {
        command: 'shortlist-list',
        format: 'json',
        stdout: '',
        stderr: '',
        data: {
          total: shortlistItems.length,
          offset: safeOffset,
          limit: safeLimit,
          items: slice,
          filters: payload?.filters ?? {},
          hasMore: safeOffset + safeLimit < shortlistItems.length,
        },
      };
    },
    async ['shortlist-show'](payload = {}) {
      const key = payload?.jobId ?? payload?.job_id;
      const detail = shortlistMap.get(key) ?? shortlistMap.values().next().value;
      return {
        command: 'shortlist-show',
        format: 'json',
        stdout: '',
        stderr: '',
        data: detail,
      };
    },
    async ['track-show'](payload = {}) {
      const key = payload?.jobId ?? payload?.job_id;
      const detail = trackMap.get(key) ?? trackMap.values().next().value;
      return {
        command: 'track-show',
        format: 'json',
        stdout: '',
        stderr: '',
        data: detail,
      };
    },
    async ['track-record'](payload = {}) {
      const jobId = payload?.jobId ?? payload?.job_id ?? 'unknown';
      const status = payload?.status ?? 'applied';
      const note = payload?.note;
      const message = `Recorded ${jobId} as ${status}` + (note ? ` — ${note}` : '');
      return {
        command: 'track-record',
        format: 'text',
        stdout: message,
        stderr: '',
        data: { jobId, status, note, message },
      };
    },
    async ['analytics-funnel']() {
      return {
        command: 'analytics-funnel',
        format: 'json',
        stdout: '',
        stderr: '',
        data: analyticsSnapshot,
      };
    },
    async ['analytics-export']() {
      return {
        command: 'analytics-export',
        format: 'json',
        stdout: '',
        stderr: '',
        data: analyticsSnapshot,
      };
    },
  };
}

async function waitForRoute(page, route) {
  const selector = `[data-route="${route}"][data-active="true"]`;
  await page.waitForSelector(selector, { timeout: 15_000 });
}

async function waitForApplications(page) {
  await page.waitForSelector('[data-shortlist-table]:not([hidden])', { timeout: 15_000 });
}

async function waitForAnalytics(page) {
  await page.waitForSelector('[data-analytics-table]', { timeout: 15_000 });
}

async function waitForAudits(page) {
  await page.waitForSelector('[data-status-panel="audits"]', { timeout: 15_000 });
}

async function captureScreenshots(baseUrl, outputDir) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const routes = [
      { slug: 'overview', wait: () => waitForRoute(page, 'overview') },
      {
        slug: 'applications',
        wait: async () => {
          await waitForRoute(page, 'applications');
          await waitForApplications(page);
        },
      },
      { slug: 'commands', wait: () => waitForRoute(page, 'commands') },
      {
        slug: 'analytics',
        wait: async () => {
          await waitForRoute(page, 'analytics');
          await waitForAnalytics(page);
        },
      },
      {
        slug: 'audits',
        wait: async () => {
          await waitForRoute(page, 'audits');
          await waitForAudits(page);
        },
      },
    ];

    for (const { slug, wait } of routes) {
      const targetUrl = `${baseUrl}/#${slug}`;
      process.stdout.write(`Capturing ${slug} view from ${targetUrl}\n`);
      await page.goto(targetUrl, { waitUntil: 'networkidle0' });
      await wait();
      await delay(500);
      const outputPath = path.join(outputDir, `${slug}.png`);
      await page.screenshot({ path: outputPath, fullPage: true });
      process.stdout.write(`  → Saved ${path.relative(projectRoot, outputPath)}\n`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const outputDir = path.resolve(projectRoot, 'docs', 'screenshots');
  await ensureDirectory(outputDir);

  const fixtures = buildShortlistFixtures();
  const commandAdapter = buildCommandAdapter(fixtures);

  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'screenshot-runner',
    csrfHeaderName: 'x-jobbot-csrf',
    info: { service: 'jobbot web interface', version: 'screenshot-fixtures' },
    commandAdapter,
  });

  process.stdout.write(`Web server listening at ${server.url}\n`);

  try {
    await captureScreenshots(server.url, outputDir);
  } finally {
    await server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
