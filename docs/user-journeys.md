# User Journeys

This document enumerates the end-to-end user journeys that jobbot3000 needs to support. Each
journey captures the primary goal, key actors, happy path, and notable unhappy paths so we can
translate them into backlog items, prompts, and acceptance tests.

## Journey 1: Import and Normalize a Resume

**Goal:** A candidate imports an existing resume and turns it into the canonical profile used across
jobbot3000.

1. The user selects a local resume file (PDF, Markdown, MDX, or plain text) or points to an existing
   `resume.json`. When they start from scratch, `jobbot init` (or
   `jobbot profile init`) scaffolds `data/profile/resume.json` with empty JSON
   Resume sections ready for editing. When a LinkedIn data export is available,
   `jobbot import linkedin <file>` or `jobbot profile import linkedin <file>`
   merges contact details, work history, education, and skills into the same
   profile without overwriting confirmed fields.
2. The CLI or UI calls the resume loader to extract clean text and metadata.
   Callers can request word/line counts, byte size, and the detected format via
   `loadResume(<path>, { withMetadata: true })` so downstream steps can surface
   parsing confidence or highlight missing sections.
3. Parsed content is normalized into the JSON Resume schema and saved under `data/profile/`, a
   git-ignored directory so personal data never leaves the machine.
4. The system surfaces parsing confidence scores and highlights ambiguities (dates, titles, metrics)
   with precise locations for every occurrence, flags ATS warnings for tables or embedded images,
   and prompts the user to confirm or edit the imported fields before they become the source of
   truth. Ambiguity heuristics catch month ranges without four-digit years, resumes lacking
   recognizable titles, and profiles with no numeric metrics so candidates can fill the gaps.

**Unhappy paths:** unsupported format, unreadable PDF, or missing sections trigger inline guidance
with retry options and explain how to manually fix the source file.

## Journey 2: Clarify the Candidate Profile

**Goal:** Capture the intent, context, and nuance that a static resume omits.

1. After import, the LLM reviews the normalized profile and drafts a question plan that targets
   missing or ambiguous details (career goals, relocation preferences, compensation guardrails,
   visa status, measurable outcomes, tools).
2. The user answers via chat or a structured form. The assistant keeps asking follow-ups until it
   reaches a configured confidence threshold.
3. Responses are appended to the profile as structured notes (`data/profile/intake.json`) via
   `jobbot intake record`. When a candidate postpones a prompt, `jobbot intake record --skip` marks
   it for follow-up while preserving tags/notes so the model can circle back. The assistant
   synthesizes updated bullet point options tagged by skill or competency.
   Run `jobbot intake bullets [--tag <value>] [--json]` to export those suggestions for tailoring
   sessions.
4. All interactions are stored locally with timestamps and provenance metadata for later review.

**Unhappy paths:** the user can skip or postpone questions. Skips are marked so the assistant can
revisit them later without blocking the workflow.

## Journey 3: Source and Stage Job Postings

**Goal:** Build a living shortlist of job opportunities pulled from the web or supplied manually.

1. The user searches company boards via supported fetchers (Greenhouse, Lever, SmartRecruiters,
   Ashby, Workable) or pastes individual URLs into the CLI/UI. For example,
   `jobbot ingest greenhouse --company acme` pulls the latest public postings into the local
   data directory, `jobbot ingest lever --company acme` performs the same for Lever-hosted
   listings, and `jobbot ingest url https://example.com/jobs/staff-engineer` snapshots a
   single posting on demand.
2. The fetch pipeline de-duplicates listings, normalizes HTML to text, and stores raw + parsed
   copies under `data/jobs/{job_id}.json` alongside fetch metadata (timestamp, source, request
   headers). Job identifiers are hashed from the source URL or file path so repeat fetches update
   the same snapshot without leaking personally identifiable information.
3. Users can tag or discard roles with `jobbot shortlist tag` /
   `jobbot shortlist discard --tags <tag1,tag2>`.
   Discarded roles are also archived with reasons (and optional tags) in
   `data/discarded_jobs.json` so future recommendations can reference prior decisions. Review those
   decisions with `jobbot shortlist archive <job_id>` (or `--json` to inspect the full archive) before
   revisiting a role. Archive listings surface the most recent discard first so candidates see the
   latest rationale without scanning the full history. Running `jobbot shortlist sync <job_id>` by
   itself now "touches" the entry, stamping `synced_at` with the current time before layering in any
   optional `--location`, `--level`, `--compensation`, or explicit `--synced-at` overrides.
