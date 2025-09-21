# User Journeys

This document enumerates the end-to-end user journeys that jobbot3000 needs to support. Each
journey captures the primary goal, key actors, happy path, and notable unhappy paths so we can
translate them into backlog items, prompts, and acceptance tests.

## Journey 1: Import and Normalize a Resume

**Goal:** A candidate imports an existing resume and turns it into the canonical profile used across
jobbot3000.

1. The user selects a local resume file (PDF, Markdown, MDX, or plain text) or points to an existing
   `resume.json`. When they start from scratch, `jobbot init` scaffolds
   `data/profile/resume.json` with empty JSON Resume sections ready for editing.
2. The CLI or UI calls the resume loader to extract clean text and metadata.
3. Parsed content is normalized into the JSON Resume schema and saved under `data/profile/`, a
   git-ignored directory so personal data never leaves the machine.
4. The system surfaces parsing confidence scores, highlights ambiguities (dates, titles, metrics),
   and prompts the user to confirm or edit the imported fields before they become the source of
   truth.

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
   `jobbot intake record`, and the model synthesizes updated bullet point options tagged by skill or
   competency.
4. All interactions are stored locally with timestamps and provenance metadata for later review.

**Unhappy paths:** the user can skip or postpone questions. Skips are marked so the assistant can
revisit them later without blocking the workflow.

## Journey 3: Source and Stage Job Postings

**Goal:** Build a living shortlist of job opportunities pulled from the web or supplied manually.

1. The user searches company boards via supported fetchers (Greenhouse, Lever, SmartRecruiters,
   Ashby, Workable) or pastes individual URLs into the CLI/UI. For example,
   `jobbot ingest greenhouse --company acme` pulls the latest public postings into the local
   data directory, and `jobbot ingest lever --company acme` performs the same for Lever-hosted
   listings.
2. The fetch pipeline de-duplicates listings, normalizes HTML to text, and stores raw + parsed
   copies under `data/jobs/{job_id}.json` alongside fetch metadata (timestamp, source, request
   headers). Job identifiers are hashed from the source URL or file path so repeat fetches update
   the same snapshot without leaking personally identifiable information.
3. Users can tag or discard roles with `jobbot shortlist tag` /
   `jobbot shortlist discard --tags <tag1,tag2>`.
   Discarded roles are also archived with reasons (and optional tags) in
   `data/discarded_jobs.json` so future recommendations can reference prior decisions.
4. The shortlist view exposes filters (location, level, compensation) via
   `jobbot shortlist list --location <value>` and records sync metadata with
   `jobbot shortlist sync` so future refreshes know when entries were last updated.

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
   timestamp.

**Unhappy paths:** low fit scores or missing must-haves trigger guidance
  (e.g., suggest skill prep or highlight transferable experience) and let the user decline
  tailoring for that role.

## Journey 5: Apply and Track Outcomes

**Goal:** Keep a comprehensive record of every interaction with employers.

1. When the user applies or sends outreach, they log the event (channel, date, documents shared,
   contact person) with `jobbot track log <job_id> --channel <channel> [...]`, which appends the
   metadata to `data/application_events.json` so the full history stays local.
2. Application status transitions (no response, screening, onsite, offer, rejected, withdrawn) are
   stored in `data/applications.json`, which is serialized safely to prevent data loss. The CLI
   exposes `jobbot track add <job_id> --status <status>` so users can log updates inline with other
   workflows.
3. Follow-up reminders and note-taking surfaces help the user prepare for upcoming steps while
   consolidating feedback for future tailoring.

**Unhappy paths:** conflicting updates (e.g., two devices editing simultaneously) trigger a merge
flow that preserves both sets of notes.

## Journey 6: Prepare for Interviews

**Goal:** Simulate the target interview loop and address skill gaps ahead of time.

1. Once an interview is scheduled, the assistant generates rehearsal plans by role and stage
   (behavioral, technical, system design, take-home).
2. Study packets include curated reading, flashcards, and question banks; dialog trees enable deep
   rehearsal with branching follow-ups inspired by "The Rehearsal".
3. Optional voice mode uses local STT/TTS so the user can practice speaking answers aloud.
4. Sessions capture transcripts, user reflections, and coach feedback in
   `data/interviews/{job_id}/{session_id}.json` for future review via
   `jobbot interviews record` and can be replayed with
   `jobbot interviews show`.

**Unhappy paths:** if the user misses sessions, the assistant nudges them with lighter-weight prep
suggestions to prevent burnout.

## Journey 7: Measure Outcomes and Close the Loop

**Goal:** Maintain visibility into success rates and continuously improve recommendations.

1. The analytics process reads application and interaction logs via `jobbot analytics funnel`
   to update a local Sankey-style view showing conversions (outreach ➜ screening ➜ onsite ➜ offer
   ➜ acceptance) and highlight the largest drop-off.
2. Metadata from tailoring and rehearsal sessions feeds back into the recommender so it can surface
   what worked (e.g., bullet variants correlated with interviews) while staying privacy-first.
3. Users can export anonymized aggregates with `jobbot analytics export --out <file>` for personal
   record keeping without exposing raw PII.

**Unhappy paths:** missing data (e.g., unlogged rejections) is highlighted so the user can backfill
   later.

---

These journeys should stay aligned with the project's safety principles: keep everything local by
default, refuse to fabricate accomplishments, and provide clear audit trails for every generated
artifact. They can be decomposed into smaller tasks across the CLI, future UI, prompts, and storage
layers while keeping personal data sealed inside git-ignored directories.
