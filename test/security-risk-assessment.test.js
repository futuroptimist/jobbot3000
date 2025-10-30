import { describe, it, expect } from 'vitest';

import {
  createRiskAssessment,
  formatRiskAssessmentMarkdown,
} from '../src/shared/security/risk-assessment.js';

const baseConfig = {
  feature: 'Plugin host automation API',
  summary: 'Allow third-party plugins to call curated command hooks.',
  dataClassification: 'Confidential',
  assets: ['Status hub DOM', 'CLI command adapter', 'API tokens'],
  entryPoints: ['Plugin manifest', 'WebSocket event bus'],
  threatActors: ['Malicious plugin author', 'Compromised operator account'],
  scenarios: [
    {
      id: 'plugin-xss',
      title: 'Plugin injects script into status hub',
      category: 'Tampering',
      description: 'Untrusted bundle bypasses CSP and steals operator tokens.',
      impact: 'critical',
      likelihood: 'critical',
      mitigations: [
        'Require Subresource Integrity for plugin bundles',
        'Serve plugin assets from a dedicated directory',
      ],
      detection: ['Alert when plugin registrations fail integrity validation'],
    },
    {
      id: 'plugin-exfil',
      title: 'Plugin exports shortlist data to external host',
      category: 'Information Disclosure',
      description: 'Plugin abuses command adapter to stream sensitive data.',
      impact: 'high',
      likelihood: 'medium',
    },
  ],
  mitigations: {
    mustHave: ['Verify plugin bundles with integrity metadata'],
    defenseInDepth: ['Sandbox plugin execution with trusted iframes'],
    detection: ['Audit log command payload summaries'],
  },
  residualRisk: 'Operators must vet plugin manifests for data exfiltration attempts.',
  references: ['docs/web-interface-roadmap.md', 'test/web-plugins.test.js'],
};

describe('risk assessment helper', () => {
  it('computes severity, coverage, and recommended action', () => {
    const assessment = createRiskAssessment(baseConfig);

    expect(assessment.summary.highestSeverity).toBe('critical');
    expect(assessment.summary.highestScore).toBe(16);
    expect(assessment.summary.recommendedAction).toMatch(/Block launch/);
    expect(assessment.summary.strideCoverage).toEqual([
      'Information Disclosure',
      'Tampering',
    ]);
    expect(assessment.scenarios).toHaveLength(2);
    expect(assessment.scenarios[0].id).toBe('plugin-xss');
    expect(assessment.scenarios[0].severity.score).toBe(16);
    expect(assessment.scenarios[1].severity.level).toBe('medium');
    expect(assessment.mitigations.mustHave).toContain(
      'Verify plugin bundles with integrity metadata',
    );
  });

  it('rejects unknown STRIDE categories and ratings', () => {
    expect(() =>
      createRiskAssessment({
        ...baseConfig,
        scenarios: [
          {
            id: 'invalid',
            title: 'Unknown category',
            category: 'Phishing',
            description: 'Not a STRIDE category',
            impact: 'low',
            likelihood: 'low',
          },
        ],
      }),
    ).toThrow(/STRIDE category/);

    expect(() =>
      createRiskAssessment({
        ...baseConfig,
        scenarios: [
          {
            id: 'bad-rating',
            title: 'Bad rating',
            category: 'Tampering',
            description: 'Unknown rating',
            impact: 'unknown',
            likelihood: 'low',
          },
        ],
      }),
    ).toThrow(/scenario impact must be one of/);
  });

  it('formats Markdown with summary, table, and mitigation sections', () => {
    const assessment = createRiskAssessment(baseConfig);
    const markdown = formatRiskAssessmentMarkdown(assessment);

    expect(markdown).toMatch(/^# Risk assessment: Plugin host automation API/m);
    expect(markdown).toMatch(/\*\*Data classification:\*\* Confidential/);
    expect(markdown).toMatch(/\| plugin-xss \| Plugin injects script into status hub \|/);
    expect(markdown).toMatch(/Mitigations \(must implement\)/);
    expect(markdown).toMatch(/Residual risk/);
    expect(markdown).toMatch(/docs\/web-interface-roadmap\.md/);
  });
});