4. The shortlist view exposes filters (location, level, compensation, tags) via
   `jobbot shortlist list --location <value>` (and repeated `--tag <value>` flags)
  and records sync metadata with `jobbot shortlist sync` so future refreshes know
  when entries were last updated. Text summaries now also show `Discard Count` and
  `Last Discard Tags` for each job when history exists so candidates can spot churn without opening the
  archive. Entries without discards omit those summary lines entirely to keep the output compact. When a
  discard omits tags entirely, the summary line renders `Last Discard Tags: (none)`
  so the absence is obvious. Add `--json` (and optionally `--out <path>`) when exporting the filtered
  shortlist to other tools. Missing timestamps surface as `(unknown time)` in both CLI and JSON archives so
  downstream scripts can rely on the same sentinel value when displaying legacy entries; see
  [`test/shortlist.test.js`](../test/shortlist.test.js) for coverage that locks the JSON sentinel in place.
5. Teams can automate recurring ingestion and matching runs with
   `jobbot schedule run --config <file> [--cycles <count>]`. Configured tasks pull
   boards on a cadence and compute fit scores against the latest resume so the
   shortlist stays fresh without manual commands.

**Unhappy paths:** fetch failures or ToS blocks surface actionable error messages and never retry
aggressively to respect rate limits.

## Journey 4: Match, Tailor, and Generate Deliverables

**Goal:** Produce truthful, role-specific collateral that maximizes the candidate's odds.

1. For a selected job, the matcher scores fit using semantic + lexical signals and explains hits,
   gaps, and blockers. CLI users can run `jobbot match --explain` to append the narrative summary to
   the Markdown report or add an `explanation` string to JSON payloads.
2. The resume renderer clones the base profile, selects the most relevant bullets, and prepares a
   tailored resume (PDF, text preview) plus optional cover letter. All outputs cite the source
   fields they originate from so the user can audit changes.
3. Users can tweak sections manually; the assistant suggests language improvements but refuses to
   fabricate experience.
4. Generated files, diffs, and build logs live in `data/deliverables/{job_id}/` and are versioned by
   timestamp. Export the latest bundle (or a specific run with `--timestamp`) via
   `jobbot deliverables bundle <job_id> --out <zip_path>` when sharing prep artifacts with mentors.

**Unhappy paths:** low fit scores or missing must-haves trigger guidance
  (e.g., suggest skill prep or highlight transferable experience) and let the user decline
  tailoring for that role.

## Journey 5: Apply and Track Outcomes

**Goal:** Keep a comprehensive record of every interaction with employers.

1. When the user applies or sends outreach, they log the event (channel, date, documents shared,
   contact person) with `jobbot track log <job_id> --channel <channel> [...]`, which appends the
   metadata to `data/application_events.json` so the full history stays local.
2. Application status transitions covering no response, screening, onsite, offer, rejected,
   withdrawn, and acceptance outcomes (accepted/acceptance/hired) are stored in
   `data/applications.json`, which is serialized safely to prevent data loss. The CLI
   exposes `jobbot track add <job_id> --status <status> [--note <note>]` so users can log updates and
   quick notes inline with other workflows. `jobbot track board` summarizes the pipeline as a
   Kanban, grouping each job by lifecycle stage (including legacy `next_round` entries) and surfacing
   notes and the next reminder inline so the candidate can scan open opportunities and time-sensitive
   follow-ups at a glance.
3. Follow-up reminders and note-taking surfaces help the user prepare for upcoming steps while
   consolidating feedback for future tailoring. Use `jobbot track log --remind-at <iso8601>` to
   capture the next follow-up timestamp with each note, review recorded outreach with
   `jobbot track history <job_id>`, and surface upcoming commitments with `jobbot track reminders`
   (add `--upcoming-only` to hide past-due entries and `--json` when piping into other tools).
   The digest prints `Past Due` and `Upcoming` sections so urgent follow-ups remain visible even
   when one bucket is empty, showing `(none)` under empty headings so users can confirm nothing is
   pending there. When filters remove every reminder (for example, `--upcoming-only` on a day with
   only past-due entries), the CLI still prints an `Upcoming` heading with `(none)` so it is clear
    nothing new is scheduled. Lifecycle board summaries surface the soonest upcoming reminder per job
    and fall back to the most recent past-due entry when no future timestamp is scheduled. When a job
    has no reminders at all, the board prints `Reminder: (none)` so idle opportunities are obvious at
    a glance, and the JSON board surfaces the same state with an explicit `"reminder": null`
    placeholder for downstream automation.

