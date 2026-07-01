/* global document, indexedDB, confirm */
/* eslint-disable max-len */
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
  sort: "appliedAt",
  dir: -1,
  current: null,
  detailSave: Promise.resolve(),
};
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    q = false;
  const input = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (q) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
function csv(rows) {
  const e = (v) =>
    /[",\n]/.test(String(v ?? ""))
      ? `"${String(v ?? "").replaceAll('"', '""')}"`
      : String(v ?? "");
  return rows.map((r) => r.map(e).join(",")).join("\n") + "\n";
}
function safeIsoDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
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
function rowToRecords(r) {
  const ts = now(),
    appId = r.application_id || id("app");
  const app = {
    id: appId,
    company: r.company || "Unknown company",
    role: r.role_title || r.role || "Unknown role",
    status: STATUSES.includes(r.status) ? r.status : "applied",
    source: r.application_channel || undefined,
    postingUrl: r.posting_url || undefined,
    appliedAt: safeIsoDate(r.applied_at, ts),
    followUpDate: safeIsoDate(r.follow_up_date, undefined),
    notes: r.notes || undefined,
    createdAt: ts,
    updatedAt: ts,
  };
  const records = {
    applications: [app],
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: [
      {
        id: id("event"),
        applicationId: appId,
        status: app.status,
        occurredAt: app.appliedAt,
        source: "csv_import",
        createdAt: ts,
      },
    ],
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
  };
  if (r.posting_url)
    records.artifacts.push({
      id: id("artifact"),
      applicationId: appId,
      kind: "job_posting",
      name: "Posting",
      url: r.posting_url,
      private: true,
      createdAt: ts,
      updatedAt: ts,
    });
  if (r.outreach_message_text)
    records.outreachMessages.push({
      id: id("msg"),
      applicationId: appId,
      direction: "outbound",
      channel: r.outreach_channel || "other",
      body: r.outreach_message_text,
      sentAt: safeIsoDate(r.outreach_sent_at, ts),
      createdAt: ts,
      updatedAt: ts,
    });
  if (r.interview_stage)
    records.interviews.push({
      id: id("interview"),
      applicationId: appId,
      contactIds: [],
      stage: r.interview_stage,
      outcome: "scheduled",
      startsAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
  if (r.outcome === "offer")
    records.offers.push({
      id: id("offer"),
      applicationId: appId,
      status: "received",
      createdAt: ts,
      updatedAt: ts,
    });
  return records;
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
  const count = (s) => b.applications.filter((a) => a.status === s).length;
  const outreach = b.outreachMessages.length,
    interviews = b.interviews.length,
    offers = b.offers.length,
    total = b.applications.length;
  const metrics = [
    ["Total applications", total],
    ["Outreach sent", outreach],
    ["Recruiter screens", count("recruiter_screen")],
    ["Interviews", interviews],
    ["Offers", offers],
    [
      "Response rate",
      total
        ? `${Math.round(((outreach + interviews + offers) / total) * 100)}%`
        : "0%",
    ],
  ];
  $("[data-metrics]").innerHTML = metrics
    .map(
      ([k, v]) =>
        `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`,
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
    out = $('[data-filter="outcome"]').value;
  const hasActiveFilters = Boolean(q || st || out);
  let rows = state.apps.filter((a) => {
    const m = appMeta(a);
    return (
      (!q ||
        [a.company, a.role, a.status, a.notes].some((x) =>
          String(x || "")
            .toLowerCase()
            .includes(q),
        )) &&
      (!st || a.status === st) &&
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
      return `<tr><td><button class="button" data-open="${esc(a.id)}">${esc(a.company)}</button></td><td>${esc(a.role)}</td><td>${esc(a.status)}</td><td>${day(a.appliedAt)}</td><td>${day(a.followUpDate)}</td><td>${m.outreach.length ? "sent" : "none"}</td><td>${esc(m.interviews.at(-1)?.stage || "")}</td><td>${esc(outcomeForApp(a, m))}</td><td>${esc(fitScore(a.notes))}</td><td>${m.artifacts.map(linkForArtifact).join(", ")}</td></tr>`;
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
function detailForm(app) {
  const m = appMeta(app);
  return `<div class="tracker-detail"><article class="card"><h2>${esc(app.company || "New application")} — ${esc(app.role || "Unsaved")}</h2><form class="tracker-form" data-core-form>${input("company", app.company, true)}${input("role", app.role, true)}${input("postingUrl", app.postingUrl, "url")}<label>Status<select name="status" required>${STATUSES.map((s) => `<option ${app.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${input("source", app.source, "text")}${input("appliedAt", day(app.appliedAt), "date", true)}${input("followUpDate", day(app.followUpDate), "date")}<label>Notes<textarea name="notes">${esc(app.notes)}</textarea></label><button class="button">Save application</button></form></article><article class="card"><h3>Lifecycle timeline</h3><ul class="timeline">${
    state.bundle.lifecycleEvents
      .filter((e) => e.applicationId === app.id)
      .map(
        (e) =>
          `<li>${day(e.occurredAt)} ${esc(e.status)} ${esc(e.note || "")}</li>`,
      )
      .join("") || "<li>No events yet.</li>"
  }</ul></article><article class="card"><h3>Links/artifacts</h3><form class="tracker-form" data-artifact-form>${input("name", "", true)}${input("url", "")}<button class="button">Add link/artifact</button></form><ul>${m.artifacts.map((a) => `<li>${linkForArtifact(a)}</li>`).join("")}</ul></article><article class="card"><h3>Outreach messages</h3><form class="tracker-form" data-outreach-form><label>Channel<select name="channel"><option>email</option><option>linkedin</option><option>phone</option><option>sms</option><option>other</option></select></label><label>Message<textarea name="body" required></textarea></label><button class="button">Add outreach</button></form><ul>${m.outreach.map((o) => `<li>${day(o.sentAt)} ${esc(o.channel)} ${esc(o.body)}</li>`).join("")}</ul></article><article class="card"><h3>Interviews</h3><form class="tracker-form" data-interview-form><label>Stage<select name="stage"><option>recruiter_screen</option><option>technical_screen</option><option>onsite_loop</option><option>other</option></select></label>${input("startsAt", day(now()), "date")}<button class="button">Log interview</button></form><ul>${m.interviews.map((i) => `<li>${day(i.startsAt)} ${esc(i.stage)} ${esc(i.outcome)}</li>`).join("")}</ul></article><article class="card"><h3>Offers</h3><form class="tracker-form" data-offer-form><label>Status<select name="status"><option>received</option><option>negotiating</option><option>accepted</option><option>declined</option></select></label>${input("notes", "")}<button class="button">Log offer</button></form><ul>${m.offers.map((o) => `<li>${esc(o.status)} ${esc(o.notes || "")}</li>`).join("")}</ul></article></div>`;
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
async function previewImport() {
  const file = $("[data-import-file]").files[0];
  if (!file) return;
  const rows = parseCsv(await file.text());
  const bundle = {
    applications: [],
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: [],
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
  };
  for (const r of rows) {
    const rec = rowToRecords(r);
    for (const k of Object.keys(bundle)) bundle[k].push(...rec[k]);
  }
  state.preview = bundle;
  $("[data-import-result]").textContent =
    `Dry-run OK: ${bundle.applications.length} applications, ${bundle.outreachMessages.length} outreach messages, ${bundle.interviews.length} interviews.`;
  $("[data-import-apply]").disabled = false;
}
function resetImportPreview() {
  state.preview = null;
  $("[data-import-apply]").disabled = true;
  $("[data-import-result]").textContent =
    "Select Preview/dry-run to validate the selected file before applying.";
}
async function applyImport() {
  if (!state.preview) {
    resetImportPreview();
    return;
  }
  await batchPut(state.preview);
  $("[data-import-result]").textContent = "Import applied.";
  $("[data-import-apply]").disabled = true;
  await refresh();
}
function download(name, type, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
function exportData(fmt) {
  const b = state.bundle;
  if (fmt === "json")
    download(
      "jobbot3000-backup.json",
      "application/json",
      JSON.stringify(b, null, 2),
    );
  else if (fmt === "ndjson") {
    const lines = [
      JSON.stringify({ type: "meta", schemaVersion: 1, exportedAt: now() }),
      ...[
        "applications",
        "contacts",
        "outreachMessages",
        "lifecycleEvents",
        "interviews",
        "offers",
        "artifacts",
        "reminders",
      ].flatMap((s) =>
        b[s].map((record) => JSON.stringify({ type: s, record })),
      ),
    ];
    download(
      "jobbot3000-backup.ndjson",
      "application/x-ndjson",
      lines.join("\n") + "\n",
    );
  } else {
    const head = [
      "application_id",
      "company",
      "role_title",
      "status",
      "applied_at",
      "posting_url",
      "application_channel",
      "follow_up_date",
      "outcome",
      "notes",
    ];
    const rows = b.applications.map((a) => [
      a.id,
      a.company,
      a.role,
      a.status,
      day(a.appliedAt),
      a.postingUrl || "",
      a.source || "",
      day(a.followUpDate),
      OUTCOMES.has(a.status) ? a.status : "",
      a.notes || "",
    ]);
    download("jobbot3000-applications.csv", "text/csv", csv([head, ...rows]));
  }
}
function init() {
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
    if (confirm("Clear all local tracker data?")) {
      await repo.clear();
      refresh();
    }
  };
  refresh();
}
init();
