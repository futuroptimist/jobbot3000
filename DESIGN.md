# jobbot3000 — Self-hosted Job Search Copilot

**Status:** Draft v0.1 (2025-08-20)
**Owner:** futuroptimist
**License:** MIT

---

## 1) Vision

A privacy-first, open-source, self-hosted assistant that helps an individual candidate:

- build a rich skills profile,
- ingest and match public job posts,
- tailor ATS-friendly resumes/cover letters per listing,
- rehearse interviews (behavioral + technical),
- track applications end-to-end.

**Non-goals**

- Automating deceit (fake credentials, misrepresentation).
- Slurping data from platforms that prohibit automation/scraping.
- Acting as a “ghost applicant” that applies without human sign-off.

**Principles**

- **Local by default.** Everything runs on your box/cluster.
- **Portable data.** Candidate profile stored in open schemas (JSON Resume).
- **Pluggable models.** Works with local open models or external APIs.
- **Transparent pipelines.** Every generated output is traceable to inputs.

---

## 2) User stories (MVP ➜ v1.0)

1. **Profile Builder**  
   I can import my history (projects, roles, skills, metrics) and export to `resume.json` (JSON Resume).
2. **Job Ingestion**
   I can connect public ATS feeds (Greenhouse, Lever, Ashby, Workable, SmartRecruiters) and
   pull listings for target companies or keywords.
3. **Matching & Shortlisting**
   The system computes a relevance score per job with an explanation (skills hit/miss, seniority, location, visa, salary if present).
4. **Resume/Cover Letter Tailoring**  
   For any job, it renders a one-page ATS-friendly resume PDF + an optional cover letter, both editable, using my profile as the single source of truth.
5. **Interview Rehearsal**  
   It generates realistic question sets, lets me rehearse with voice (STT/TTS), and scores my responses with STAR hints.
6. **Tracker**  
   A Kanban of opportunities → applied → interview → offer, with checklists, notes, and due reminders.

Stretch (v1.x): portfolio site generator, role heatmap, referral finder (manual inputs only), CLI-only “headless” mode.
Compensation tracker shipped via the CLI's `jobbot analytics compensation` summary.

---

## 3) System architecture (self-hosted)

```text
[Web UI (Next.js) + CLI] [Task Orchestrator]
\ / ┌────────────┐
\ REST/gRPC (FastAPI) │ LangGraph │
_______________________________│ /Celery │
└─────┬─────┘
      │
┌───────────────────┬───────────────────────────┴─────────────────────┐
│ Core Services     │ Models Runtime           │ Data/Storage         │
│-------------------│---------------------------│---------------------│
│ Profile Service   │ vLLM server (OpenAI API) │ Postgres + pgvector  │
│ Jobs Ingestors    │ OR Ollama (local models) │ Chroma/FAISS (opt)   │
│ Matcher/Scorer    │ Embeddings via HF        │ MinIO/S3 (artifacts) │
│ Resume Renderer   │                           │ Redis (queues/cache) │
│ Interview Coach   │ Whisper (STT), TTS        │ Files: outputs/logs  │
└───────────────────┴───────────────────────────┴─────────────────────┘
```

Integrations: Greenhouse/Lever/Ashby/Workable/SmartRecruiters job board APIs, O\*NET/ESCO skills taxonomies.

**Deployment**

- **Dev:** Docker Compose (Postgres, pgvector, Redis, FastAPI, Web).
- **Prod:** Helm charts on k3s (node selectors for GPU if present).
- **Secrets:** `.env` for local; Kubernetes Secrets for prod.
- **Telemetry:** OpenTelemetry → local Grafana/Loki (optional/off by default).

---

## 4) Data model (core tables)

- `candidate_profile` (1 row): JSON Resume blob + derived normalized tables (`experiences`, `projects`, `skills`).
- `job_postings` (many): normalized fields, full text, embeddings, source metadata.
- `matches` (many): job_id, score (0–100), explanation JSON (`skills_hit`, `skills_gap`, `must_haves_missed`, `keyword_overlap`, `notes`).
- `resume_versions` (many): template_id, job_id, compiled PDF path + build logs.
- `qa_bundles` (many): interview type, questions, suggested STAR outlines, audio transcripts.
- `applications` (many): job_id, status, due dates, contacts, notes, files.

---

## 5) Integrations (public & compliant)

**Preferred (official/public endpoints)**

