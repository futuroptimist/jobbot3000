/* global document, indexedDB, confirm */
/* eslint-disable max-len */
import {
  COMPACT_CSV_COLUMNS,
  detectSpreadsheetImportFormat,
  exportCompactCsv,
  exportJsonBackup,
  exportNdjsonBackup,
  importJsonBackup,
  importNdjsonBackup,
  previewCompactCsvImport,
  previewSupplementalLifecycleCsvImport,
} from "../import-export/spreadsheet.js";
import { readSpreadsheetMetadata, selectDashboardMetrics } from "./metrics.js";

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
const STORES = [
  "applications",
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
  "settings",
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
function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath);
}
function runMigrationV1(db) {
  const getStore = (name) =>
    db.objectStoreNames.contains(name)
      ? null
      : db.createObjectStore(name, { keyPath: "id" });
  const applications = getStore("applications");
  if (applications) {
    ensureIndex(applications, "by_company", "company");
    ensureIndex(applications, "by_status", "status");
    ensureIndex(applications, "by_appliedAt", "appliedAt");
    ensureIndex(applications, "by_followUpDate", "followUpDate");
  }
  for (const n of STORES.filter(
    (name) => !["applications", "settings"].includes(name),
  )) {
    const store = getStore(n);
    if (!store) continue;
    ensureIndex(store, "by_applicationId", "applicationId");
    if (n === "lifecycleEvents")
      ensureIndex(store, "by_applicationId_occurredAt", [
        "applicationId",
        "occurredAt",
      ]);
  }
  getStore("settings");
}
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("jobbot3000", 1);
    r.onupgradeneeded = () => runMigrationV1(r.result);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store), t);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}
