import { performance } from 'node:perf_hooks';

import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { ReportScoring } from 'lighthouse/core/scoring.js';
import { Audit } from 'lighthouse/core/audits/audit.js';
import FirstContentfulPaint from 'lighthouse/core/audits/metrics/first-contentful-paint.js';
import LargestContentfulPaint from 'lighthouse/core/audits/metrics/largest-contentful-paint.js';
import SpeedIndex from 'lighthouse/core/audits/metrics/speed-index.js';
import TotalBlockingTime from 'lighthouse/core/audits/metrics/total-blocking-time.js';
import CumulativeLayoutShift from 'lighthouse/core/audits/metrics/cumulative-layout-shift.js';

function escapeForHtmlAttribute(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/["&'<>]/g, character => {
    switch (character) {
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return character;
    }
  });
}

function removeScriptElements(document) {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    script.remove();
  }
}

export async function runAccessibilityAudit(html, options = {}) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('Accessibility audit requires non-empty HTML input');
  }

  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
  try {
    const { window } = dom;
    removeScriptElements(window.document);
    window.eval(axe.source);
    const context = options.context ?? window.document;
    const defaultConfig = {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa'],
      },
      rules: {
        'color-contrast': { enabled: false },
      },
    };
    const providedConfig = options.config ?? {};
    const config = {
      ...defaultConfig,
      ...providedConfig,
      runOnly: { ...defaultConfig.runOnly, ...(providedConfig.runOnly ?? {}) },
      rules: { ...defaultConfig.rules, ...(providedConfig.rules ?? {}) },
    };
    const results = await window.axe.run(context, config);
    return {
      violations: results.violations.map(violation => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        help: violation.help,
        nodes: violation.nodes.map(node => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
        })),
      })),
      passes: results.passes.map(pass => ({
        id: pass.id,
        impact: pass.impact,
        description: pass.description,
      })),
    };
  } finally {
    dom.window.close();
  }
}

const PERFORMANCE_WEIGHTS = {
  'first-contentful-paint': 10,
  'largest-contentful-paint': 25,
  'speed-index': 10,
  'total-blocking-time': 30,
  'cumulative-layout-shift': 25,
};

function resolveMobileScoring(metric) {
  const options = metric.defaultOptions;
  if (!options || typeof options !== 'object') {
    throw new Error('Metric is missing default scoring options');
  }
  if (options.mobile?.scoring) {
    return options.mobile.scoring;
  }
  if (options.scoring) {
    return options.scoring;
  }
  if (typeof options.p10 === 'number' && typeof options.median === 'number') {
    return { p10: options.p10, median: options.median };
  }
  throw new Error('Unsupported scoring configuration');
}

const PERFORMANCE_SCORING = {
  'first-contentful-paint': resolveMobileScoring(FirstContentfulPaint),
  'largest-contentful-paint': resolveMobileScoring(LargestContentfulPaint),
  'speed-index': resolveMobileScoring(SpeedIndex),
  'total-blocking-time': resolveMobileScoring(TotalBlockingTime),
  'cumulative-layout-shift': resolveMobileScoring(CumulativeLayoutShift),
};

function buildPerformanceMetrics({ durationMs, transferSize }) {
  const roundedDuration = Number(durationMs.toFixed(2));
  const metrics = {
    firstContentfulPaint: roundedDuration,
    largestContentfulPaint: roundedDuration,
    totalBlockingTime: 0,
    speedIndex: roundedDuration,
    cumulativeLayoutShift: 0,
    interactive: roundedDuration,
    transferSize,
  };

  const metricScores = {
    'first-contentful-paint': Audit.computeLogNormalScore(
      PERFORMANCE_SCORING['first-contentful-paint'],
      metrics.firstContentfulPaint,
    ),
    'largest-contentful-paint': Audit.computeLogNormalScore(
      PERFORMANCE_SCORING['largest-contentful-paint'],
      metrics.largestContentfulPaint,
    ),
    'speed-index': Audit.computeLogNormalScore(
      PERFORMANCE_SCORING['speed-index'],
      metrics.speedIndex,
    ),
    'total-blocking-time': Audit.computeLogNormalScore(
      PERFORMANCE_SCORING['total-blocking-time'],
      metrics.totalBlockingTime,
    ),
    'cumulative-layout-shift': Audit.computeLogNormalScore(
      PERFORMANCE_SCORING['cumulative-layout-shift'],
      metrics.cumulativeLayoutShift,
    ),
  };

  const weightedScores = Object.entries(metricScores).map(([id, score]) => ({
    id,
    score,
    weight: PERFORMANCE_WEIGHTS[id],
  }));

  const score = ReportScoring.arithmeticMean(weightedScores);

  return { score, metrics, metricScores };
}

export async function runPerformanceAudit(url, options = {}) {
  if (typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error('Performance audit requires an absolute URL');
  }

  const start = performance.now();
  const response = await fetch(url, { signal: options.signal });
  const rawBody = await response.arrayBuffer();
  const durationMs = performance.now() - start;
  const transferSize = rawBody.byteLength;

  const { score, metrics, metricScores } = buildPerformanceMetrics({ durationMs, transferSize });
  const html = Buffer.from(rawBody).toString('utf8');

  return {
    score,
    metrics,
    metricScores,
    html,
  };
}

export function formatAccessibilitySummary(report) {
  if (!report || typeof report !== 'object') {
    return 'No accessibility data available.';
  }
  if (!Array.isArray(report.violations) || report.violations.length === 0) {
    return 'No WCAG AA violations detected.';
  }
  const items = report.violations.map(violation => {
    const targets = violation.nodes
      .map(node =>
        node.target
          .map(selector => `\u2022 ${escapeForHtmlAttribute(selector)}`)
          .join('\n'),
      )
      .join('\n');
    const impact = violation.impact ?? 'unknown impact';
    const heading = `${violation.id} (${impact})`;
    return `${heading}\n${violation.help}\n${targets}`;
  });
  return items.join('\n\n');
}
