# Risk assessment and threat modeling workflow

Structured risk reviews now gate every feature launch. This guide explains how to
capture threat models, compute scenario severity, and publish Markdown risk
assessments using the new automation shipped alongside
[`docs/web-security-roadmap.md`](docs/web-security-roadmap.md).

## When to run this workflow

Run the assessment before merging a feature that changes data handling, process
boundaries, or authentication flows. The checklist produces the documentation
and evidence needed for sign-off:

1. Define the feature scope, sensitive assets, entry points, and threat actors.
2. Capture STRIDE-aligned scenarios with impact and likelihood ratings.
3. Generate the Markdown assessment via `scripts/generate-risk-assessment.js`.
4. Commit the rendered report under `docs/security/risk-assessments/` and link
   it from the relevant design or launch documentation.

## Author the JSON configuration

Create a JSON file describing the feature. The required fields align with the
helper exported from `src/shared/security/risk-assessment.js`:

- `feature`: Human-readable name used for the Markdown heading.
- `summary`: One sentence describing the change and its motivation.
- `dataClassification`: Sensitivity of the assets touched by the feature.
- `assets`: Array of data stores or surfaces the feature interacts with.
- `entryPoints`: Array of ingress paths (HTTP endpoints, CLI flags, background
  jobs, etc.).
- `threatActors`: Primary actors to consider (malicious plugin author, insider
  threat, compromised account).
- `scenarios`: Array of STRIDE scenarios. Each entry includes:
  - `id`: Short identifier used in the scenario table.
  - `title`: Scenario title.
  - `category`: STRIDE category (`Spoofing`, `Tampering`, `Repudiation`,
    `Information Disclosure`, `Denial of Service`, `Elevation of Privilege`).
  - `description`: What could go wrong.
  - `impact` and `likelihood`: `low`, `medium`, `high`, or `critical`.
  - Optional `mitigations`, `detection`, and `notes` arrays.
- `mitigations`: Object containing:
  - `mustHave`: Controls required before launch.
  - `defenseInDepth`: Additional safeguards for later hardening.
  - `detection`: Alerting or monitoring hooks.
- Optional `residualRisk` and `references` strings/arrays for follow-up work.

Example configuration stored beside design docs:

```json
{
  "feature": "Plugin host automation API",
  "summary": "Allow third-party status hub plugins to call curated command hooks.",
  "dataClassification": "Confidential",
  "assets": ["Status hub DOM", "CLI command adapter", "API tokens"],
  "entryPoints": ["Plugin manifest", "WebSocket event bus"],
  "threatActors": ["Malicious plugin author", "Compromised operator account"],
  "scenarios": [
    {
      "id": "plugin-xss",
      "title": "Plugin injects script into status hub",
      "category": "Tampering",
      "description": "Untrusted bundle bypasses CSP and steals operator tokens.",
      "impact": "critical",
      "likelihood": "medium",
      "mitigations": [
        "Require Subresource Integrity for plugin bundles",
        "Serve plugin assets from a dedicated, allow-listed directory"
      ],
      "detection": ["Alert when plugin registrations fail integrity validation"]
    },
    {
      "id": "plugin-exfil",
      "title": "Plugin exports shortlist data to external host",
      "category": "Information Disclosure",
      "description": "Plugin abuses command adapter to stream sensitive data.",
      "impact": "high",
      "likelihood": "medium",
      "mitigations": [
        "Enforce role requirements per command",
        "Redact command payloads before plugin callbacks"
      ],
      "detection": [
        "Log command payload shapes and emit web.security telemetry"
      ]
    }
  ],
  "mitigations": {
    "mustHave": [
      "Verify plugin bundles with integrity metadata",
      "Enforce role-based access control for plugin command calls"
    ],
    "defenseInDepth": ["Sandbox plugin execution with trusted iframes"],
    "detection": [
      "Alert on repeated plugin registration failures",
      "Audit log command payload summaries"
    ]
  },
  "residualRisk": "Operators must vet plugin manifests for data exfiltration attempts.",
  "references": ["docs/web-interface-roadmap.md", "test/web-plugins.test.js"]
}
```

## Generate the assessment

Use the new npm script (or call the Node file directly) to produce Markdown:

```bash
npm run security:risk-assessment -- \
  --config security/risk-assessments/plugin-host.json \
  --output docs/security/risk-assessments/plugin-host.md
```

When `--output` is omitted the Markdown renders to stdout, making it easy to
preview inside review tools. The script validates the STRIDE category and
rating scales and reports failures via exit code 1.

## Severity and approval thresholds

`createRiskAssessment` maps the impact/likelihood pair to a score and severity
bucket:

| Score | Severity | Action                                                                        |
| ----- | -------- | ----------------------------------------------------------------------------- |
| 16+   | Critical | Block launch until mitigations lower risk.                                    |
| 9–15  | High     | Security sign-off required before launch; document mitigations and detection. |
| 4–8   | Medium   | Document mitigations and detection before launch; monitor post-release.       |
| 0–3   | Low      | Document residual risk and monitor.                                           |

The Markdown export lists the recommended action in both the summary and per
scenario rows so reviewers can trace the gating decision.

## Regression coverage

The new automation ships with dedicated tests:

- `test/security-risk-assessment.test.js` exercises risk scoring, STRIDE
  validation, and Markdown generation.
- `test/security-risk-assessment-cli.test.js` drives the CLI end to end,
  including writing reports to disk.
- `test/docs-security-risk-assessment.test.js` keeps this guide aligned with the
  script and regression suites.

Keep these suites green when refining the workflow or updating the STRIDE
catalog—CI blocks merges if the process drifts from the documented contract.