- **Greenhouse Job Board API** – lists offices, departments, and jobs, plus application submission.
- **Lever Postings API** – `GET /postings/{org}?mode=json`.
- **Ashby Jobs API** – public job board JSON per tenant.
- **Workable API** – jobs list & details (requires tenant token).
- **SmartRecruiters Posting API** – public job postings snapshot.

**Explicit non-goals**

- Do **not** automate LinkedIn profile scraping or login-gated sites. Respect robots.txt and site ToS.

**Pluggable fetchers**  
Each ATS = a module returning a normalized `JobPosting`. Backoff flows through `fetchWithRetry`, and
the Greenhouse fetcher now persists `ETag`/`If-Modified-Since` validators so repeat syncs issue
conditional requests instead of re-downloading unchanged boards. Per-tenant rate limits throttle
board fetches via configurable intervals so individual tenants stay within API policies.

---

## 6) Matching & ranking (transparent)

**Inputs**: Job text (title, teams, responsibilities, requirements) + Candidate profile (skills, bullets).

**Signals**

1. **Semantic similarity** (embeddings cosine) between job text chunks and profile skills/bullets.
2. **Keyword coverage** for “must-have” lists, with synonym expansion via O\*NET/ESCO.
3. **Hard filters**: location/remote, seniority hints, clearance/visa if present.
4. **BM25** on normalized skill tokens (fast lexical baseline).
5. **Optional calibration**: lightweight logistic regression on features above → 0–100 score.

**Outputs**

- Score (0–100), plus **explanation** array:
- `must_haves_missed`: `["Kubernetes", "Terraform"]`
- `skills_hit`: `["SRE", "Postgres", "on-call"]` with confidence bars
- `evidence`: snippets with sources (job text spans).

_Implemented (2025-11-20):_ `computeFitScore` now accepts an optional
`{ calibration: … }` parameter that runs a lightweight logistic regression over
coverage, blocker, and overlap signals before returning the final 0–100 score.
[`matchResumeToJob`](src/modules/enrichment/match.js) surfaces the calibration
metadata alongside the score so downstream exports can explain adjustments, and
`test/scoring.test.js` covers both the default logistic tuning and custom
weight overrides.

---

## 7) Resume & cover letter engine

**Source of truth:** `resume.json` (JSON Resume).

**Templating choices (pick one or support both):**

- **LaTeX** (`moderncv` / `awesome-cv`-style) compiled with **Tectonic** (zero-dep LaTeX).
- **Typst** (fast modern typesetting) using `modern-cv`/`basic-resume` templates.

**Pipeline**

1. Convert JSON Resume → template context.
2. Apply job-specific tailoring: select strongest bullets, swap keywords (never fabricate), cap to 1 page.
3. Compile → PDF; generate plain text preview for ATS check.
4. Emit build log + a diff view vs. base resume.

**ATS-friendly defaults**

- Single column, standard fonts, no text in images, consistent dates, simple bullets.
- Export `.docx` via the built-in generator (Pandoc remains optional for alternate templates).

---

## 8) Interview rehearsal

- **Question generation**: role/level-aware packs (behavioral, system design, coding if desired).
- **Coaching**: STAR scaffolding, timers, filler-word counters, and “tighten this” critique.
- **Voice loop (optional)**: local **Whisper** for STT; local TTS for prompts.
- **Artifacts**: transcript, STAR notes, follow-ups, and suggested improvements.

---

## 9) Safety, privacy, and ethics

- **Data never leaves** your machine unless you configure an external model/API.
- **Offline inference**: local models via vLLM or Ollama; encrypted proxy for remote APIs.
- **Secret storage**: credentials sourced from environment variables or OS keychains.
- **No cheating**: guardrails to block credential inflation, fake employers, or impersonation.
- **Compliance**: per-integration respect for robots.txt and ToS; vendor allowlists.
- **Model sandboxing**: prompt-injection defenses on job text; tool-use allowlist; rate limiting.
- **PII**: encrypted at rest (Postgres TDE or filesystem), redaction in logs, opt-in analytics only.

---

## 10) Tech stack

- **Backend**: Python 3.11+, FastAPI, Pydantic, SQLAlchemy.
- **Orchestration**: LangGraph (deterministic state machines) or Celery for background jobs.
- **Vector**: pgvector (preferred) or Chroma; FAISS for fast local indexes.
- **Embeddings**: BGE-Large / e5-Large (HF) running locally or lightweight API.
- **LLM runtime**:
  - **vLLM** (OpenAI-compatible server) _or_ **Ollama** (local models: Llama 3.1 8B, Mistral 7B, Qwen2 7B, Phi-3 Mini).
