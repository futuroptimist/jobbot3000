# Browser import admission

Browser import entry points enforce `IMPORT_LIMITS_V1` (policy version 1).
These provisional engineering limits bound accepted work, not browser memory or
elapsed time. Every applicable limit must hold; the limits are not independently
achievable for every record shape.

| Budget                                              |                                   Maximum |
| --------------------------------------------------- | ----------------------------------------: |
| Encoded file or direct string                       |                               8 MiB UTF-8 |
| CSV data records, including discarded blank records |                                     5,000 |
| CSV columns                                         |                                        64 |
| NDJSON nonblank records                             |                                    10,002 |
| NDJSON physical line                                |                               1 MiB UTF-8 |
| JSON depth (root value is 1)                        |                                        32 |
| JSON values (including containers) plus object keys |                                   100,000 |
| String value or property name                       |                  65,536 UTF-16 code units |
| Candidate records across stores                     |                                    10,000 |
| Applications                                        |                                     1,000 |
| Lifecycle events                                    |                                     5,000 |
| Contact-reference edges                             |                                    20,000 |
| Supersession chain, including its starting event    |                                       128 |
| Reported issues                                     | 50, with an explicit truncation indicator |

File size is checked before `file.text()`. Direct text entry points recheck UTF-8
bytes. A lexical JSON scan bounds nesting and structural work before native
parsing; an iterative descriptor walker checks parsed and direct objects before
normalization. NDJSON work accumulates across lines without splitting the entire
file into an array. Accessors, cycles/shared object graphs, sparse arrays and
non-JSON values are rejected. Optional object properties may remain undefined.
Native JSON duplicate-key last-value semantics remain; duplicate keys still count
against lexical work. Existing file-reader decoding semantics remain unchanged.

CSV retains BOM, CRLF, quoted multiline fields, escaped quotes, short-row padding,
formula-like text and canonical raw/normalized metadata. Unterminated quoted
fields, duplicate trimmed/lowercase headers and extra cells are blocking errors.
A terminal newline terminates its record without creating an extra empty record.
Existing converter deduplication and merge/skip ID remapping remain authoritative.
Admission runs before normalization and after migration/metadata expansion.

## Ownership and transactions

For admitted outreach messages, reminders and interview participants, the
referenced contact must belong to the referring application. Missing optional
references and empty interview participant lists are valid. Existing schema
checks still reject missing parents/references and invalid lifecycle graphs.
Direct partial batches reject duplicate normalized IDs before a merge could
collapse them. Full restore validates the incoming replacement; partial import
validates the complete merged candidate, including unchanged local records.

Reparenting a contact is blocked if an existing reference becomes invalid. A batch
that explicitly repairs every affected reference may succeed. Import rejection
never silently reparents, drops or copies a record. All validation precedes the
existing write transaction, retaining all-or-nothing persistence and overwrite
gates. Partial `dryRun` uses the same candidate validation without writes.

Preview invalidation uses a monotonically increasing file-selection token. An
obsolete file read or asynchronous preview cannot enable Apply or replace the
current selection's error. This is **not** a database revision token. Partial
validation still reads a snapshot before its write transaction; concurrent
writers and other CRUD entry points are outside this contract.

## Diagnostics and recovery

Admission failures use `import_admission_failed`; contact ownership failures use
`import_ownership_failed`. Native parse/schema exception excerpts are not shown.
Diagnostic fields and stores are fixed names, not imported keys or values.
Ownership issues identify incoming/existing origin, zero-based record index,
field, and optional participant index. NDJSON ownership diagnostics also retain
physical source lines. Merged indices are mapped back to incoming or existing
store positions and never presented as original file lines. UI positions are
one-based. Diagnostics are not sent to telemetry.

For example, a reminder owned by synthetic `app_A` referencing a contact owned by
`app_B` is rejected. The user should keep the original backup, repair a copy by
selecting a contact owned by that application or removing the optional reference,
and preview again. If a person belongs under both applications, the user may
create a distinct application-owned contact with a new ID and explicitly change
the intended references. The importer does not choose ownership for them.

Canonical JSON/NDJSON exports retain their existing shared schema, so legacy
ownership errors do not block exporting a backup for repair. Such errors can block
an otherwise unrelated partial import. Oversized local candidates likewise block
imports without changing export behavior. Existing bulk reads are not a proven
allocation bound. No automatic retry follows a failed import.

Imported actor, source and timestamps remain unverified claims. This change does
not authenticate audit history, introduce durable provenance, implement HMAC or
checkpoints, change CLI import atomicity, add spreadsheet-safe export, or solve
cross-tab concurrency. Synthetic regression tests cover admission boundaries,
ownership, recovery exports, zero-write rejection and preview invalidation.
