# SOC 2 control coverage: change management and incident response

This document closes the **SOC 2 Type II** gap called out in
[`docs/web-security-roadmap.md`](../web-security-roadmap.md) by describing the
change management and incident response controls now implemented in code. The
controls emphasize auditable records, reviewer accountability, and a repeatable
post-incident review loop.

## Change management controls

Changes that affect the jobbot3000 CLI or web status hub must carry traceable
metadata:

- **Required fields:** `title` and `description` summarize the change and any
  rollout guardrails (e.g., rate limits, feature flags).
- **Approvals:** `approver` captures the human who reviewed the change along
  with the `ticket` or RFC identifier that triggered the work.
- **Deployment traceability:** `deployed_by` and `deployed_at` record who pushed
  the change and when it landed so auditors can correlate outcomes with release
  windows.

The `recordChangeEvent` helper writes normalized entries to
`data/compliance/change-log.json` via the `src/security/soc2-controls.js`
module. Entries are appended with UUIDs, ISO-8601 timestamps, and sanitized
strings to prevent blank or whitespace-only records. Tests in
[`test/soc2-controls.test.js`](../../test/soc2-controls.test.js) exercise the
helper and ensure missing titles or descriptions fail fast.

## Incident response controls

Incidents follow a consistent capture format to support root-cause analysis and
recurring tabletop exercises:

- **Required fields:** `title` and `summary` document what happened and what the
  responder observed.
- **Severity:** `severity` is normalized to one of `low`, `medium`, `high`, or
  `critical` to drive prioritization and follow-up actions.
- **Impact accounting:** `impacted_systems` lists affected surfaces (for
  example, `web` or `cli`). The array is sanitized and deduplicated to avoid
  noisy evidence trails.
- **Response metadata:** `responder`, `detected_at`, and `resolved_at` capture
  accountability and time-to-resolve measurements.

The `recordIncidentReport` helper persists incident metadata to
`data/compliance/incident-reports.json`, again normalizing and rejecting empty
fields. `listIncidentReports` returns the stored records for auditors and for
post-incident review tooling. Regression coverage in
[`test/soc2-controls.test.js`](../../test/soc2-controls.test.js) locks the
normalization and required-field guardrails in place.

## Usage

```js
import {
  recordChangeEvent,
  listChangeEvents,
  recordIncidentReport,
  listIncidentReports,
} from "./src/security/soc2-controls.js";

await recordChangeEvent({
  title: "Deploy shortlist reminder ICS export",
  description: "Enabled calendar downloads behind rate limits",
  approver: "Pat Ops",
  ticket: "CHG-1234",
  deployedBy: "Casey",
  deployedAt: new Date().toISOString(),
});

await recordIncidentReport({
  title: "Status hub outage",
  summary: "Web sockets failed during deploy",
  severity: "high",
  impactedSystems: ["web", "cli"],
  responder: "Jordan",
});
```

Both helpers honor `JOBBOT_DATA_DIR` for custom storage paths and accept the
`setComplianceDataDir` override for tests and tooling. Change and incident logs
are stored as JSON files with temporary-write + rename semantics to prevent
partial writes during outages or forced process exits.
