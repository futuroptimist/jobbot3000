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

const STORE_LABELS = {
  applications: "applications",
  contacts: "contacts",
  outreachMessages: "outreach messages",
  lifecycleEvents: "lifecycle events",
  interviews: "interviews",
  offers: "offers",
  artifacts: "artifacts",
  reminders: "reminders",
  settings: "settings",
};
const IMPORTANT_METADATA_KEYS = [
  "spreadsheet_status",
  "spreadsheet_interview_stage",
  "spreadsheet_outcome",
  "outreach_status",
  "outreach_channel",
  "application_url",
  "posting_id",
  "work_model",
  "fit_score_100",
];
const normalizeUi = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const lifecycleType = (event) => normalizeUi(event.eventType || event.status);
const isAssessmentEvent = (event) =>
  [
    "written_assessment",
    "written_assessment_requested",
    "written_assessment_submitted",
    "take_home",
    "take_home_requested",
    "take_home_submitted",
  ].includes(lifecycleType(event));
const isRecruiterScreenEvent = (event) =>
  lifecycleType(event).startsWith("recruiter_screen") ||
  normalizeUi(event.status) === "recruiter_screen";
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
      "volume",
    ],
    [
      "Outreach sent",
      metrics.outreachSent,
      "Outbound outreach messages",
      "outreach",
    ],
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
    [
      "Recruiter screens",
      metrics.recruiterScreens,
      "Recruiter screens only; separate from other interviews",
      "screen",
    ],
    [
      "Interviews",
      metrics.interviews,
      "Technical, onsite, and other non-recruiter interviews",
      "interview",
    ],
    [
      "Assessments",
      metrics.assessments,
      "Written assessments and take-homes; not counted as interviews",
      "assessment",
    ],
    ["Offers", metrics.offers, "Offer records or offer outcomes", "offer"],
  ];
  $(`[data-metrics]`).innerHTML = cards
    .map(
      ([label, value, help, kind]) =>
        `<div class="metric metric-${esc(kind)}" aria-label="${esc(label)}: ${esc(value)} (${esc(help)})"><span>${esc(label)}</span><strong>${esc(value)}</strong><small class="muted">${esc(help)}</small></div>`,
    )
    .join("");
  const weeks = {};
  for (const a of b.applications) {
    const bucket = weekBucket(a.appliedAt);
    if (bucket) weeks[bucket] = (weeks[bucket] || 0) + 1;
  }
  $(`[data-weekly-counts]`).textContent =
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
    metadata: readSpreadsheetMetadata(app.notes),
  };
}
function outcomeForApp(app, meta = appMeta(app)) {
  if (OUTCOMES.has(app.status)) return app.status;
  return meta.offers.at(-1)?.status || "";
}
function renderList() {
  const q = $(`[data-filter="query"]`).value.toLowerCase(),
    st = $(`[data-filter="status"]`).value,
    out = $(`[data-filter="outcome"]`).value,
    response = $(`[data-filter="response"]`).value,
    outreachState = $(`[data-filter="outreach"]`).value,
    followUp = $(`[data-filter="follow-up"]`).value,
    activity = $(`[data-filter="activity"]`).value;
  const today = day(now());
  const hasActiveFilters = Boolean(
    q || st || out || response || outreachState || followUp || activity,
  );
  let rows = state.apps.filter((a) => {
    const m = appMeta(a);
    const metadataText = Object.values(m.metadata).join(" ");
    const hasResponse =
      [
        "offer",
        "accepted",
        "rejected",
        "withdrawn",
        "closed_archived",
      ].includes(a.status) ||
      m.outreach.some(
        (x) =>
          normalizeUi(x.direction) === "inbound" ||
          ["replied", "reply", "responded"].includes(normalizeUi(x.status)),
      ) ||
      m.lifecycle.some((x) =>
        [
          "hiring_manager_reply",
          "written_assessment_requested",
          "recruiter_screen_scheduled",
          "recruiter_screen_completed",
          "offer",
          "offer_received",
        ].includes(lifecycleType(x)),
      );
    const hasAssessment =
      m.lifecycle.some(isAssessmentEvent) ||
      normalizeUi(m.metadata.spreadsheet_interview_stage).includes(
        "assessment",
      ) ||
      normalizeUi(m.metadata.spreadsheet_outcome).includes("take_home");
    const hasRecruiterScreen =
      m.interviews.some((x) => x.stage === "recruiter_screen") ||
      m.lifecycle.some(isRecruiterScreenEvent);
    const isTerminal =
      ["accepted", "rejected", "withdrawn", "closed_archived"].includes(
        outcomeForApp(a, m),
      ) ||
      ["accepted", "rejected", "withdrawn", "closed_archived"].includes(
        a.status,
      );
    const outreachStatus =
      normalizeUi(m.metadata.outreach_status) ||
      (m.outreach.length ? "sent" : "none");
    return (
      (!q ||
        [a.company, a.role, a.status, a.notes, metadataText].some((x) =>
          String(x || "")
            .toLowerCase()
            .includes(q),
        )) &&
      (!st || a.status === st) &&
      (!out || outcomeForApp(a, m) === out) &&
      (!response || (response === "responded" ? hasResponse : !hasResponse)) &&
      (!outreachState ||
        (outreachState === "none"
          ? outreachStatus === "none"
          : outreachStatus === outreachState)) &&
      (!followUp ||
        (followUp === "due"
          ? day(a.followUpDate) && day(a.followUpDate) <= today
          : !a.followUpDate)) &&
      (!activity ||
        (activity === "assessments"
          ? hasAssessment
          : activity === "recruiter_screens"
            ? hasRecruiterScreen
            : isTerminal))
    );
  });
  rows.sort(
    (a, b) =>
      String(a[state.sort] || "").localeCompare(String(b[state.sort] || "")) *
      state.dir,
  );
  const emptyState = $(`[data-empty-state]`);
  emptyState.textContent = hasActiveFilters
    ? "No applications match the current filters."
    : "No applications yet. Create one or import a CSV backup.";
  emptyState.hidden = rows.length > 0;
  $(`[data-applications-table]`).hidden = rows.length === 0;
  $(`[data-applications-table] tbody`).innerHTML = rows
    .map((a) => {
      const m = appMeta(a);
      const rawStage = m.metadata.spreadsheet_interview_stage || "";
      const rawOutcome = m.metadata.spreadsheet_outcome || "";
      const chips = [
        m.metadata.spreadsheet_status &&
          `raw status: ${m.metadata.spreadsheet_status}`,
        rawStage && `raw stage: ${rawStage}`,
        rawOutcome && `raw outcome: ${rawOutcome}`,
        m.metadata.outreach_status && `outreach: ${m.metadata.outreach_status}`,
      ].filter(Boolean);
      const latestInterview =
        m.interviews.filter((x) => x.stage !== "recruiter_screen").at(-1)
          ?.stage || "";
      const recruiterChip =
        m.interviews.some((x) => x.stage === "recruiter_screen") ||
        m.lifecycle.some(isRecruiterScreenEvent)
          ? '<span class="chip chip-screen">recruiter screen</span>'
          : "";
      const assessmentChip =
        m.lifecycle.some(isAssessmentEvent) ||
        normalizeUi(rawStage).includes("assessment") ||
        normalizeUi(rawOutcome).includes("take_home")
          ? '<span class="chip chip-assessment">assessment/take-home</span>'
          : "";
      return `<tr><td><button class="button" data-open="${esc(a.id)}">${esc(a.company)}</button></td><td>${esc(a.role)}</td><td>${esc(a.status)}<div class="chip-row">${chips.map((chip) => `<span class="chip">${esc(chip)}</span>`).join("")}</div></td><td>${day(a.appliedAt)}</td><td>${day(a.followUpDate || m.metadata.follow_up_date)}</td><td>${esc(m.metadata.outreach_status || (m.outreach.length ? "sent" : "none"))}</td><td><span>${esc(latestInterview)}</span><div class="chip-row">${recruiterChip}${assessmentChip}</div></td><td>${esc(outcomeForApp(a, m) || rawOutcome)}</td><td>${esc(fitScore(a.notes) || m.metadata.fit_score_100 || "")}</td><td class="wrap-cell">${m.artifacts.map(linkForArtifact).join(", ")}</td></tr>`;
    })
    .join("");
  $$(`[data-open]`).forEach(
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
function artifactLink(value, label = value) {
  const raw = String(value ?? "").trim();
  let href = "";
  try {
    const url = new URL(raw);
    if (["http:", "https:"].includes(url.protocol)) href = url.toString();
  } catch {
    href = "";
  }
  return href
    ? `<a href="${esc(href)}" rel="noopener noreferrer">${esc(label)}</a>`
    : esc(label || "");
}
function metadataList(metadata) {
  const entries = IMPORTANT_METADATA_KEYS.map((key) => [
    key,
    metadata[key],
  ]).filter(([, value]) => value);
  return entries.length
    ? `<dl class="metadata-list">${entries.map(([key, value]) => `<div><dt>${esc(key.replaceAll("_", " "))}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`
    : '<p class="muted">No compact CSV metadata for this application yet.</p>';
}
function eventSortKey(event) {
  return [
    event.occurredAt || "9999",
    event.dueAt || "9999",
    event.id || "",
  ].join("|");
}
function timelineItem(event) {
  const classes = ["timeline-item"];
  if (isAssessmentEvent(event)) classes.push("timeline-assessment");
  if (isRecruiterScreenEvent(event)) classes.push("timeline-screen");
  const fields = [
    ["Type", event.eventType],
    ["Stage", event.stageLabel],
    ["Channel", event.channel],
    ["Actor", event.actor],
    [
      "Requires action",
      event.requiresUserAction === undefined
        ? ""
        : event.requiresUserAction
          ? "yes"
          : "no",
    ],
    ["Action status", event.actionStatus],
    ["Due", day(event.dueAt)],
    [
      "No AI required",
      event.noAiRequired === undefined ? "" : event.noAiRequired ? "yes" : "no",
    ],
    ["Source", event.sourceArtifact ? artifactLink(event.sourceArtifact) : ""],
    ["Details", event.details || event.note],
  ].filter(([, value]) => value !== undefined && value !== "");
  return `<li class="${classes.join(" ")}"><strong>${day(event.occurredAt || event.dueAt) || "undated"} · ${esc(event.status || event.eventType || "event")}</strong><dl>${fields.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${String(value).startsWith("<a ") ? value : esc(value)}</dd></div>`).join("")}</dl></li>`;
}
function detailForm(app) {
  const m = appMeta(app);
  const lifecycle = state.bundle.lifecycleEvents
    .filter((e) => e.applicationId === app.id)
    .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  const recruiterInterviews = m.interviews.filter(
    (i) => i.stage === "recruiter_screen",
  );
  const otherInterviews = m.interviews.filter(
    (i) => i.stage !== "recruiter_screen",
  );
  const assessmentEvents = lifecycle.filter(isAssessmentEvent);
  return `<div class="tracker-detail"><article class="card"><h2>${esc(app.company || "New application")} — ${esc(app.role || "Unsaved")}</h2><form class="tracker-form" data-core-form>${input("company", app.company, true)}${input("role", app.role, true)}${input("postingUrl", app.postingUrl, "url")}<label>Status<select name="status" required>${STATUSES.map((status) => `<option ${app.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>${input("source", app.source, "text")}${input("appliedAt", day(app.appliedAt), "date", true)}${input("followUpDate", day(app.followUpDate), "date")}<label>Notes<textarea name="notes">${esc(app.notes)}</textarea></label><button class="button">Save application</button></form></article><article class="card"><h3>Compact CSV metadata</h3>${metadataList(m.metadata)}</article><article class="card"><h3>Lifecycle timeline</h3><p class="muted">Sorted by occurred date, due date, then stable event ID.</p><ul class="timeline">${lifecycle.map(timelineItem).join("") || "<li>No lifecycle events for this application yet.</li>"}</ul></article><article class="card"><h3>Written assessments / take-homes</h3>${assessmentEvents.length ? `<ul class="timeline">${assessmentEvents.map(timelineItem).join("")}</ul>` : '<p class="muted">No written assessments or take-homes recorded.</p>'}</article><article class="card"><h3>Recruiter screens</h3><ul>${recruiterInterviews.map((i) => `<li>${day(i.startsAt)} ${esc(i.outcome || "scheduled")}</li>`).join("") || '<li class="muted">No recruiter screens recorded.</li>'}</ul></article><article class="card"><h3>Links/artifacts</h3><form class="tracker-form" data-artifact-form>${input("name", "", true)}${input("url", "")}<button class="button">Add link/artifact</button></form><ul>${m.artifacts.map((a) => `<li>${linkForArtifact(a)}</li>`).join("")}</ul></article><article class="card"><h3>Outreach messages</h3><form class="tracker-form" data-outreach-form><label>Channel<select name="channel"><option>email</option><option>linkedin</option><option>phone</option><option>sms</option><option>other</option></select></label><label>Message<textarea name="body" required></textarea></label><button class="button">Add outreach</button></form><ul>${m.outreach.map((o) => `<li>${day(o.sentAt)} ${esc(o.channel)} ${esc(o.body)}</li>`).join("")}</ul></article><article class="card"><h3>Interviews (non-recruiter)</h3><form class="tracker-form" data-interview-form><label>Stage<select name="stage"><option>recruiter_screen</option><option>technical_screen</option><option>onsite_loop</option><option>other</option></select></label>${input("startsAt", day(now()), "date")}<button class="button">Log interview</button></form><ul>${otherInterviews.map((i) => `<li>${day(i.startsAt)} ${esc(i.stage)} ${esc(i.outcome)}</li>`).join("") || '<li class="muted">No non-recruiter interviews recorded.</li>'}</ul></article><article class="card"><h3>Offers</h3><form class="tracker-form" data-offer-form><label>Status<select name="status"><option>received</option><option>negotiating</option><option>accepted</option><option>declined</option></select></label>${input("notes", "")}<button class="button">Log offer</button></form><ul>${m.offers.map((o) => `<li>${esc(o.status)} ${esc(o.notes || "")}</li>`).join("")}</ul></article></div>`;
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
const formatLabel = (format, spreadsheetFormat) => {
  if (format === "json") return "JSON backup";
  if (format === "ndjson") return "NDJSON backup";
  if (spreadsheetFormat === "lifecycle_csv")
    return "supplemental lifecycle CSV";
  if (spreadsheetFormat === "compact_csv") return "compact application CSV";
  return "CSV (unknown column layout)";
};
function countPreviewRecords(preview) {
  return Object.fromEntries(
    [...ARRAY_STORES, "settings"].map((store) => [
      store,
      preview[store]?.length ?? 0,
    ]),
  );
}
function renderImportPreviewResult({ label, counts, conflicts, errors = [] }) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const conflictRows = conflicts
    .map(
      (conflict) =>
        `<li>${esc(conflict.storeName || conflict.store || "record")} ${esc(conflict.id || conflict.value || "unknown id")}: ${esc(conflict.code || "existing record conflict")}</li>`,
    )
    .join("");
  const errorRows = errors
    .map(
      (error) =>
        `<li>Row ${esc(error.rowNumber || "?")} ${esc(error.field || "record")}: ${esc(error.message || error.code)}</li>`,
    )
    .join("");
  $(`[data-import-result]`).innerHTML =
    `<div class="import-summary ${errors.length ? "danger" : conflicts.length ? "warning" : "success"}"><strong>${errors.length ? "Import preview found blocking errors" : conflicts.length ? "Import dry run succeeded with warnings" : "Import dry run succeeded"}</strong><p>Detected format: ${esc(label)}. Data remains local in this browser until you apply the import.</p><p>${total} total incoming records.</p><p class="visually-hidden">Dry-run OK: ${counts.applications} applications, ${counts.outreachMessages} outreach messages, ${counts.interviews} interviews</p></div><ul class="import-counts">${
      Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(
          ([store, count]) =>
            `<li><strong>${count}</strong> ${esc(STORE_LABELS[store] || store)}</li>`,
        )
        .join("") || "<li>No importable records detected.</li>"
    }</ul>${conflicts.length ? `<h4>Conflicts by store and ID</h4><ul>${conflictRows}</ul>` : '<p class="muted">No existing record conflicts detected.</p>'}${errors.length ? `<h4>Blocking errors</h4><ul>${errorRows}</ul>` : ""}`;
}
async function previewImport() {
  const file = $(`[data-import-file]`).files[0];
  if (!file) return;
  const applyButton = $(`[data-import-apply]`);
  try {
    const text = await file.text();
    const format = importFormatForFile(file);
    const spreadsheetFormat =
      format === "csv" ? detectSpreadsheetImportFormat(text) : "";
    let bundle;
    let errors = [];
    let conflicts = [];
    if (spreadsheetFormat === "lifecycle_csv") {
      const preview = await previewSupplementalLifecycleCsvImport(text, {
        exportAllData: repo.exportAll,
      });
      bundle = preview.bundle;
      errors = preview.errors;
      conflicts = preview.conflicts;
      state.preview = {
        lifecycleEvents: bundle.lifecycleEvents ?? [],
        interviews: bundle.interviews ?? [],
        reminders: bundle.reminders ?? [],
      };
    } else if (
      spreadsheetFormat === "compact_csv" ||
      (format === "csv" && spreadsheetFormat === "unknown_csv")
    ) {
      const preview = await previewCompactCsvImport(text, {
        exportAllData: repo.exportAll,
      });
      bundle = preview.bundle;
      errors = preview.errors;
      conflicts = preview.conflicts;
      state.preview = bundleForIndexedDb(bundle);
    } else {
      bundle =
        format === "json"
          ? importJsonBackup(text)
          : format === "ndjson"
            ? importNdjsonBackup(text)
            : (() => {
                throw new Error(
                  "Unsupported CSV column layout. Use compact application CSV or supplemental lifecycle CSV.",
                );
              })();
      state.preview = bundleForIndexedDb(bundle);
      conflicts = await detectImportConflicts(state.preview);
    }
    state.previewConflicts = conflicts.length
      ? conflicts
      : await detectImportConflicts(state.preview);
    renderImportPreviewResult({
      label: formatLabel(
        format,
        spreadsheetFormat === "unknown_csv" ? "compact_csv" : spreadsheetFormat,
      ),
      counts: countPreviewRecords(state.preview),
      conflicts: state.previewConflicts,
      errors,
    });
    applyButton.disabled = errors.length > 0;
    if (errors.length > 0) state.preview = null;
  } catch (err) {
    state.preview = null;
    state.previewConflicts = [];
    applyButton.disabled = true;
    $(`[data-import-result]`).innerHTML =
      `<div class="danger"><strong>Import preview failed</strong><p>${esc(err?.message ?? err)}</p></div>`;
  }
}
function resetImportPreview() {
  state.preview = null;
  state.previewConflicts = [];
  $(`[data-import-apply]`).disabled = true;
  $(`[data-import-result]`).textContent =
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
    $(`[data-import-result]`).textContent = "Import canceled.";
    return;
  }
  try {
    await batchPut(state.preview);
  } catch (err) {
    $(`[data-import-result]`).textContent =
      `Import failed: ${err?.message ?? err}`;
    return;
  }
  $(`[data-import-result]`).innerHTML =
    '<strong class="success">Import applied successfully.</strong><p class="muted">Imported records were written only to this browser\'s local IndexedDB.</p>';
  $(`[data-import-apply]`).disabled = true;
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