- **Front-end**: Next.js (T3-stack vibe), Tailwind, shadcn/ui.
- **Speech**: faster-whisper, Coqui-TTS (optional).
- **Packaging**: Docker, docker-compose; Helm for k3s.

---

## 11) Configuration (example: `docker-compose.yml` sketch)

```yaml
version: "3.9"
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: changeme
    volumes: [db:/var/lib/postgresql/data]
  redis:
    image: redis:7
  minio:
    image: minio/minio
    command: server /data
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: changeme
  api:
    build: ./services/api
    env_file: .env
    depends_on: [db, redis]
  web:
    build: ./apps/web
    env_file: .env
    depends_on: [api]
  vllm:
    image: vllm/vllm-openai:latest
    command: ["--model", "meta-llama/Llama-3.1-8B-Instruct"]
    deploy:
      resources:
        reservations:
          devices: [{ capabilities: ["gpu"] }]
volumes: { db: {} }
```

Kubernetes: provide Helm values for enabling GPU node and persistence (out of scope here).

---

## 12) CLI surface (first pass)

```
jobbot init             # create profile repo + JSON Resume skeleton
jobbot import linkedin  # manual export JSON (no scraping), merge into profile
jobbot ingest greenhouse --company foo
jobbot ingest lever --org bar
jobbot match --role "Senior SRE" --location "SF Bay Area"
jobbot tailor <job_id>  # writes match.md/match.json, resume.json/resume.txt, and cover_letter.md under data/deliverables/<job_id>/<timestamp>
jobbot rehearse <job_id> --behavioral --voice
jobbot track add <job_id> --status applied --note "emailed hiring manager"
```

---

## 13) Testing & evaluation

- **Unit**: parsers, normalizers, scorers, renderers.
- **Golden datasets**: small curated set of job posts ↔ expected matches and STAR outlines.
- **RAG eval** (for explanations): Ragas or custom assertion checks.
- **Security**: OWASP LLM Top-10 style prompt-injection suite; rate-limit fuzzer.
- **ATS checks**: text extract from produced PDF and verify keyword presence + structure.

---

## 14) Roadmap & checklists

**Phase 0 — Bootstrap (2–3 days)**

- Repo scaffold (monorepo or polyrepo).
- Helper scripts for repetitive tasks (e.g., job-description summarizer).
  _Implemented (2025-11-30):_ [`scripts/summarize-jobs.js`](scripts/summarize-jobs.js)
  now reads job snapshots from `$JOBBOT_DATA_DIR/jobs` (or `data/jobs`) and
  emits concise summaries. Run `npm run summarize:jobs -- --json` to collect
  multi-sentence descriptions when auditing new leads or preparing outreach
  notes. The regression coverage in
  [`test/scripts-summarize-jobs.test.js`](test/scripts-summarize-jobs.test.js)
  drives JSON output, targeted job filtering, and error handling when a
  snapshot is missing so future refactors keep the helper reliable.
- Compose stack: Postgres+pgvector, Redis, FastAPI, Web.
- JSON Resume schema ingestion/export.
  _Implemented (2025-12-05):_ `jobbot profile export` writes the canonical profile resume
  to a chosen path (and optionally stdout) so external tools can consume JSON Resume without
  mutating the workspace. Regression coverage in [`test/cli.test.js`](test/cli.test.js)
  exercises both the file export and `--json` streaming output.
- Minimal UI (profile editor, file upload).

**Phase 1 — Job ingestion (1 week)**

- Greenhouse Job Board fetcher + normalizer. (shipped)
- Lever Postings fetcher + normalizer. (shipped)
- Ashby Jobs fetcher + normalizer. (shipped)
- Caching, retries (shipped), per-domain politeness.
- UI: source connections, search & filters.

**Phase 2 — Matching (1 week)**

- Embeddings service (local HF) + pgvector store.
- Keyword/BM25 baseline + cosine combo scoring.
  _Implemented (2025-11-30):_ `computeFitScore` now returns a `scoreBreakdown`
  that surfaces BM25 totals and cosine similarity metrics alongside the existing
  coverage score. Regression coverage in
  [`test/scoring.test.js`](test/scoring.test.js) exercises the breakdown shape
  and asserts that matching resumes produce non-zero BM25 and cosine signals.
- O\*NET/ESCO synonym expansion. (shipped)
- Explanations UI (hits/gaps/evidence).
- CLI: `jobbot match --explain` (shipped).

