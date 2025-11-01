# Architecture Decision Records (ADR)

This directory captures architecture decision records for jobbot3000.
Each ADR documents the context, decision, consequences, and linked
regression tests so future contributors can trace why a design exists
and which suites enforce the contract. Update the index when adding a
new ADR so automated checks can validate the catalog.

## Accepted decisions

| ADR ID                                     | Title                                                  | Status   | Decided    | Summary                                                                                          |
| ------------------------------------------ | ------------------------------------------------------ | -------- | ---------- | ------------------------------------------------------------------------------------------------ |
| [ADR-0001](./status-hub-event-payloads.md) | Expose status hub event payloads with formatted labels | Accepted | 2025-10-12 | Status hub dispatches jobbot:application-status-recorded events with statusLabel for extensions. |

`test/docs-adr.test.js` asserts every accepted ADR listed in
`index.json` appears in this table so contributors update the catalog
whenever they record a new decision.
