/* global document, indexedDB, confirm */
/* eslint-disable max-len */
import {
  COMPACT_CSV_COLUMNS,
  csvToBrowserApplicationExport,
  detectSpreadsheetImportFormat,
  exportCompactCsv,
  exportJsonBackup,
  exportNdjsonBackup,
  importJsonBackup,
  importNdjsonBackup,
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
const TERMINAL_OUTCOMES = new Set([
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);
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

const normalizeToken = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const metadataEntries = (app) =>
  Object.entries(readSpreadsheetMetadata(app.notes)).filter(
    ([, value]) =>
      value !== undefined && value !== null && String(value) !== "",
  );
const compactMetadata = (app) => readSpreadsheetMetadata(app.notes);
const compactValue = (app, key) => String(compactMetadata(app)[key] ?? "");
const hasAssessmentSignal = (app) => {
  const meta = compactMetadata(app);
  const raw = `${meta.spreadsheet_interview_stage ?? ""} ${meta.spreadsheet_outcome ?? ""}`;
  const normalized = normalizeToken(raw);
  return (
    normalized.includes("written_assessment") ||
    normalized.includes("take_home") ||
    (state.bundle?.lifecycleEvents ?? []).some(
      (e) =>
        e.applicationId === app.id &&
        (normalizeToken(e.eventType).includes("assessment") ||
          normalizeToken(e.eventType).includes("take_home")),
    )
  );
};
const hasRecruiterScreenSignal = (app, meta = appMeta(app)) =>
  meta.interviews.some((i) => i.stage === "recruiter_screen") ||
  (state.bundle?.lifecycleEvents ?? []).some(
    (e) =>
      e.applicationId === app.id &&
      (normalizeToken(e.eventType).includes("recruiter_screen") ||
        normalizeToken(e.status) === "recruiter_screen"),
  );
const hasResponseSignal = (app, meta = appMeta(app)) => {
  const m = compactMetadata(app);
  return (
    OUTCOMES.has(app.status) ||
    hasAssessmentSignal(app) ||
    hasRecruiterScreenSignal(app, meta) ||
    meta.interviews.length > 0 ||
    meta.offers.length > 0 ||
    ["replied", "reply", "responded"].includes(
      normalizeToken(m.outreach_status),
    ) ||
    meta.outreach.some(
      (o) =>
        normalizeToken(o.direction) === "inbound" ||
        ["replied", "reply", "responded"].includes(normalizeToken(o.status)),
    ) ||
    (state.bundle?.lifecycleEvents ?? []).some(
      (e) =>
        e.applicationId === app.id &&
        [
          "hiring_manager_reply",
          "offer",
          "offer_received",
          "written_assessment_requested",
          "recruiter_screen_scheduled",
          "recruiter_screen_completed",
        ].includes(normalizeToken(e.eventType)),
    )
  );
};
const outreachState = (app, meta = appMeta(app)) => {
  const status = normalizeToken(compactValue(app, "outreach_status"));
  if (["replied", "reply", "responded"].includes(status)) return "replied";
  if (
    status === "sent" ||
    meta.outreach.some((o) => normalizeToken(o.direction) === "outbound")
  )
    return "sent";
  return "none";
};

function fitScore(notes) {
  return String(notes || "").match(/fit_score_100[":\s]+([\d.]+)/)?.[1] || "";
}
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
      "Application records",
      "Applications saved locally",
    ],
    [
      "Outreach sent",
      metrics.outreachSent,
      "Outbound outreach messages",
      "Messages marked outbound or sent",
    ],
    [
      "Application responses",
      metrics.applicationsWithResponse,
      `${metrics.applicationsWithResponse} of ${metrics.totalApplications} applications`,
      "Unique applications with a reply, assessment, screen, interview, offer, or terminal employer outcome",
    ],
    [
      "Application response rate",
      `${metrics.applicationResponseRate}%`,
      `${metrics.applicationsWithResponse} of ${metrics.totalApplications} applications`,
      "Unique responding applications divided by total applications",
    ],
    [
      "Outreach reply rate",
      `${metrics.outreachReplyRate}%`,
      `${metrics.outreachReplies} of ${metrics.outreachSent} outreach messages`,
      "Inbound/replied outreach divided by outbound outreach",
    ],
    [
      "Recruiter screens",
      metrics.recruiterScreens,
      "Separate from interviews",
      "Recruiter screens are counted apart from technical, onsite, and other interviews",
    ],
    [
      "Interviews",
      metrics.interviews,
      "Excludes recruiter screens",
      "Non-recruiter-screen interview records only",
    ],
    [
      "Assessments",
      metrics.assessments,
      "Written assessments/take-homes",
      "Visible as actions, not interviews",
    ],
    [
      "Offers",
      metrics.offers,
      "Offer records or offer outcomes",
      "Applications with offer signals",
    ],
  ];
  $("[data-metrics]").innerHTML = cards
    .map(
      ([label, value, help, description]) =>
        `<div class="metric" aria-label="${esc(label)}: ${esc(value)} (${esc(description || help)})"><span>${esc(label)}</span><strong>${esc(value)}</strong><small class="muted">${esc(help)}</small></div>`,
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
    response = $('[data-filter="response"]').value,
    outreach = $('[data-filter="outreach"]').value,
    followup = $('[data-filter="followup"]').value,
    activity = $('[data-filter="activity"]').value,
    out = $('[data-filter="outcome"]').value;
  const hasActiveFilters = Boolean(
    q || st || response || outreach || followup || activity || out,
  );
  let rows = state.apps.filter((a) => {
    const m = appMeta(a);
    return (
      (!q ||
        [
          a.company,
          a.role,
          a.status,
          a.notes,
          compactValue(a, "spreadsheet_status"),
          compactValue(a, "spreadsheet_interview_stage"),
          compactValue(a, "spreadsheet_outcome"),
          compactValue(a, "outreach_status"),
        ].some((x) =>
          String(x || "")
            .toLowerCase()
            .includes(q),
        )) &&
      (!st || a.status === st) &&
      (!response || (response === "responded") === hasResponseSignal(a, m)) &&
      (!outreach || outreachState(a, m) === outreach) &&
      (!followup ||
        (followup === "due"
          ? a.followUpDate && day(a.followUpDate) <= day(now())
          : followup === "scheduled"
            ? Boolean(a.followUpDate)
            : !a.followUpDate)) &&
      (!activity ||
        (activity === "assessment"
          ? hasAssessmentSignal(a)
          : activity === "recruiter_screen"
            ? hasRecruiterScreenSignal(a, m)
            : TERMINAL_OUTCOMES.has(outcomeForApp(a, m)) ||
              TERMINAL_OUTCOMES.has(a.status))) &&
      (!out || outcomeForApp(a, m) === out)
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
      const raw = [
        compactValue(a, "spreadsheet_status"),
        compactValue(a, "spreadsheet_interview_stage"),
        compactValue(a, "spreadsheet_outcome"),
      ]
        .filter(Boolean)
        .join(" / ");
      const interviewLabel = hasAssessmentSignal(a)
        ? "Assessment/take-home"
        : hasRecruiterScreenSignal(a, m)
          ? "Recruiter screen"
          : m.interviews.at(-1)?.stage ||
            compactValue(a, "spreadsheet_interview_stage");
      return `<tr><td><button class="button" data-open="${esc(a.id)}">${esc(a.company)}</button><div class="muted clamp">${esc(raw)}</div></td><td><span class="clamp">${esc(a.role)}</span></td><td>${esc(a.status)}</td><td>${day(a.appliedAt)}</td><td>${day(a.followUpDate || compactValue(a, "follow_up_date"))}</td><td>${esc(compactValue(a, "outreach_status") || outreachState(a, m))}</td><td>${esc(interviewLabel || "")}</td><td>${esc(outcomeForApp(a, m) || compactValue(a, "spreadsheet_outcome"))}</td><td>${esc(fitScore(a.notes))}</td><td class="wrap-anywhere">${m.artifacts.map(linkForArtifact).join(", ")}</td></tr>`;
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

function timelineEvents(app) {
  return [...(state.bundle.lifecycleEvents ?? [])]
    .filter((e) => e.applicationId === app.id)
    .sort(
      (a, b) =>
        String(a.occurredAt || a.dueAt || "").localeCompare(
          String(b.occurredAt || b.dueAt || ""),
        ) ||
        String(a.dueAt || "").localeCompare(String(b.dueAt || "")) ||
        String(a.id || "").localeCompare(String(b.id || "")),
    );
}
function sourceArtifactHtml(value) {
  const href = safeHref(value);
  return href
    ? `<a href="${esc(href)}" rel="noopener noreferrer">${esc(value)}</a>`
    : esc(value);
}
function lifecycleClass(event) {
  const type = normalizeToken(event.eventType);
  if (type.includes("assessment") || type.includes("take_home"))
    return "timeline-assessment";
  if (
    type.includes("recruiter_screen") ||
    normalizeToken(event.status) === "recruiter_screen"
  )
    return "timeline-recruiter";
  if (
    type.includes("interview") ||
    ["technical_screen", "onsite_loop"].includes(normalizeToken(event.status))
  )
    return "timeline-interview";
  return "";
}
function lifecycleDetails(event) {
  const fields = [
    ["Type", event.eventType],
    ["Stage", event.stageLabel],
    ["Status", event.status],
    ["Channel", event.channel],
    ["Actor", event.actor],
    [
      "Requires action",
      event.requiresUserAction === undefined
        ? undefined
        : event.requiresUserAction
          ? "yes"
          : "no",
    ],
    ["Action status", event.actionStatus],
    ["Due", day(event.dueAt)],
    [
      "No AI required",
      event.noAiRequired === undefined
        ? undefined
        : event.noAiRequired
          ? "yes"
          : "no",
    ],
  ].filter(
    ([, value]) =>
      value !== undefined && value !== null && String(value) !== "",
  );
  const artifact = event.sourceArtifact
    ? `<dt>Source artifact</dt><dd class="wrap-anywhere">${sourceArtifactHtml(event.sourceArtifact)}</dd>`
    : "";
  const details =
    event.details || event.note
      ? `<dt>Details</dt><dd class="wrap-anywhere">${esc(event.details || event.note)}</dd>`
      : "";
  return `<dl class="metadata-list">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}${artifact}${details}</dl>`;
}
function metadataSection(app) {
  const entries = metadataEntries(app);
  return `<article class="card"><h3>Preserved spreadsheet metadata</h3>${entries.length ? `<dl class="metadata-list">${entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="wrap-anywhere">${esc(v)}</dd>`).join("")}</dl>` : '<p class="muted">No compact CSV metadata stored for this application.</p>'}</article>`;
}

function detailForm(app) {
  const m = appMeta(app);
  const events = timelineEvents(app);
  const recruiterInterviews = m.interviews.filter(
    (i) => i.stage === "recruiter_screen",
  );
  const otherInterviews = m.interviews.filter(
    (i) => i.stage !== "recruiter_screen",
  );
  return `<div class="tracker-detail"><article class="card"><h2>${esc(app.company || "New application")} — ${esc(app.role || "Unsaved")}</h2><form class="tracker-form" data-core-form>${input("company", app.company, true)}${input("role", app.role, true)}${input("postingUrl", app.postingUrl, "url")}<label>Status<select name="status" required>${STATUSES.map((s) => `<option ${app.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${input("source", app.source, "text")}${input("appliedAt", day(app.appliedAt), "date", true)}${input("followUpDate", day(app.followUpDate), "date")}<label>Notes<textarea name="notes">${esc(app.notes)}</textarea></label><button class="button">Save application</button></form></article>${metadataSection(app)}<article class="card"><h3>Lifecycle timeline</h3><p class="muted">Sorted by occurred date, due date, then stable ID. Lifecycle data stays local in this browser.</p><ul class="timeline">${
    events.length
      ? events
          .map(
            (e) =>
              `<li class="${lifecycleClass(e)}"><strong>${esc(day(e.occurredAt) || day(e.dueAt) || "No date")}</strong>${lifecycleDetails(e)}</li>`,
          )
          .join("")
      : '<li class="muted">No lifecycle events for this application yet.</li>'
  }</ul></article><article class="card"><h3>Assessments/take-homes</h3>${hasAssessmentSignal(app) ? "<p>Written assessments and take-homes are tracked as actions, not interviews.</p>" : '<p class="muted">No assessments or take-homes logged.</p>'}</article><article class="card"><h3>Recruiter screens</h3><ul>${recruiterInterviews.map((i) => `<li>${day(i.startsAt)} ${esc(i.stage)} ${esc(i.outcome)}</li>`).join("") || '<li class="muted">No recruiter screens logged.</li>'}</ul></article><article class="card"><h3>Interviews</h3><form class="tracker-form" data-interview-form><label>Stage<select name="stage"><option>recruiter_screen</option><option>technical_screen</option><option>onsite_loop</option><option>other</option></select></label>${input("startsAt", day(now()), "date")}<button class="button">Log interview</button></form><ul>${otherInterviews.map((i) => `<li>${day(i.startsAt)} ${esc(i.stage)} ${esc(i.outcome)}</li>`).join("") || '<li class="muted">No non-recruiter interviews logged.</li>'}</ul></article><article class="card"><h3>Links/artifacts</h3><form class="tracker-form" data-artifact-form>${input("name", "", true)}${input("url", "")}<button class="button">Add link/artifact</button></form><ul>${m.artifacts.map((a) => `<li>${linkForArtifact(a)}</li>`).join("")}</ul></article><article class="card"><h3>Outreach messages</h3><form class="tracker-form" data-outreach-form><label>Channel<select name="channel"><option>email</option><option>linkedin</option><option>phone</option><option>sms</option><option>other</option></select></label><label>Message<textarea name="body" required></textarea></label><button class="button">Add outreach</button></form><ul>${m.outreach.map((o) => `<li>${day(o.sentAt)} ${esc(o.channel)} ${esc(o.body)}</li>`).join("")}</ul></article><article class="card"><h3>Offers</h3><form class="tracker-form" data-offer-form><label>Status<select name="status"><option>received</option><option>negotiating</option><option>accepted</option><option>declined</option></select></label>${input("notes", "")}<button class="button">Log offer</button></form><ul>${m.offers.map((o) => `<li>${esc(o.status)} ${esc(o.notes || "")}</li>`).join("")}</ul></article></div>`;
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
function previewBundleFromCsv(text) {
  const { bundle, errors } = csvToBrowserApplicationExport(text);
  if (errors.length) {
    throw new Error(
      errors
        .map((error) =>
          error.rowNumber
            ? `Row ${error.rowNumber} ${error.field}: ${error.message}`
            : `${error.field}: ${error.message}`,
        )
        .join("; "),
    );
  }
  return bundle;
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
      if (!Array.isArray(rows) || !rows.length) return;
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

function importFormatLabel(format, detected) {
  if (format === "json") return "JSON backup";
  if (format === "ndjson") return "NDJSON backup";
  if (detected === "lifecycle_csv") return "supplemental lifecycle CSV";
  return "compact application CSV";
}
function countByType(recordsByStore) {
  const lifecycleEvents = recordsByStore.lifecycleEvents ?? [];
  return {
    applications: recordsByStore.applications?.length ?? 0,
    contacts: recordsByStore.contacts?.length ?? 0,
    outreachMessages: recordsByStore.outreachMessages?.length ?? 0,
    lifecycleEvents: lifecycleEvents.length,
    recruiterScreens:
      lifecycleEvents.filter(
        (e) =>
          normalizeToken(e.eventType).includes("recruiter_screen") ||
          normalizeToken(e.status) === "recruiter_screen",
      ).length +
      (recordsByStore.interviews ?? []).filter(
        (i) => i.stage === "recruiter_screen",
      ).length,
    interviews: (recordsByStore.interviews ?? []).filter(
      (i) => i.stage !== "recruiter_screen",
    ).length,
    assessmentsActions: lifecycleEvents.filter(
      (e) =>
        normalizeToken(e.eventType).includes("assessment") ||
        normalizeToken(e.eventType).includes("take_home"),
    ).length,
    offers: recordsByStore.offers?.length ?? 0,
    artifacts: recordsByStore.artifacts?.length ?? 0,
    reminders: recordsByStore.reminders?.length ?? 0,
    settings: recordsByStore.settings?.length ?? 0,
  };
}
function formatIssue(issue) {
  const row = issue.rowNumber ? `Row ${issue.rowNumber} ` : "";
  const store = issue.store ? `${issue.store} ` : "";
  const field = issue.field ? `${issue.field}: ` : "";
  return `${row}${store}${field}${issue.message || issue.code || issue.id || "issue"}`;
}
function renderImportPreview({
  ok,
  label,
  recordsByStore = {},
  conflicts = [],
  errors = [],
  warnings = [],
}) {
  const counts = countByType(recordsByStore);
  const conflictCounts = conflicts.reduce((acc, conflict) => {
    const store = conflict.storeName || conflict.store || "records";
    acc[store] = (acc[store] || 0) + 1;
    return acc;
  }, {});
  const conflictSummary = `${conflicts.length} existing record conflicts`;
  const conflictItems =
    Object.entries(conflictCounts)
      .map(([store, count]) => `<li>${esc(store)}: ${count}</li>`)
      .join("") || "<li>None</li>";
  const countItems = Object.entries(counts)
    .map(
      ([store, count]) => `<li><strong>${esc(store)}</strong>: ${count}</li>`,
    )
    .join("");
  const warningItems =
    warnings
      .map((warning) => `<li>${esc(formatIssue(warning))}</li>`)
      .join("") || "<li>None</li>";
  const errorItems =
    errors.map((error) => `<li>${esc(formatIssue(error))}</li>`).join("") ||
    "<li>None</li>";
  const legacySummary = `Dry-run OK: ${counts.applications} applications, ${counts.outreachMessages} outreach messages, ${counts.interviews} interviews`;
  $(`[data-import-result]`).innerHTML =
    `<h4>${ok ? "Dry-run succeeded" : "Import preview failed"}: ${esc(label)}</h4><p>${ok ? "No data has been written. Import data stays local in this browser unless you choose Apply import." : "Fix blocking errors before applying this import."}</p>${ok ? `<p>${esc(legacySummary)}</p>` : ""}<div class="preview-grid"><section><h5>Record counts</h5><ul>${countItems}</ul></section><section><h5>Conflicts by store and ID</h5><p>${esc(conflictSummary)}</p><ul>${conflictItems}</ul></section><section><h5>Warnings</h5><ul>${warningItems}</ul></section><section><h5>Blocking errors</h5><ul>${errorItems}</ul></section></div>`;
}

async function previewImport() {
  const file = $(`[data-import-file]`).files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const format = importFormatForFile(file);
    const detected =
      format === "csv" ? detectSpreadsheetImportFormat(text) : format;
    const label = importFormatLabel(format, detected);
    const lifecyclePreview =
      format === "csv" && detected === "lifecycle_csv"
        ? await previewSupplementalLifecycleCsvImport(text, {
            exportAllData: repo.exportAll,
          })
        : null;
    const bundle = lifecyclePreview
      ? lifecyclePreview.bundle
      : format === "json"
        ? importJsonBackup(text)
        : format === "ndjson"
          ? importNdjsonBackup(text)
          : previewBundleFromCsv(text);
    state.preview = lifecyclePreview
      ? {
          lifecycleEvents: bundle.lifecycleEvents ?? [],
          interviews: bundle.interviews ?? [],
          reminders: bundle.reminders ?? [],
        }
      : bundleForIndexedDb(bundle);
    state.previewConflicts =
      lifecyclePreview?.conflicts ??
      (await detectImportConflicts(state.preview));
    const errors = lifecyclePreview?.errors ?? [];
    const warnings = [
      ...(lifecyclePreview?.conflicts ?? []),
      ...state.previewConflicts.filter(
        (conflict) => !lifecyclePreview?.conflicts?.includes(conflict),
      ),
    ];
    const blocking = errors.length > 0;
    renderImportPreview({
      ok: !blocking,
      label,
      recordsByStore: state.preview,
      conflicts: state.previewConflicts,
      warnings,
      errors,
    });
    if (blocking) state.preview = null;
    $(`[data-import-apply]`).disabled = blocking;
  } catch (err) {
    state.preview = null;
    state.previewConflicts = [];
    $(`[data-import-apply]`).disabled = true;
    renderImportPreview({
      ok: false,
      label: "selected file",
      errors: [{ message: err?.message ?? String(err) }],
    });
  }
}

function resetImportPreview() {
  state.preview = null;
  state.previewConflicts = [];
  $("[data-import-apply]").disabled = true;
  $("[data-import-result]").textContent =
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
  $("[data-import-result]").textContent = "Import applied.";
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
