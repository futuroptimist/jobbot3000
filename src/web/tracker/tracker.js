/* global document, confirm, window */
/* eslint-disable max-len */
import {
  COMPACT_CSV_COLUMNS,
  detectSpreadsheetImportFormat,
  exportCompactCsv,
  exportJsonBackup,
  exportLifecycleCsv,
  exportNdjsonBackup,
  importJsonBackup,
  importNdjsonBackup,
  previewCompactCsvImport,
  previewSupplementalLifecycleCsvImport,
} from "../import-export/spreadsheet.js";
import {
  classifyLifecycleEventType,
  isLifecycleAssessment,
  isLifecycleNonRecruiterInterview,
  isLifecycleRecruiterScreen,
} from "./lifecycleClassification.js";
import {
  readSpreadsheetMetadata,
  recruiterScreenKey,
  recruiterScreenTimestamp,
  selectDashboardMetrics,
} from "./metrics.js";
import { createIndexedDbRepository } from "../storage/indexedDbRepository.js";
import { planLifecycleReconciliation } from "./lifecycleReconciliation.js";

/* canonical CSV/backup helpers are shared with spreadsheet import/export tests. */
const ARRAY_STORES = [
  "applications",
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
];
const ORIGINS = [
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
];
const STATUSES = [
  "applied",
  "outreach_sent",
  "recruiter_screen",
  "technical_screen",
  "onsite_loop",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
];
const OUTCOMES = new Set([
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const now = () => new Date().toISOString();
const day = (v) => (v ? String(v).slice(0, 10) : "");
const STATUS_RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const id = (p = "id") =>
  `${p}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
let indexedDbRepositoryPromise;
let initializationRetryTimer;
let initializationRetryDelayMs = 1000;
let initializationRetryListenersRegistered = false;
const getRepository = () => {
  indexedDbRepositoryPromise ??= createIndexedDbRepository().catch((error) => {
    indexedDbRepositoryPromise = undefined;
    throw error;
  });
  return indexedDbRepositoryPromise;
};
const repositoryMethod = (storeName, mode) => {
  const methods = {
    applications: { put: "upsertApplication" },
    lifecycleEvents: { add: "createLifecycleEvent" },
    artifacts: { add: "createArtifact" },
    outreachMessages: { add: "createOutreachMessage" },
    interviews: { add: "createInterview" },
    offers: { add: "createOffer" },
  };
  return methods[storeName]?.[mode];
};
const repo = {
  list: async (storeName) => (await getRepository()).listRecords(storeName),
  put: async (storeName, record) => {
    const method = repositoryMethod(storeName, "put");
    if (!method) throw new Error(`Unsupported repository put: ${storeName}`);
    return (await getRepository())[method](record);
  },
  add: async (storeName, record) => {
    const method = repositoryMethod(storeName, "add");
    if (!method) throw new Error(`Unsupported repository add: ${storeName}`);
    return (await getRepository())[method](record);
  },
  clear: async () => (await getRepository()).clearAllData(),
  exportAll: async () => (await getRepository()).exportAllData(),
  commitLifecycleMutation: async (mutation) =>
    (await getRepository()).commitLifecycleMutation(mutation),
};
async function batchImport(recordsByStore) {
  return (await getRepository()).importPartialData(recordsByStore);
}
const state = {
  apps: [],
  bundle: null,
  preview: null,
  previewConflicts: [],
  sort: "appliedAt",
  dir: -1,
  current: null,
  detailSave: Promise.resolve(),
  reconciliationWarnings: [],
};
function weekBucket(value) {
  const d = day(value);
  if (!d) return "";
  const date = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 1);
  return date.toISOString().slice(0, 10);
}
function safeHref(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, document.baseURI);
    if (["http:", "https:"].includes(url.protocol)) return raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  } catch {
    if (/^(?:[./#?]|[^:]*$)/.test(raw)) return raw;
  }
  return "";
}
function linkForArtifact(artifact) {
  const href = safeHref(artifact.url);
  return href
    ? `<a href="${esc(href)}" rel="noopener noreferrer">${esc(artifact.name)}</a>`
    : esc(artifact.name);
}
function safeArtifactLink(value, label = value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let href = "";
  try {
    const url = new URL(raw);
    if (["http:", "https:"].includes(url.protocol)) href = url.toString();
  } catch {
    href = "";
  }
  return href
    ? `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${esc(label)}</a>`
    : esc(raw);
}
function fitScore(notes) {
  return String(notes || "").match(/fit_score_100[":\s]+([\d.]+)/)?.[1] || "";
}
const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const isAssessmentEvent = (record = {}) =>
  isLifecycleAssessment(record.eventType) ||
  [record.stageLabel, record.status, record.note, record.details]
    .map(normalize)
    .some(
      (value) => value.includes("assessment") || value.includes("take_home"),
    );
const isRecruiterScreen = (record = {}) =>
  normalize(record.stage) === "recruiter_screen" ||
  normalize(record.status) === "recruiter_screen" ||
  isLifecycleRecruiterScreen(record.eventType);
const isNonRecruiterInterview = (record = {}) =>
  (record.stage && normalize(record.stage) !== "recruiter_screen") ||
  isLifecycleNonRecruiterInterview(record.eventType);
export const uniqueRecruiterScreens = (meta, events = meta.lifecycle) => {
  const screens = [];
  const seen = new Set();
  const explicitRecruiterScreenKeys = new Set(
    meta.interviews
      .filter(isRecruiterScreen)
      .map((interview) => recruiterScreenKey(interview)),
  );
  for (const item of [
    ...events.filter(isRecruiterScreen).map((event) => ({
      key: recruiterScreenKey(event, explicitRecruiterScreenKeys),
      date: day(recruiterScreenTimestamp(event, explicitRecruiterScreenKeys)),
      label:
        event.stageLabel ||
        event.eventType ||
        event.details ||
        "recruiter screen",
    })),
    ...meta.interviews.filter(isRecruiterScreen).map((interview) => ({
      key: recruiterScreenKey(interview),
      date: day(interview.startsAt),
      label: interview.outcome || interview.stage || "recruiter screen",
    })),
  ]) {
    const key = item.key || `${item.date}:${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    screens.push(item);
  }
  return screens;
};
const hasMetadataAssessmentSignal = (metadata = {}) =>
  [metadata.spreadsheet_interview_stage, metadata.spreadsheet_outcome].some(
    (value) =>
      normalize(value).includes("assessment") ||
      normalize(value).includes("take_home"),
  );
const TERMINAL_EMPLOYER_STATUSES = new Set([
  "offer",
  "accepted",
  "rejected",
  "closed_archived",
]);
const COMPACT_OUTREACH_REPLY_STATUSES = new Set([
  "replied",
  "reply",
  "responded",
]);
const RESPONSE_EVENT_TYPES = new Set(["offer", "offer_received"]);
const hasMetadataResponseSignal = (metadata = {}) =>
  COMPACT_OUTREACH_REPLY_STATUSES.has(normalize(metadata.outreach_status)) ||
  hasMetadataAssessmentSignal(metadata);
const hasListResponseSignal = (app, meta, metadata = {}) =>
  TERMINAL_EMPLOYER_STATUSES.has(app.status) ||
  meta.interviews.length > 0 ||
  meta.outreach.some(
    (x) =>
      normalize(x.direction) === "inbound" ||
      COMPACT_OUTREACH_REPLY_STATUSES.has(normalize(x.status)),
  ) ||
  meta.lifecycle.some(
    (x) =>
      classifyLifecycleEventType(x.eventType).countsAsResponse ||
      RESPONSE_EVENT_TYPES.has(normalize(x.eventType)) ||
      TERMINAL_EMPLOYER_STATUSES.has(normalize(x.status)),
  ) ||
  hasMetadataResponseSignal(metadata);
function metadataEntries(app) {
  const metadata = readSpreadsheetMetadata(app.notes);
  return Object.entries({
    "Raw status": metadata.spreadsheet_status,
    "Raw stage": metadata.spreadsheet_interview_stage,
    "Raw outcome": metadata.spreadsheet_outcome,
    "Outreach status": metadata.outreach_status,
    "Outreach channel": metadata.outreach_channel,
    "Follow-up date": day(app.followUpDate),
    "Application URL": metadata.application_url,
    "Posting ID": metadata.posting_id,
    "Work model": metadata.work_model,
    "Compensation min": metadata.compensation_min_usd,
    "Compensation max": metadata.compensation_max_usd,
    "Cover letter submitted": metadata.cover_letter_submitted,
    "Fit score": metadata.fit_score_100,
    "Schema version": metadata.schema_version,
  }).filter(([, value]) => value !== undefined && value !== "");
}
const metadataText = (app) =>
  metadataEntries(app)
    .map(([label, value]) => `${label}: ${value}`)
    .join(" · ");
let reconciliationRunning = false;
async function reconcileLifecycle() {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  try {
    const bundle = await repo.exportAll();
    const result = planLifecycleReconciliation(bundle);
    state.reconciliationWarnings = result.warnings;
    for (const plan of result.plans.filter((item) => item.additions.length)) {
      await repo.commitLifecycleMutation({
        records: { lifecycleEvents: plan.additions },
      });
    }
  } finally {
    reconciliationRunning = false;
  }
}
async function refresh() {
  await reconcileLifecycle();
  state.bundle = await repo.exportAll();
  state.apps = state.bundle.applications.sort((a, b) =>
    String(b.appliedAt || "").localeCompare(a.appliedAt || ""),
  );
  renderAll();
}
function showInitializationError(error) {
  const target = $("[data-import-result]") || $("main") || document.body;
  target.textContent = `Tracker storage is temporarily unavailable: ${error?.message ?? error}`;
}
function clearInitializationRetry(retry, retryWhenVisible) {
  if (initializationRetryTimer) {
    window.clearTimeout(initializationRetryTimer);
    initializationRetryTimer = undefined;
  }
  initializationRetryDelayMs = 1000;
  if (initializationRetryListenersRegistered) {
    window.removeEventListener("focus", retry);
    document.removeEventListener("visibilitychange", retryWhenVisible);
    initializationRetryListenersRegistered = false;
  }
}
async function refreshWithRetry() {
  const retryWhenVisible = () => {
    if (!document.hidden) retry();
  };
  const scheduleRetry = () => {
    if (initializationRetryTimer) return;
    initializationRetryTimer = window.setTimeout(() => {
      initializationRetryTimer = undefined;
      retry();
    }, initializationRetryDelayMs);
    initializationRetryDelayMs = Math.min(initializationRetryDelayMs * 2, 5000);
  };
  const retry = async () => {
    try {
      await refresh();
      clearInitializationRetry(retry, retryWhenVisible);
    } catch (retryError) {
      showInitializationError(retryError);
      scheduleRetry();
    }
  };
  try {
    await refresh();
    clearInitializationRetry(retry, retryWhenVisible);
  } catch (error) {
    showInitializationError(error);
    if (!initializationRetryListenersRegistered) {
      window.addEventListener("focus", retry);
      document.addEventListener("visibilitychange", retryWhenVisible);
      initializationRetryListenersRegistered = true;
    }
    scheduleRetry();
  }
}
function route(v) {
  $$(".tracker-view").forEach((x) => (x.hidden = x.dataset.view !== v));
  $$(".tracker-nav button").forEach((b) =>
    b.setAttribute("aria-current", b.dataset.route === v ? "page" : "false"),
  );
  if (v === "applications") $('[data-filter="query"]').focus();
}
function renderNav() {
  const names = [
    ["Dashboard", "dashboard"],
    ["Applications", "applications"],
    ["Follow-ups", "follow-ups"],
    ["Contacts/Outreach", "contacts"],
    ["Import/Export", "import-export"],
    ["Settings", "settings"],
  ];
  $(".tracker-nav").innerHTML = names
    .map(
      ([label, routeName]) =>
        `<button type="button" data-route="${routeName}">${label}</button>`,
    )
    .join("");
  $$(".tracker-nav button").forEach(
    (b) =>
      (b.onclick = async () => {
        await state.detailSave.catch(() => {});
        route(b.dataset.route);
      }),
  );
  route("dashboard");
}
function renderDashboard() {
  const b = state.bundle;
  const metrics = selectDashboardMetrics(b);
  const cards = [
    [
      "Total applications",
      metrics.totalApplications,
      "Applications being tracked",
      "volume",
    ],
    [
      "Outreach sent",
      metrics.outreachSent,
      "Outbound outreach messages",
      "outreach",
    ],
    [
      "Outreach replies",
      metrics.outreachReplies,
      `${metrics.outreachReplies} of ${metrics.outreachSent} outreach messages`,
      "outreach",
    ],
    [
      "Recruiter screens",
      metrics.recruiterScreens,
      "Recruiter-screen events, separate from interviews",
      "screen",
    ],
    [
      "Interviews",
      metrics.interviews,
      "Technical, onsite, or other non-recruiter interviews",
      "interview",
    ],
    [
      "Assessments",
      metrics.assessments,
      "Written assessments and take-homes, not interviews",
      "assessment",
    ],
    ["Offers", metrics.offers, "Offer records or offer outcomes", "offer"],
    [
      "Application responses",
      metrics.applicationsWithResponse,
      `${metrics.applicationsWithResponse} of ${metrics.totalApplications} applications`,
      "response",
    ],
    [
      "Application response rate",
      `${metrics.applicationResponseRate}%`,
      `${metrics.applicationsWithResponse} of ${metrics.totalApplications} applications`,
      "response",
    ],
    [
      "Outreach reply rate",
      `${metrics.outreachReplyRate}%`,
      `${metrics.outreachReplies} of ${metrics.outreachSent} outreach messages`,
      "outreach",
    ],
  ];
  $("[data-metrics]").innerHTML = cards
    .map(
      ([label, value, help, kind]) =>
        `<div class="metric metric-${esc(kind)}" aria-label="${esc(label)}: ${esc(value)} (${esc(help)})"><span>${esc(label)}</span><strong>${esc(value)}</strong><small class="muted">${esc(help || "No records yet")}</small></div>`,
    )
    .join("");
  const weeks = {};
  for (const a of b.applications) {
    const bucket = weekBucket(a.appliedAt);
    if (bucket) weeks[bucket] = (weeks[bucket] || 0) + 1;
  }
  $("[data-weekly-counts]").textContent =
    Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}: ${v}`)
      .join(" • ") || "No application data yet.";
}
function appMeta(app) {
  const b = state.bundle;
  return {
    outreach: b.outreachMessages.filter((x) => x.applicationId === app.id),
    lifecycle: b.lifecycleEvents.filter((x) => x.applicationId === app.id),
    interviews: b.interviews.filter((x) => x.applicationId === app.id),
    offers: b.offers.filter((x) => x.applicationId === app.id),
    artifacts: b.artifacts.filter((x) => x.applicationId === app.id),
  };
}
function outcomeForApp(app, meta = appMeta(app)) {
  if (OUTCOMES.has(app.status)) return app.status;
  return meta.offers.at(-1)?.status || "";
}
function renderList() {
  const q = $('[data-filter="query"]').value.toLowerCase(),
    st = $('[data-filter="status"]').value,
    out = $('[data-filter="outcome"]').value,
    response = $('[data-filter="response"]').value,
    outreach = $('[data-filter="outreach"]').value,
    followUp = $('[data-filter="follow-up"]').value,
    activity = $('[data-filter="activity"]').value;
  const today = day(now());
  const hasActiveFilters = Boolean(
    q || st || out || response || outreach || followUp || activity,
  );
  let rows = state.apps.filter((a) => {
    const m = appMeta(a);
    const metadata = readSpreadsheetMetadata(a.notes);
    const hasResponse = hasListResponseSignal(a, m, metadata);
    const outreachState =
      m.outreach.length || metadata.outreach_status ? "sent" : "none";
    const dueState =
      a.followUpDate && day(a.followUpDate) <= today
        ? "due"
        : a.followUpDate
          ? "scheduled"
          : "none";
    const hasAssessment =
      m.lifecycle.some(isAssessmentEvent) ||
      hasMetadataAssessmentSignal(metadata);
    const hasRecruiter = uniqueRecruiterScreens(m).length > 0;
    const terminal =
      OUTCOMES.has(a.status) || OUTCOMES.has(outcomeForApp(a, m));
    return (
      (!q ||
        [a.company, a.role, a.status, a.notes, metadataText(a)].some((x) =>
          String(x || "")
            .toLowerCase()
            .includes(q),
        )) &&
      (!st || a.status === st) &&
      (!out || outcomeForApp(a, m) === out) &&
      (!response || (response === "responded" ? hasResponse : !hasResponse)) &&
      (!outreach || outreachState === outreach) &&
      (!followUp || dueState === followUp) &&
      (!activity ||
        (activity === "assessment" && hasAssessment) ||
        (activity === "recruiter_screen" && hasRecruiter) ||
        (activity === "terminal" && terminal))
    );
  });
  rows.sort(
    (a, b) =>
      String(a[state.sort] || "").localeCompare(String(b[state.sort] || "")) *
      state.dir,
  );
  const emptyState = $("[data-empty-state]");
  emptyState.textContent = hasActiveFilters
    ? "No applications match the current filters."
    : "No applications yet. Create one or import a CSV backup.";
  emptyState.hidden = rows.length > 0;
  $("[data-applications-table]").hidden = rows.length === 0;
  $("[data-applications-table] tbody").innerHTML = rows
    .map((a) => {
      const m = appMeta(a);
      const metadata = metadataText(a);
      const latestInterview = m.interviews
        .filter(isNonRecruiterInterview)
        .at(-1);
      const recruiterCount = uniqueRecruiterScreens(m).length;
      const rowMetadata = readSpreadsheetMetadata(a.notes);
      const assessmentCount =
        m.lifecycle.filter(isAssessmentEvent).length +
        (hasMetadataAssessmentSignal(rowMetadata) ? 1 : 0);
      return `<tr><td><button class="button" data-open="${esc(a.id)}">${esc(a.company)}</button>${metadata ? `<small class="muted table-note">${esc(metadata)}</small>` : ""}</td><td>${esc(a.role)}</td><td><span class="chip">${esc(a.status)}</span></td><td>${day(a.appliedAt)}</td><td>${day(a.followUpDate) || "—"}</td><td>${esc(rowMetadata.outreach_status || (m.outreach.length ? "sent" : "none"))}</td><td>${recruiterCount ? `<span class="chip">Recruiter screen ×${recruiterCount}</span>` : ""}${latestInterview ? `<span class="chip">Interview: ${esc(latestInterview.stage)}</span>` : ""}${assessmentCount ? `<span class="chip chip-warning">Assessment ×${assessmentCount}</span>` : ""}</td><td>${esc(outcomeForApp(a, m) || "—")}</td><td>${esc(fitScore(a.notes) || rowMetadata.fit_score_100 || "")}</td><td class="clip-cell">${m.artifacts.map(linkForArtifact).join(", ")}</td></tr>`;
    })
    .join("");
  $$("[data-open]").forEach(
    (b) => (b.onclick = () => openDetail(b.dataset.open)),
  );
}
function renderFollowups() {
  const today = day(now());
  const secs = { Overdue: [], "Due today": [], Upcoming: [] };
  for (const a of state.apps.filter((x) => x.followUpDate)) {
    if (day(a.followUpDate) < today) secs.Overdue.push(a);
    else if (day(a.followUpDate) === today) secs["Due today"].push(a);
    else secs.Upcoming.push(a);
  }
  $("[data-followups]").innerHTML = Object.entries(secs)
    .map(
      ([k, apps]) =>
        `<article class="card"><h3>${k}</h3>${apps.length ? apps.map((a) => `<p><strong>${esc(a.company)}</strong> — ${esc(a.role)} (${day(a.followUpDate)}) <button class="button" data-done="${esc(a.id)}">Mark done</button> <button class="button" data-snooze="${esc(a.id)}">Snooze</button></p>`).join("") : '<p class="muted">None</p>'}</article>`,
    )
    .join("");
  $$("[data-done]").forEach(
    (b) =>
      (b.onclick = async () => {
        const a = state.apps.find((x) => x.id === b.dataset.done);
        delete a.followUpDate;
        a.updatedAt = now();
        await repo.put("applications", a);
        refresh();
      }),
  );
  $$("[data-snooze]").forEach(
    (b) =>
      (b.onclick = async () => {
        const a = state.apps.find((x) => x.id === b.dataset.snooze);
        a.followUpDate = new Date(Date.now() + 7 * 864e5).toISOString();
        a.updatedAt = now();
        await repo.put("applications", a);
        refresh();
      }),
  );
}
function renderOutreach() {
  $("[data-outreach-list]").innerHTML =
    state.bundle.outreachMessages
      .map((m) => {
        const a = state.apps.find((x) => x.id === m.applicationId) || {};
        return `<article class="card"><h3>${esc(a.company || "Unknown")}</h3><p>${esc(m.channel)} ${day(m.sentAt || m.receivedAt)}</p><p>${esc(m.body || m.subject || "")}</p></article>`;
      })
      .join("") || '<p class="muted">No outreach messages yet.</p>';
}
function renderAll() {
  renderDashboard();
  renderList();
  renderFollowups();
  renderOutreach();
}
function sortedLifecycleEvents(appId, options = {}) {
  return [...state.bundle.lifecycleEvents]
    .filter(
      (e) =>
        e.applicationId === appId &&
        (options.includeInferred ||
          !(e.source === "reconciliation" && e.inferred)),
    )
    .sort((a, b) => {
      const occurred = (a.occurredAt || "").localeCompare(b.occurredAt || "");
      const due = (a.dueAt || "").localeCompare(b.dueAt || "");
      return occurred || due || String(a.id).localeCompare(String(b.id));
    });
}

function effectiveLifecycleEvents(events = []) {
  const superseded = new Set(
    events.map((event) => event.supersedesEventId).filter(Boolean),
  );
  return events.filter((event) => !superseded.has(event.id));
}
function latestEffectiveOriginEvent(appId) {
  return effectiveLifecycleEvents(
    sortedLifecycleEvents(appId, { includeInferred: true }),
  )
    .filter((event) => ORIGINS.includes(event.eventType))
    .sort(
      (a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .at(-1);
}
function eventDetails(e) {
  return Object.entries({
    Type: e.eventType,
    Stage: e.stageLabel,
    Channel: e.channel,
    Actor: e.actor,
    "Source artifact": e.sourceArtifact
      ? safeArtifactLink(e.sourceArtifact)
      : "",
    "Requires action":
      e.requiresUserAction === undefined
        ? ""
        : e.requiresUserAction
          ? "yes"
          : "no",
    "Action status": e.actionStatus,
    "Due date": day(e.dueAt),
    "No AI required":
      e.noAiRequired === undefined ? "" : e.noAiRequired ? "yes" : "no",
    Details: e.details || e.note,
  })
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([label, value]) =>
        `<span><strong>${esc(label)}:</strong> ${label === "Source artifact" ? value : esc(value)}</span>`,
    )
    .join("");
}
function timelineItem(e) {
  const kind = isAssessmentEvent(e)
    ? "assessment"
    : isRecruiterScreen(e)
      ? "recruiter"
      : isLifecycleNonRecruiterInterview(e.eventType)
        ? "interview"
        : "event";
  const label =
    kind === "assessment"
      ? "Assessment/take-home"
      : kind === "recruiter"
        ? "Recruiter screen"
        : kind === "interview"
          ? "Interview"
          : "Lifecycle event";
  return `<li class="timeline-item timeline-${kind}"><div><strong>${esc(label)}</strong> <span class="chip">${esc(e.status || e.eventType || "event")}</span></div><time>${esc(day(e.occurredAt) || day(e.dueAt) || "No date")}</time><div class="timeline-meta">${eventDetails(e)}</div></li>`;
}
function metadataSection(app) {
  const entries = metadataEntries(app);
  if (!entries.length)
    return '<p class="muted">No compact CSV metadata for this application yet.</p>';
  return `<dl class="metadata-list">${entries.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${label.includes("URL") ? safeArtifactLink(value) : esc(value)}</dd></div>`).join("")}</dl>`;
}
function statusEventType(previousStatus, nextStatus) {
  const terminal = new Set([
    "accepted",
    "rejected",
    "withdrawn",
    "closed_archived",
  ]);
  if (terminal.has(previousStatus) && !terminal.has(nextStatus))
    return "application_reopened";
  return (
    {
      outreach_sent: "candidate_outreach",
      recruiter_screen: "recruiter_screen",
      technical_screen: "technical_interview",
      onsite_loop: "onsite_final_loop",
      offer: "offer_received",
      accepted: "offer_accepted",
      rejected: "employer_rejected",
      withdrawn: "candidate_withdrew",
      closed_archived: "closed_archived",
      applied: "status_changed",
    }[nextStatus] ?? "status_changed"
  );
}
function detailForm(app) {
  const m = appMeta(app);
  const events = sortedLifecycleEvents(app.id);
  const metadata = readSpreadsheetMetadata(app.notes);
  const recruiterScreens = uniqueRecruiterScreens(m, events);
  const otherInterviews = m.interviews.filter(
    (item) => !isRecruiterScreen(item),
  );
  const assessments = events.filter(isAssessmentEvent).map((event) => ({
    date: day(event.occurredAt) || day(event.dueAt),
    label: event.stageLabel || event.eventType || event.details || "assessment",
  }));
  if (hasMetadataAssessmentSignal(metadata)) {
    assessments.push({
      date: day(app.appliedAt),
      label:
        metadata.spreadsheet_interview_stage ||
        metadata.spreadsheet_outcome ||
        "Compact CSV assessment signal",
    });
  }
  return `<div class="tracker-detail"><article class="card"><h2>${esc(app.company || "New application")} — ${esc(app.role || "Unsaved")}</h2><form class="tracker-form" data-core-form>${input("company", app.company, true)}${input("role", app.role, true)}${input("postingUrl", app.postingUrl, "url")}<label>Origin<select name="origin" required>${ORIGINS.map((origin) => `<option value="${origin}" ${app.origin === origin ? "selected" : ""}>${origin}</option>`).join("")}</select></label><label>Status<select name="status" required>${STATUSES.map((s) => `<option ${app.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${input("source", app.source, "text")}${input("appliedAt", day(app.appliedAt), "date", app.origin === "application_submitted", "Application date (if applicable).")}${input("followUpDate", day(app.followUpDate), "date")}<label>Notes<textarea name="notes">${esc(app.notes)}</textarea></label><button class="button">Save application</button></form></article><article class="card"><h3>Compact CSV metadata</h3>${metadataSection(app)}</article><article class="card wide-card"><h3>Lifecycle timeline</h3><p class="muted">Events are sorted by occurred date, then due date, then stable ID. All data stays local in this browser.</p><ul class="timeline">${events.map(timelineItem).join("") || '<li class="muted">No lifecycle events for this application yet.</li>'}</ul></article><article class="card"><h3>Assessments/take-homes</h3><form class="tracker-form" data-assessment-form><label>Action status<select name="actionStatus"><option>requested</option><option>pending</option><option>started</option><option>in_progress</option><option>submitted</option><option>completed</option></select></label>${input("dueAt", "", "date")}<label>Details<textarea name="details"></textarea></label><button class="button">Log assessment</button></form>${assessments.length ? `<ul>${assessments.map((item) => `<li>${esc(item.date)} ${esc(item.label)}</li>`).join("")}</ul>` : '<p class="muted">No written assessments or take-homes yet.</p>'}</article><article class="card"><h3>Recruiter screens</h3>${recruiterScreens.length ? `<ul>${recruiterScreens.map((item) => `<li>${esc(item.date)} ${esc(item.label)}</li>`).join("")}</ul>` : '<p class="muted">No recruiter screens yet.</p>'}</article><article class="card"><h3>Interviews</h3><form class="tracker-form" data-interview-form><label>Stage<select name="stage"><option>recruiter_screen</option><option>technical_screen</option><option>onsite_loop</option><option>other</option></select></label>${input("startsAt", day(now()), "date")}<label>Outcome<select name="outcome"><option>scheduled</option><option>completed</option><option>cancelled</option><option>no_show</option></select></label><button class="button">Log interview</button></form><ul>${otherInterviews.map((i) => `<li>${day(i.startsAt)} ${esc(i.stage)} ${esc(i.outcome)}</li>`).join("") || '<li class="muted">No non-recruiter interviews yet.</li>'}</ul></article><article class="card"><h3>Links/artifacts</h3><form class="tracker-form" data-artifact-form>${input("name", "", true)}${input("url", "")}<button class="button">Add link/artifact</button></form><ul>${m.artifacts.map((a) => `<li>${linkForArtifact(a)}</li>`).join("")}</ul></article><article class="card"><h3>Outreach messages</h3><form class="tracker-form" data-outreach-form><label>Direction<select name="direction"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label><label>Channel<select name="channel"><option>email</option><option>linkedin</option><option>phone</option><option>sms</option><option>other</option></select></label><label>Message<textarea name="body" required></textarea></label><button class="button">Add outreach</button></form><ul>${m.outreach.map((o) => `<li>${esc(o.direction)} ${day(o.sentAt || o.receivedAt)} ${esc(o.channel)} ${esc(o.body)}</li>`).join("")}</ul></article><article class="card"><h3>Offers</h3><form class="tracker-form" data-offer-form><label>Status<select name="status"><option>received</option><option>negotiating</option><option>accepted</option><option>declined</option><option>expired</option><option>rescinded</option></select></label>${input("notes", "")}<button class="button">Log offer</button></form><ul>${m.offers.map((o) => `<li>${esc(o.status)} ${esc(o.notes || "")}</li>`).join("")}</ul></article></div>`;
}
function input(n, v = "", type = "text", required = false, label = n) {
  const req = type === true || required ? "required" : "";
  type = type === true ? "text" : type;
  return `<label>${esc(label)}<input name="${n}" type="${type}" value="${esc(v)}" ${req}></label>`;
}
function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function optionalBlankToUndefined(value) {
  return value === "" ? undefined : value;
}
function setFormDisabled(form, disabled) {
  $$("button, input, select, textarea", form).forEach((control) => {
    control.disabled = disabled;
  });
}
function openDetail(appId) {
  state.current = appId;
  const app = state.apps.find((a) => a.id === appId);
  $("[data-detail]").innerHTML = detailForm(app);
  route("detail");
  bindDetail(app);
}
function openUnsavedDetail(app) {
  state.current = app.id;
  $("[data-detail]").innerHTML = detailForm(app);
  route("detail");
  bindDetail(app);
}
function isoDate(v) {
  return v ? new Date(v).toISOString() : undefined;
}
function bindDetail(app) {
  const persisted = !app.unsaved;
  const latestApp = () => state.apps.find((a) => a.id === app.id) || app;
  const submitWithRecovery = async (form, operation) => {
    const original = new FormData(form);
    let errorBox = form.querySelector("[data-form-error]");
    if (!errorBox) {
      errorBox = document.createElement("p");
      errorBox.dataset.formError = "";
      errorBox.className = "muted error";
      errorBox.setAttribute("role", "alert");
      form.prepend(errorBox);
    }
    errorBox.textContent = "";
    setFormDisabled(form, true);
    try {
      state.detailSave = Promise.resolve().then(() =>
        operation(Object.fromEntries(original.entries())),
      );
      await state.detailSave;
    } catch (error) {
      for (const [name, value] of original.entries()) {
        const control = form.elements.namedItem(name);
        if (control) control.value = value;
      }
      errorBox.textContent = `Save failed. No changes were written. ${error?.message ?? error}`;
      setFormDisabled(form, false);
      return false;
    }
    return true;
  };
  const coreForm = $("[data-core-form]");
  const syncApplicationDateRequirement = () => {
    const date = coreForm.elements.namedItem("appliedAt");
    if (date)
      date.required =
        coreForm.elements.namedItem("origin")?.value ===
        "application_submitted";
  };
  coreForm.elements
    .namedItem("origin")
    ?.addEventListener("change", syncApplicationDateRequirement);
  syncApplicationDateRequirement();
  $("[data-core-form]").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    await submitWithRecovery(form, async (v) => {
      const current = latestApp();
      const operationTime = now();
      if (v.origin === "application_submitted" && !v.appliedAt) {
        throw new Error(
          "Application date is required for submitted applications.",
        );
      }
      const saved = {
        ...current,
        ...v,
        source: optionalBlankToUndefined(v.source),
        postingUrl: optionalBlankToUndefined(v.postingUrl),
        notes: optionalBlankToUndefined(v.notes),
        origin: v.origin,
        appliedAt: isoDate(v.appliedAt),
        followUpDate: isoDate(v.followUpDate),
        updatedAt: operationTime,
      };
      delete saved.unsaved;
      const events = [];
      if (!persisted) {
        events.push({
          id: id("event"),
          applicationId: app.id,
          eventType: v.origin,
          status: v.status,
          occurredAt:
            v.origin === "application_submitted" ? v.appliedAt : operationTime,
          occurredAtPrecision:
            v.origin === "application_submitted" ? "date" : "instant",
          inferred: false,
          source: "manual",
          createdAt: operationTime,
        });
      } else if (v.origin !== current.origin) {
        const priorOrigin = latestEffectiveOriginEvent(app.id);
        events.push({
          id: id("event"),
          applicationId: app.id,
          eventType: v.origin,
          status: current.status,
          occurredAt:
            v.origin === "application_submitted" ? v.appliedAt : operationTime,
          occurredAtPrecision:
            v.origin === "application_submitted" ? "date" : "instant",
          inferred: false,
          source: "manual",
          supersedesEventId: priorOrigin?.id,
          createdAt: operationTime,
        });
      }
      if (persisted && v.status !== current.status) {
        events.push({
          id: id("event"),
          applicationId: app.id,
          eventType: statusEventType(current.status, v.status),
          status: v.status,
          occurredAt: operationTime,
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: operationTime,
        });
      }
      await repo.commitLifecycleMutation({
        application: saved,
        records: { lifecycleEvents: events },
      });
      await refresh();
      openDetail(app.id);
    });
  };
  $("[data-artifact-form]").onsubmit = async (e) => {
    e.preventDefault();
    const v = values(e.target);
    await repo.add("artifacts", {
      id: id("artifact"),
      applicationId: app.id,
      kind: "link",
      name: v.name,
      url: v.url || undefined,
      private: true,
      createdAt: now(),
      updatedAt: now(),
    });
    await refresh();
    openDetail(app.id);
  };
  $("[data-outreach-form]").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    await submitWithRecovery(form, async (v) => {
      const current = latestApp();
      const operationTime = now();
      const nextStatus =
        v.direction === "outbound" &&
        STATUS_RANK[current.status] < STATUS_RANK.outreach_sent
          ? "outreach_sent"
          : current.status;
      const message = {
        id: id("msg"),
        applicationId: app.id,
        direction: v.direction,
        channel: v.channel,
        body: v.body,
        sentAt: v.direction === "outbound" ? operationTime : undefined,
        receivedAt: v.direction === "inbound" ? operationTime : undefined,
        createdAt: operationTime,
        updatedAt: operationTime,
      };
      await repo.commitLifecycleMutation({
        application: {
          ...current,
          status: nextStatus,
          updatedAt: operationTime,
        },
        records: {
          outreachMessages: [message],
          lifecycleEvents: [
            {
              id: id("event"),
              applicationId: app.id,
              eventType:
                v.direction === "inbound"
                  ? "employer_response_received"
                  : "candidate_outreach",
              status: nextStatus,
              occurredAt: operationTime,
              occurredAtPrecision: "instant",
              inferred: false,
              source: "manual",
              channel: v.channel,
              sourceArtifact: message.id,
              actionStatus: v.direction,
              createdAt: operationTime,
            },
          ],
        },
      });
      await refresh();
      openDetail(app.id);
    });
  };
  $("[data-assessment-form]").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    await submitWithRecovery(form, async (v) => {
      const operationTime = now();
      await repo.commitLifecycleMutation({
        records: {
          lifecycleEvents: [
            {
              id: id("event"),
              applicationId: app.id,
              eventType: "assessment_take_home",
              status: latestApp().status,
              occurredAt: operationTime,
              occurredAtPrecision: "instant",
              inferred: false,
              source: "manual",
              actionStatus: v.actionStatus,
              dueAt: isoDate(v.dueAt),
              details: optionalBlankToUndefined(v.details),
              createdAt: operationTime,
            },
          ],
        },
      });
      await refresh();
      openDetail(app.id);
    });
  };
  $("[data-interview-form]").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    await submitWithRecovery(form, async (v) => {
      const current = latestApp();
      const operationTime = now();
      const interview = {
        id: id("interview"),
        applicationId: app.id,
        contactIds: [],
        stage: v.stage,
        startsAt: isoDate(v.startsAt),
        outcome: v.outcome,
        createdAt: operationTime,
        updatedAt: operationTime,
      };
      const recognized = {
        recruiter_screen: "recruiter_screen",
        technical_screen: "technical_interview",
        onsite_loop: "onsite_final_loop",
      }[v.stage];
      const nextStatus =
        recognized &&
        !["cancelled", "no_show"].includes(v.outcome) &&
        STATUS_RANK[v.stage] > STATUS_RANK[current.status]
          ? v.stage
          : current.status;
      await repo.commitLifecycleMutation({
        application: {
          ...current,
          status: nextStatus,
          updatedAt: operationTime,
        },
        records: {
          interviews: [interview],
          lifecycleEvents: [
            {
              id: id("event"),
              applicationId: app.id,
              eventType:
                recognized && !["cancelled", "no_show"].includes(v.outcome)
                  ? recognized
                  : "status_changed",
              status: nextStatus,
              occurredAt: operationTime,
              occurredAtPrecision: "instant",
              inferred: false,
              source: "manual",
              stageLabel: v.stage,
              actionStatus: v.outcome,
              dueAt: interview.startsAt,
              sourceArtifact: interview.id,
              createdAt: operationTime,
            },
          ],
        },
      });
      await refresh();
      openDetail(app.id);
    });
  };
  $("[data-offer-form]").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    await submitWithRecovery(form, async (v) => {
      const current = latestApp();
      const operationTime = now();
      const offer = {
        id: id("offer"),
        applicationId: app.id,
        status: v.status,
        notes: v.notes || undefined,
        createdAt: operationTime,
        updatedAt: operationTime,
      };
      const eventType = {
        received: "offer_received",
        negotiating: "offer_negotiating",
        accepted: "offer_accepted",
        declined: "offer_declined",
        expired: "offer_expired_rescinded",
        rescinded: "offer_expired_rescinded",
      }[v.status];
      await repo.commitLifecycleMutation({
        application: {
          ...current,
          status: v.status === "accepted" ? "accepted" : "offer",
          updatedAt: operationTime,
        },
        records: {
          offers: [offer],
          lifecycleEvents: [
            {
              id: id("event"),
              applicationId: app.id,
              eventType,
              status: v.status === "accepted" ? "accepted" : "offer",
              occurredAt: operationTime,
              occurredAtPrecision: "instant",
              inferred: false,
              source: "manual",
              sourceArtifact: offer.id,
              actionStatus: v.status,
              createdAt: operationTime,
            },
          ],
        },
      });
      await refresh();
      openDetail(app.id);
    });
  };
}
async function newApplication() {
  const ts = now();
  const app = {
    id: id("app"),
    company: "",
    role: "",
    status: "applied",
    source: "",
    postingUrl: "",
    appliedAt: day(ts),
    createdAt: ts,
    updatedAt: ts,
    origin: "application_submitted",
    unsaved: true,
  };
  openUnsavedDetail(app);
}
function bundleForIndexedDb(bundle) {
  return {
    ...Object.fromEntries(
      ARRAY_STORES.map((store) => [store, bundle[store] ?? []]),
    ),
    settings: bundle.settings ? [bundle.settings] : [],
  };
}
async function detectImportConflicts(recordsByStore) {
  const conflicts = [];
  await Promise.all(
    Object.entries(recordsByStore).map(async ([storeName, rows]) => {
      if (!rows.length) return;
      const existingIds = new Set(
        (await repo.list(storeName)).map((row) => row.id),
      );
      for (const row of rows) {
        if (existingIds.has(row.id)) conflicts.push({ storeName, id: row.id });
      }
    }),
  );
  return conflicts;
}
function importFormatForFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".ndjson") || name.endsWith(".jsonl")) return "ndjson";
  return "csv";
}
function detectedFormatLabel(format, text, lifecyclePreview) {
  if (lifecyclePreview) return "supplemental lifecycle CSV";
  if (format === "json") return "JSON backup";
  if (format === "ndjson") return "NDJSON backup";
  return detectSpreadsheetImportFormat(text) === "compact_csv"
    ? "compact application CSV"
    : "CSV";
}
function countByStore(recordsByStore) {
  const rows = {
    applications: recordsByStore.applications?.length ?? 0,
    contacts: recordsByStore.contacts?.length ?? 0,
    outreachMessages: recordsByStore.outreachMessages?.length ?? 0,
    lifecycleEvents: recordsByStore.lifecycleEvents?.length ?? 0,
    recruiterScreens:
      (recordsByStore.interviews ?? []).filter(isRecruiterScreen).length +
      (recordsByStore.lifecycleEvents ?? []).filter(isRecruiterScreen).length,
    interviews: (recordsByStore.interviews ?? []).filter(
      (item) => !isRecruiterScreen(item),
    ).length,
    assessments:
      (recordsByStore.lifecycleEvents ?? []).filter(isAssessmentEvent).length +
      (recordsByStore.applications ?? []).filter((application) => {
        const metadata = readSpreadsheetMetadata(application.notes);
        return hasMetadataAssessmentSignal(metadata);
      }).length,
    offers: recordsByStore.offers?.length ?? 0,
    artifacts: recordsByStore.artifacts?.length ?? 0,
    reminders: recordsByStore.reminders?.length ?? 0,
    settings: recordsByStore.settings?.length ?? 0,
  };
  return Object.entries(rows).filter(([, count]) => count > 0);
}
function formatIssue(issue) {
  const where = issue.rowNumber
    ? `Row ${issue.rowNumber}`
    : issue.storeName || issue.store || "Import";
  const field = issue.field ? ` ${issue.field}` : "";
  const details = [
    issue.code,
    issue.message || issue.reason,
    issue.value ? `value ${issue.value}` : "",
    issue.id ? `ID ${issue.id}` : "",
  ].filter(Boolean);
  return `${where}${field}: ${details.join(": ")}`;
}
function renderImportPreview({
  label,
  recordsByStore,
  conflicts = [],
  warnings = [],
  errors = [],
  blocking = false,
}) {
  const counts = countByStore(recordsByStore);
  const totalRecords = [
    "applications",
    "contacts",
    "outreachMessages",
    "lifecycleEvents",
    "interviews",
    "offers",
    "artifacts",
    "reminders",
    "settings",
  ].reduce((sum, store) => sum + (recordsByStore[store]?.length ?? 0), 0);
  const compactSummary = `Dry-run OK: ${recordsByStore.applications?.length ?? 0} applications, ${recordsByStore.outreachMessages?.length ?? 0} outreach messages, ${(recordsByStore.interviews ?? []).filter(isNonRecruiterInterview).length} interviews`;
  $("[data-import-result]").innerHTML =
    `<h4>${blocking ? "Import preview needs attention" : "Dry-run succeeded"}</h4>${blocking ? "" : `<p>${esc(compactSummary)}</p>`}<p><strong>Detected format:</strong> ${esc(label)}.</p><p>${blocking ? "Apply import is disabled until blocking errors are fixed." : "Data remains local in this browser until you choose Apply import; no tracker details are sent to a server."}</p><h5>Record counts</h5><ul>${counts.map(([store, count]) => `<li>${esc(store)}: ${count}</li>`).join("") || "<li>No records detected.</li>"}</ul><p><strong>Total records:</strong> ${totalRecords}</p><h5>Conflicts</h5><ul>${conflicts.map((conflict) => `<li>${esc(formatIssue(conflict))}</li>`).join("") || "<li>No existing record conflicts in local browser data.</li>"}</ul>${warnings.length ? `<h5>Warnings</h5><ul>${warnings.map((warning) => `<li>${esc(formatIssue(warning))}</li>`).join("")}</ul>` : ""}${errors.length ? `<h5>Blocking errors</h5><ul>${errors.map((error) => `<li>${esc(formatIssue(error))}</li>`).join("")}</ul>` : ""}`;
}
async function previewImport() {
  const file = $("[data-import-file]").files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const format = importFormatForFile(file);
    const lifecyclePreview =
      format === "csv" &&
      detectSpreadsheetImportFormat(text) === "lifecycle_csv"
        ? await previewSupplementalLifecycleCsvImport(text, {
            exportAllData: repo.exportAll,
          })
        : null;
    if (lifecyclePreview?.errors.length || lifecyclePreview?.conflicts.length) {
      renderImportPreview({
        label: "supplemental lifecycle CSV",
        recordsByStore: lifecyclePreview.bundle ?? {},
        conflicts: lifecyclePreview.conflicts ?? [],
        warnings: lifecyclePreview.warnings ?? [],
        errors: lifecyclePreview.errors ?? [],
        blocking: true,
      });
      state.preview = null;
      state.previewConflicts = [];
      $("[data-import-apply]").disabled = true;
      return;
    }
    const compactPreview =
      !lifecyclePreview && format === "csv"
        ? await previewCompactCsvImport(text, {
            exportAllData: repo.exportAll,
          })
        : null;
    if (compactPreview?.errors.length) {
      renderImportPreview({
        label: "compact application CSV",
        recordsByStore: compactPreview.bundle ?? {},
        conflicts: compactPreview.conflicts ?? [],
        warnings: compactPreview.warnings ?? [],
        errors: compactPreview.errors ?? [],
        blocking: true,
      });
      state.preview = null;
      state.previewConflicts = [];
      $("[data-import-apply]").disabled = true;
      return;
    }
    const bundle = lifecyclePreview
      ? lifecyclePreview.bundle
      : compactPreview
        ? compactPreview.bundle
        : format === "json"
          ? importJsonBackup(text)
          : importNdjsonBackup(text);
    state.preview = lifecyclePreview
      ? {
          lifecycleEvents: bundle.lifecycleEvents ?? [],
          interviews: bundle.interviews ?? [],
          reminders: bundle.reminders ?? [],
        }
      : bundleForIndexedDb(bundle);
    state.previewConflicts =
      lifecyclePreview?.conflicts ??
      compactPreview?.conflicts ??
      (await detectImportConflicts(state.preview));
    renderImportPreview({
      label: detectedFormatLabel(format, text, lifecyclePreview),
      recordsByStore: state.preview,
      conflicts: state.previewConflicts,
      warnings: lifecyclePreview?.warnings ?? compactPreview?.warnings ?? [],
    });
    $("[data-import-apply]").disabled = false;
  } catch (err) {
    state.preview = null;
    state.previewConflicts = [];
    $("[data-import-apply]").disabled = true;
    if (err?.errors) {
      renderImportPreview({
        label: "supplemental lifecycle CSV",
        recordsByStore: {},
        conflicts: err.conflicts ?? [],
        warnings: err.warnings ?? [],
        errors: err.errors,
        blocking: true,
      });
    } else {
      $("[data-import-result]").textContent =
        `Import preview failed: ${err?.message ?? err}`;
    }
  }
}
function resetImportPreview() {
  state.preview = null;
  state.previewConflicts = [];
  $("[data-import-apply]").disabled = true;
  $("[data-import-result]").innerHTML =
    "Select Preview/dry-run to validate the selected file before applying.";
}
async function applyImport() {
  if (!state.preview) {
    resetImportPreview();
    return;
  }
  if (
    state.previewConflicts.length &&
    !confirm(
      `Import will replace ${state.previewConflicts.length} existing local records with matching IDs. Continue?`,
    )
  ) {
    $("[data-import-result]").textContent = "Import canceled.";
    return;
  }
  try {
    await batchImport(state.preview);
  } catch (err) {
    $("[data-import-result]").textContent =
      `Import failed: ${err?.message ?? err}`;
    return;
  }
  $("[data-import-result]").textContent =
    "Import applied successfully. Your tracker data remains local in this browser.";
  $("[data-import-apply]").disabled = true;
  await refresh();
}
function cleanEmptyOptionalStrings(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== ""),
  );
}
function bundleForExport(bundle) {
  return {
    ...bundle,
    applications: (bundle.applications ?? []).map(cleanEmptyOptionalStrings),
    contacts: (bundle.contacts ?? []).map(cleanEmptyOptionalStrings),
    outreachMessages: (bundle.outreachMessages ?? []).map(
      cleanEmptyOptionalStrings,
    ),
    lifecycleEvents: (bundle.lifecycleEvents ?? []).map(
      cleanEmptyOptionalStrings,
    ),
    interviews: (bundle.interviews ?? []).map(cleanEmptyOptionalStrings),
    offers: (bundle.offers ?? []).map(cleanEmptyOptionalStrings),
    artifacts: (bundle.artifacts ?? []).map(cleanEmptyOptionalStrings),
    reminders: (bundle.reminders ?? []).map(cleanEmptyOptionalStrings),
    settings: bundle.settings
      ? cleanEmptyOptionalStrings(bundle.settings)
      : undefined,
  };
}

function download(name, type, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
function exportData(fmt) {
  const bundle = bundleForExport(state.bundle);
  if (fmt === "json") {
    download(
      "jobbot3000-backup.json",
      "application/json",
      exportJsonBackup(bundle),
    );
  } else if (fmt === "ndjson") {
    download(
      "jobbot3000-backup.ndjson",
      "application/x-ndjson",
      exportNdjsonBackup(bundle),
    );
  } else if (fmt === "lifecycle-csv") {
    download(
      "jobbot3000-lifecycle-events.csv",
      "text/csv",
      exportLifecycleCsv(bundle),
    );
  } else {
    if (!COMPACT_CSV_COLUMNS.length)
      throw new Error("CSV columns are unavailable");
    download(
      "jobbot3000-applications.csv",
      "text/csv",
      exportCompactCsv(bundle),
    );
  }
}

function renderBuildMetadata() {
  const target = $("[data-build-metadata]");
  if (!target) return;
  const fallback = {
    version: "unknown",
    gitSha: "unavailable",
    builtAt: "unavailable",
    mode: "static/browser-only",
  };
  let metadata = fallback;
  const source = document.getElementById("jobbot-build-metadata");
  if (source && !source.textContent.includes("__JOBBOT_BUILD_METADATA__")) {
    try {
      metadata = { ...fallback, ...JSON.parse(source.textContent) };
    } catch {
      metadata = fallback;
    }
  }
  target.textContent = `Version ${metadata.version} · ${metadata.gitSha} · ${metadata.builtAt} · ${metadata.mode}`;
}
function init() {
  renderBuildMetadata();
  renderNav();
  $('[data-filter="status"]').innerHTML += STATUSES.map(
    (s) => `<option>${s}</option>`,
  ).join("");
  $("[data-list-filters]").oninput = renderList;
  $$("[data-sort]").forEach(
    (b) =>
      (b.onclick = () => {
        state.dir = state.sort === b.dataset.sort ? -state.dir : 1;
        state.sort = b.dataset.sort;
        renderList();
      }),
  );
  $("[data-new-application]").onclick = newApplication;
  $("[data-back-to-list]").onclick = () => route("applications");
  $("[data-import-file]").oninput = resetImportPreview;
  $("[data-import-preview]").onclick = previewImport;
  $("[data-import-apply]").onclick = applyImport;
  $$("[data-export]").forEach(
    (b) => (b.onclick = () => exportData(b.dataset.export)),
  );
  $("[data-clear-data]").onclick = async () => {
    const ok = confirm(
      "Clear all local tracker data from this browser? This cannot be undone unless you have a backup.",
    );
    if (ok) {
      await repo.clear();
      const result = $("[data-settings-result]");
      if (result) result.textContent = "Local IndexedDB tracker data cleared.";
      await refresh();
    }
  };
  refreshWithRetry();
}
if (typeof document !== "undefined") init();