**Unhappy paths:** conflicting updates (e.g., two devices editing simultaneously) trigger a merge
flow that preserves both sets of notes.

## Journey 6: Prepare for Interviews

**Goal:** Simulate the target interview loop and address skill gaps ahead of time.

1. Once an interview is scheduled, `jobbot interviews plan --stage <stage> [--role <title>]`
   generates rehearsal plans tuned to behavioral, screen, technical, system design, or take-home
   stages so candidates can focus prep on the right prompts.
2. Study packets include curated reading, flashcards, and question banks; the CLI prints a `Dialog
   tree` section with branching follow-ups inspired by "The Rehearsal".
3. Optional voice mode uses local STT/TTS so the user can practice speaking answers aloud. Configure
   `JOBBOT_SPEECH_TRANSCRIBER` (or pass `--transcriber <command>`) and run
   `jobbot rehearse <job_id> --audio <file>` to convert recorded answers into transcripts that are
   stored alongside the session metadata. Set `JOBBOT_SPEECH_SYNTHESIZER` (or pass
   `--speaker <command>`) and call `jobbot interviews plan --stage <stage> --speak` to hear the full
   rehearsal packet—stage summary, checklist items, resources, flashcards, question prompts, and
   dialog follow-ups—before answering.
4. Sessions capture transcripts, user reflections, and coach feedback in
   `data/interviews/{job_id}/{session_id}.json` for future review via
   `jobbot interviews record`. Quick run-throughs can use
   `jobbot rehearse <job_id>`—even without additional flags—to auto-generate session identifiers,
   default the stage/mode to Behavioral/Voice, and log placeholder metadata before replaying them
   with `jobbot interviews show` once richer notes are available.
5. Recorded sessions attach heuristics that summarize brevity (word counts, sentence averages,
   words per minute when timestamps exist), filler words, and STAR coverage so coaches can steer
   follow-up drills toward habits that need the most attention. A `critique.tighten_this` list calls
   out filler spikes, missing STAR components, or overlong answers so the next rehearsal targets the
   highest-leverage edits.

**Unhappy paths:** if the user misses sessions, the assistant nudges them with lighter-weight prep
suggestions to prevent burnout.

## Journey 7: Measure Outcomes and Close the Loop

**Goal:** Maintain visibility into success rates and continuously improve recommendations.

1. The analytics process reads application and interaction logs via `jobbot analytics funnel`
   to update a local Sankey-style view showing conversions (outreach ➜ screening ➜ onsite ➜ offer
   ➜ acceptance) and highlight the largest drop-off. JSON exports expose a `funnel.sankey`
   structure so visualization layers can consume nodes and links directly.
2. Metadata from tailoring and rehearsal sessions feeds back into the recommender so it can surface
   what worked (e.g., bullet variants correlated with interviews) while staying privacy-first. The
   analytics export reports aggregate deliverable runs and interview session counts in an
   `activity` block so planners can gauge momentum without exposing specific job identifiers, and
   `jobbot match` echoes that context in its `prior_activity` summary so reviewers see the latest
   tailoring/interview work alongside fit scores. When interview payloads only capture a
   `started_at` timestamp (or when JSON omits timing entirely), the summary falls back to that value
   or the session file's modification time so the chronology stays visible and notes the timestamp
   provenance with `recorded_at_source`. Legacy deliverable directories that store files
   directly under a job folder count as a single run so older tailoring work remains part of the
   signal.
3. Users can export anonymized aggregates with `jobbot analytics export --out <file>` for personal
   record keeping without exposing raw PII.

**Unhappy paths:** missing data (e.g., unlogged rejections) is highlighted so the user can backfill
   later; the CLI prints a `Missing data: …` line listing jobs without statuses, while exports surface
   counts only.

---

These journeys should stay aligned with the project's safety principles: keep everything local by
default, refuse to fabricate accomplishments, and provide clear audit trails for every generated
artifact. They can be decomposed into smaller tasks across the CLI, future UI, prompts, and storage
layers while keeping personal data sealed inside git-ignored directories.