async function batchPut(recordsByStore) {
  const db = await openDb();
  const storeNames = Object.entries(recordsByStore)
    .filter(([, rows]) => rows.length)
    .map(([storeName]) => storeName);
  if (!storeNames.length) {
    db.close();
    return;
  }
  try {
    await new Promise((res, rej) => {
      const t = db.transaction(storeNames, "readwrite");
      for (const [storeName, rows] of Object.entries(recordsByStore)) {
        if (!rows.length) continue;
        const store = t.objectStore(storeName);
        for (const row of rows) store.put(row);
      }
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}
const req = (r) =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const repo = {
  list: (s) => tx(s, "readonly", (st) => req(st.getAll())),
  put: (s, o) => tx(s, "readwrite", (st) => st.put(o)),
  add: (s, o) => tx(s, "readwrite", (st) => st.add(o)),
  clear: async () => {
    const db = await openDb();
    try {
      await new Promise((res, rej) => {
        const t = db.transaction(STORES, "readwrite");
        for (const s of STORES) t.objectStore(s).clear();
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
      });
    } finally {
      db.close();
    }
  },
  exportAll: async () =>
    Object.assign(
      { schemaVersion: 1, exportedAt: now() },
      Object.fromEntries(
        await Promise.all(
          STORES.map(async (s) => [
            s,
            s === "settings" ? (await repo.list(s))[0] : await repo.list(s),
          ]),
        ),
      ),
    ),
};
const state = {
  apps: [],
  bundle: null,
  preview: null,
  previewConflicts: [],
  sort: "appliedAt",
  dir: -1,
  current: null,
  detailSave: Promise.resolve(),
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
  [
    record.eventType,
    record.stageLabel,
    record.status,
    record.note,
    record.details,
  ]
    .map(normalize)
    .some(
      (value) => value.includes("assessment") || value.includes("take_home"),
    );
const RECRUITER_SCREEN_EVENT_TYPES = new Set([
  "recruiter_screen_scheduled",
  "recruiter_screen_completed",
]);
const isRecruiterScreen = (record = {}) =>
  normalize(record.stage) === "recruiter_screen" ||
  normalize(record.status) === "recruiter_screen" ||
  RECRUITER_SCREEN_EVENT_TYPES.has(normalize(record.eventType));
const recruiterScreenKey = (record = {}) =>
  [
    record.applicationId,
    record.dueAt ?? record.startsAt ?? record.occurredAt ?? record.id,
  ]
    .filter(Boolean)
    .join(":");
const uniqueRecruiterScreens = (meta, events = meta.lifecycle) => {
  const screens = [];
  const seen = new Set();
  for (const item of [
    ...events.filter(isRecruiterScreen).map((event) => ({
      key: recruiterScreenKey(event),
      date: day(event.occurredAt) || day(event.dueAt),
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
const RESPONSE_EVENT_TYPES = new Set([
  "hiring_manager_reply",
  "written_assessment_requested",
  "recruiter_screen_scheduled",
  "recruiter_screen_completed",
  "offer",
  "offer_received",
]);
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
async function refresh() {
  state.bundle = await repo.exportAll();
  state.apps = state.bundle.applications.sort((a, b) =>
    String(b.appliedAt || "").localeCompare(a.appliedAt || ""),
  );
  renderAll();
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
    (b) => (b.onclick = () => route(b.dataset.route)),
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
        .filter((item) => !isRecruiterScreen(item))
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
function sortedLifecycleEvents(appId) {
  return [...state.bundle.lifecycleEvents]
    .filter((e) => e.applicationId === appId)
    .sort((a, b) => {
      const occurred = (a.occurredAt || "").localeCompare(b.occurredAt || "");
      const due = (a.dueAt || "").localeCompare(b.dueAt || "");
      return occurred || due || String(a.id).localeCompare(String(b.id));
    });
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
      : "event";
  const label =
    kind === "assessment"
      ? "Assessment/take-home"
      : kind === "recruiter"
        ? "Recruiter screen"
        : "Lifecycle event";
  return `<li class="timeline-item timeline-${kind}"><div><strong>${esc(label)}</strong> <span class="chip">${esc(e.status || e.eventType || "event")}</span></div><time>${esc(day(e.occurredAt) || day(e.dueAt) || "No date")}</time><div class="timeline-meta">${eventDetails(e)}</div></li>`;
}
function metadataSection(app) {
  const entries = metadataEntries(app);
  if (!entries.length)
    return '<p class="muted">No compact CSV metadata for this application yet.</p>';
  return `<dl class="metadata-list">${entries.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${label.includes("URL") ? safeArtifactLink(value) : esc(value)}</dd></div>`).join("")}</dl>`;
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
  return `<div class="tracker-detail"><article class="card"><h2>${esc(app.company || "New application")} — ${esc(app.role || "Unsaved")}</h2><form class="tracker-form" data-core-form>${input("company", app.company, true)}${input("role", app.role, true)}${input("postingUrl", app.postingUrl, "url")}<label>Status<select name="status" required>${STATUSES.map((s) => `<option ${app.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${input("source", app.source, "text")}${input("appliedAt", day(app.appliedAt), "date", true)}${input("followUpDate", day(app.followUpDate), "date")}<label>Notes<textarea name="notes">${esc(app.notes)}</textarea></label><button class="button">Save application</button></form></article><article class="card"><h3>Compact CSV metadata</h3>${metadataSection(app)}</article><article class="card wide-card"><h3>Lifecycle timeline</h3><p class="muted">Events are sorted by occurred date, then due date, then stable ID. All data stays local in this browser.</p><ul class="timeline">${events.map(timelineItem).join("") || '<li class="muted">No lifecycle events for this application yet.</li>'}</ul></article><article class="card"><h3>Assessments/take-homes</h3>${assessments.length ? `<ul>${assessments.map((item) => `<li>${esc(item.date)} ${esc(item.label)}</li>`).join("")}</ul>` : '<p class="muted">No written assessments or take-homes yet.</p>'}</article><article class="card"><h3>Recruiter screens</h3>${recruiterScreens.length ? `<ul>${recruiterScreens.map((item) => `<li>${esc(item.date)} ${esc(item.label)}</li>`).join("")}</ul>` : '<p class="muted">No recruiter screens yet.</p>'}</article><article class="card"><h3>Interviews</h3><form class="tracker-form" data-interview-form><label>Stage<select name="stage"><option>recruiter_screen</option><option>technical_screen</option><option>onsite_loop</option><option>other</option></select></label>${input("startsAt", day(now()), "date")}<button class="button">Log interview</button></form><ul>${otherInterviews.map((i) => `<li>${day(i.startsAt)} ${esc(i.stage)} ${esc(i.outcome)}</li>`).join("") || '<li class="muted">No non-recruiter interviews yet.</li>'}</ul></article><article class="card"><h3>Links/artifacts</h3><form class="tracker-form" data-artifact-form>${input("name", "", true)}${input("url", "")}<button class="button">Add link/artifact</button></form><ul>${m.artifacts.map((a) => `<li>${linkForArtifact(a)}</li>`).join("")}</ul></article><article class="card"><h3>Outreach messages</h3><form class="tracker-form" data-outreach-form><label>Channel<select name="channel"><option>email</option><option>linkedin</option><option>phone</option><option>sms</option><option>other</option></select></label><label>Message<textarea name="body" required></textarea></label><button class="button">Add outreach</button></form><ul>${m.outreach.map((o) => `<li>${day(o.sentAt)} ${esc(o.channel)} ${esc(o.body)}</li>`).join("")}</ul></article><article class="card"><h3>Offers</h3><form class="tracker-form" data-offer-form><label>Status<select name="status"><option>received</option><option>negotiating</option><option>accepted</option><option>declined</option></select></label>${input("notes", "")}<button class="button">Log offer</button></form><ul>${m.offers.map((o) => `<li>${esc(o.status)} ${esc(o.notes || "")}</li>`).join("")}</ul></article></div>`;
}
function input(n, v = "", type = "text", required = false) {
  const req = type === true || required ? "required" : "";
  type = type === true ? "text" : type;
  return `<label>${n}<input name="${n}" type="${type}" value="${esc(v)}" ${req}></label>`;
}
function values(form) {
  return Object.fromEntries(new FormData(form).entries());
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
  $("[data-core-form]").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const v = values(form);
    setFormDisabled(form, true);
    state.detailSave = state.detailSave
      .catch(() => {})
      .then(async () => {
        const current = latestApp();
        const saved = {
          ...current,
          ...v,
          appliedAt: isoDate(v.appliedAt),
          followUpDate: isoDate(v.followUpDate),
          updatedAt: now(),
        };
        delete saved.unsaved;
        await repo.put("applications", saved);
        if (!persisted || v.status !== current.status)
          await repo.add("lifecycleEvents", {
            id: id("event"),
            applicationId: app.id,
            status: v.status,
            occurredAt: now(),
            source: "manual",
            createdAt: now(),
          });
        await refresh();
        openDetail(app.id);
      });
    try {
      await state.detailSave;
    } catch (error) {
      setFormDisabled(form, false);
      throw error;
    }
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
    const v = values(e.target);
    const current = latestApp();
    await repo.add("outreachMessages", {
      id: id("msg"),
      applicationId: app.id,
      direction: "outbound",
      channel: v.channel,
      body: v.body,
      sentAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    const nextStatus =
      STATUS_RANK[current.status] >= STATUS_RANK.outreach_sent
        ? current.status
        : "outreach_sent";
    await repo.put("applications", {
      ...current,
      status: nextStatus,
      updatedAt: now(),
    });
    await refresh();
    openDetail(app.id);
  };
  $("[data-interview-form]").onsubmit = async (e) => {
    e.preventDefault();
    const v = values(e.target);
    const current = latestApp();
    await repo.add("interviews", {
      id: id("interview"),
      applicationId: app.id,
      contactIds: [],
      stage: v.stage,
      startsAt: isoDate(v.startsAt),
      outcome: "scheduled",
      createdAt: now(),
      updatedAt: now(),
    });
    const nextStatus =
      v.stage !== "other" && STATUS_RANK[v.stage] > STATUS_RANK[current.status]
        ? v.stage
        : current.status;
    await repo.put("applications", {
      ...current,
      status: nextStatus,
      updatedAt: now(),
    });
    await refresh();
    openDetail(app.id);
  };
  $("[data-offer-form]").onsubmit = async (e) => {
    e.preventDefault();
    const v = values(e.target);
    const current = latestApp();
    await repo.add("offers", {
      id: id("offer"),
      applicationId: app.id,
      status: v.status,
      notes: v.notes || undefined,
      createdAt: now(),
      updatedAt: now(),
    });
    await repo.put("applications", {
      ...current,
      status: v.status === "accepted" ? "accepted" : "offer",
      updatedAt: now(),
    });
    await refresh();
    openDetail(app.id);
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
  const compactSummary = `Dry-run OK: ${recordsByStore.applications?.length ?? 0} applications, ${recordsByStore.outreachMessages?.length ?? 0} outreach messages, ${(recordsByStore.interviews ?? []).filter((item) => !isRecruiterScreen(item)).length} interviews`;
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
    await batchPut(state.preview);
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
  refresh();
}
init();
