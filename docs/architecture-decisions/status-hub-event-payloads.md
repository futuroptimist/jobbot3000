# ADR-0001: Status hub emits formatted status labels in event payloads

- **Date:** 2025-10-12
- **Status:** Accepted
- **Related docs:** [Web Interface Roadmap](../web-interface-roadmap.md)
- **Tests:** [`test/web-server.test.js`](../../test/web-server.test.js),
  [`test/docs-adr.test.js`](../../test/docs-adr.test.js)

## Context

The web status hub dispatches `jobbot:application-status-recorded` events after
persisting lifecycle updates through the CLI adapter. A roadmap note called for
including human-readable `statusLabel` text in the payload so browser extensions
can react to updates without duplicating label formatting logic.

## Decision

Include the formatted `statusLabel` field in every dispatched
`jobbot:application-status-recorded` event. Hoist the existing
`formatStatusLabelText` helper so both the HTML renderer and event dispatcher
reuse the same label formatting. Trim user-provided notes before emitting the
payload so downstream consumers do not need to reimplement sanitization.

## Consequences

- UI integrations receive ready-to-render status labels alongside raw CLI data.
- Tests in `test/web-server.test.js` exercise the DOM workflow and lock the
  event payload contract.
- The ADR catalog (`test/docs-adr.test.js`) now ensures the decision stays
  documented and linked to regression coverage.