**Phase 3 — Tailoring & rendering (1 week)**

- Templating (choose Typst or LaTeX first; Tectonic/Typst CLI).
- One-page constraint, dynamic bullet swapping.
  _Implemented (2025-01-15):_ Resume previews now clamp to a single-page text snapshot (60 lines)
  and append a truncation marker when longer histories appear. Regression coverage in
  [`test/resume-preview.test.js`](test/resume-preview.test.js) keeps the one-page contract intact
  so bundles and PDF generation stay concise by default.
- ATS plain text preview + warnings (tables/images detection). (shipped)
- Cover letter template + slot-fill with job-specific context. (shipped)

**Phase 4 — Interview rehearsal (1 week)**

- Behavioral question packs, STAR scaffolding.
- Whisper STT loop (optional), transcript store.
- Feedback heuristics (brevity, structure, filler words).
- Save Q&A bundles under each job.

**Phase 5 — Tracker & polish (1 week)**

- Kanban, reminders, notes, attachments.
- Export bundles per job (zip: resume, letter, notes).
- Settings: model selection (Ollama/vLLM), privacy toggles.
  _Implemented (2025-10-24):_ `jobbot settings configure` now persists inference
  provider preferences (Ollama or vLLM) alongside privacy defaults. Analytics
  exports respect the privacy redaction toggle without additional flags, and
  interview sessions drop stored transcripts when retention is disabled.
  Regression coverage in [`test/cli.test.js`](test/cli.test.js) exercises the
  settings CLI, while [`test/interviews.test.js`](test/interviews.test.js)
  verifies transcript suppression when privacy mode is active.
- Docs, quickstart, sample data.

**Stretch / nice-to-have**

- `.docx` export (shipped via CLI using the docx library; Pandoc remains optional for other flows).
- System-design rehearsal outlines.
  _Implemented (2025-11-28):_ `jobbot interviews outline` now generates Markdown and JSON
  outlines for the system design stage, pacing kickoff through wrap-up segments. Regression
  coverage in [`test/cli.test.js`](test/cli.test.js) and
  [`test/interviews.test.js`](test/interviews.test.js) locks the CLI output and structured
  outline contract.
- Scheduler for periodic ingestion/matching.
- Basic analytics, all local.

---

## 15) Open questions & risks

- Model choice tradeoff: speed vs. quality for tailoring and feedback on consumer GPUs/CPU.
- ATS variability: PDFs are often accepted, but .docx may parse more consistently in some stacks—CLI
  docx export now covers both; keep monitoring ATS feedback.
- Legality/ToS: keep a hard line against gray-area scraping; prefer official/public endpoints.
- Prompt-injection: job posts can contain adversarial fluff—sanitize and constrain tool use.

---

## 16) References (see repo /docs for links)

- JSON Resume schema; Greenhouse/Lever/Ashby/Workable/SmartRecruiters job board APIs.
- O\*NET & ESCO skills taxonomies for synonym expansion.
- vLLM & Ollama for local model serving (OpenAI-compatible).
- Embeddings: BGE / e5; pgvector/Chroma/FAISS for vector search.
- Tectonic (LaTeX) & Typst for rendering.
- STAR interview method guidance (HBR/Stanford/MIT).
- OWASP LLM Top-10, NIST AI RMF for safety posture.
- robots.txt/RFC 9309 and LinkedIn ToS for compliance.

---

### Key sources (hand-picked)

Job/ATS integrations: Greenhouse Job Board/Harvest API, Lever Postings API, Ashby Jobs REST, Workable, SmartRecruiters Posting API.  
Resume & ATS guidance: JSON Resume schema; MIT’s ATS tips; SHRM resources (general resume guidance); LaTeX `moderncv`; Tectonic; Typst + resume templates.  
Models & local serving: vLLM OpenAI-compatible server; Ollama API docs; Llama 3.1 / Mistral / Qwen2 / Phi-3 model cards.  
Embeddings & vector stores: BGE / e5 embeddings; pgvector; Chroma; FAISS.  
Interview rehearsal (STAR): HBR guide; Stanford BEAM; MIT CAPD; Harvard Law sample questions.  
Skills taxonomies: O\*NET; ESCO.  
Compliance & scraping ethics: LinkedIn ToS (no scraping); robots.txt / RFC 9309.  
Security & safety: OWASP Top-10 for LLM apps; NIST AI RMF 1.0.
