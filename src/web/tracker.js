/* global document, indexedDB, location, confirm, addEventListener */
/* eslint max-len: off */
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
const CSV_COLUMNS = [
  "application_id",
  "company",
  "role_title",
  "status",
  "applied_at",
  "posting_url",
  "application_url",
  "application_channel",
  "fit_score_100",
  "outreach_status",
  "outreach_target_name",
  "outreach_channel",
  "outreach_sent_at",
  "outreach_message_text",
  "follow_up_date",
  "interview_stage",
  "outcome",
  "notes",
];
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const uid = (prefix = "id") =>
  `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
const iso = (date) => (date ? `${date}T00:00:00.000Z` : undefined);
const day = (value) => (value ? String(value).slice(0, 10) : "");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("jobbot3000", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const txDone = (tx) =>
  new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
const reqP = (req) =>
  new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
async function createRepository() {
  const db = await openDb();
  const all = async (store) => {
    const tx = db.transaction(store);
    const rows = await reqP(tx.objectStore(store).getAll());
    await txDone(tx);
    return rows;
  };
  const put = async (store, record) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(record);
    await txDone(tx);
    return record;
  };
  return {
    close: () => db.close(),
    listApplications: async () =>
      (await all("applications")).sort((a, b) =>
        String(b.appliedAt || "").localeCompare(String(a.appliedAt || "")),
      ),
    getApplication: async (id) => {
      const tx = db.transaction("applications");
      const r = await reqP(tx.objectStore("applications").get(id));
      await txDone(tx);
      return r || null;
    },
    updateApplication: (a) => put("applications", a),
    createApplication: (a) => put("applications", a),
    addOutreachMessage: (r) => put("outreachMessages", r),
    upsertInterview: (r) => put("interviews", r),
    upsertOffer: (r) => put("offers", r),
    upsertArtifact: (r) => put("artifacts", r),
    addLifecycleEvent: (r) => put("lifecycleEvents", r),
    async exportAllData() {
      const out = { schemaVersion: 1, exportedAt: new Date().toISOString() };
      for (const s of STORES) out[s] = await all(s);
      return out;
    },
    async importAllData(bundle, { allowOverwrite = false } = {}) {
      const tx = db.transaction(STORES, "readwrite");
      if (allowOverwrite) for (const s of STORES) tx.objectStore(s).clear();
      for (const s of STORES) {
        for (const r of bundle[s] || []) tx.objectStore(s).put(r);
      }
      await txDone(tx);
      return bundle;
    },
    async clear() {
      const tx = db.transaction(STORES, "readwrite");
      for (const s of STORES) tx.objectStore(s).clear();
      await txDone(tx);
    },
  };
}
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    q = false;
  for (let i = 0; i < String(text).length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  row.push(field);
  if (row.some(Boolean) || rows.length) rows.push(row);
  const headers = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}
const csvField = (v) =>
  /[",\n\r]/.test(String(v ?? ""))
    ? `"${String(v ?? "").replaceAll('"', '""')}"`
    : String(v ?? "");
const serializeCsv = (rows) =>
  [
    CSV_COLUMNS.join(","),
    ...rows.map((r) => CSV_COLUMNS.map((c) => csvField(r[c])).join(",")),
  ].join("\n");
function bundleFromCsv(text) {
  const rows = parseCsv(text),
    now = new Date().toISOString(),
    errors = [];
  const bundle = {
    schemaVersion: 1,
    exportedAt: now,
    applications: [],
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: [],
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
    settings: [],
  };
  rows.forEach((r, i) => {
    for (const f of [
      "company",
      "role_title",
      "posting_url",
      "application_channel",
      "status",
      "applied_at",
    ])
      if (!r[f]) errors.push(`Row ${i + 2}: missing ${f}`);
    const id = r.application_id || uid("app");
    const app = {
      id,
      company: r.company,
      role: r.role_title,
      status: r.status || "applied",
      appliedAt: iso(r.applied_at) || now,
      postingUrl: r.posting_url,
      applicationUrl: r.application_url || undefined,
      source: r.application_channel,
      followUpDate: iso(r.follow_up_date),
      fitScore: r.fit_score_100 ? Number(r.fit_score_100) : undefined,
      notes: r.notes || "",
      createdAt: now,
      updatedAt: now,
      metadata: {
        outreachStatus: r.outreach_status || "",
        interviewStage: r.interview_stage || "",
        outcome: r.outcome || "",
      },
    };
    bundle.applications.push(app);
    bundle.lifecycleEvents.push({
      id: uid("event"),
      applicationId: id,
      status: app.status,
      occurredAt: app.appliedAt,
      note: "Imported from CSV",
      createdAt: now,
    });
    if (r.outreach_message_text || r.outreach_sent_at)
      bundle.outreachMessages.push({
        id: uid("msg"),
        applicationId: id,
        channel: r.outreach_channel || "email",
        sentAt: r.outreach_sent_at || now,
        body: r.outreach_message_text || "",
        createdAt: now,
      });
  });
  return { rowCount: rows.length, errors, bundle };
}
function rowsFromBundle(bundle) {
  return (bundle.applications || []).map((a) => {
    const msg =
      (bundle.outreachMessages || []).find((m) => m.applicationId === a.id) ||
      {};
    return {
      application_id: a.id,
      company: a.company,
      role_title: a.role,
      status: a.status,
      applied_at: day(a.appliedAt),
      posting_url: a.postingUrl,
      application_url: a.applicationUrl,
      application_channel: a.source,
      fit_score_100: a.fitScore ?? "",
      outreach_status: a.metadata?.outreachStatus || "",
      outreach_channel: msg.channel || "",
      outreach_sent_at: msg.sentAt || "",
      outreach_message_text: msg.body || "",
      follow_up_date: day(a.followUpDate),
      interview_stage: a.metadata?.interviewStage || "",
      outcome: a.metadata?.outcome || "",
      notes: a.notes || "",
    };
  });
}
let repo,
  state = { apps: [], bundle: null, selected: null, csv: null, preview: null };
async function refresh() {
  state.apps = await repo.listApplications();
  state.bundle = await repo.exportAllData();
  renderAll();
}
function renderAll() {
  renderMetrics();
  renderApps();
  renderFollowups();
  renderOutreach();
}
function renderMetrics() {
  const apps = state.apps,
    b = state.bundle || {};
  const count = (pred) => apps.filter(pred).length;
  const metrics = [
    ["Total applications", apps.length],
    [
      "Outreach sent",
      (b.outreachMessages || []).length ||
        count((a) => a.status === "outreach_sent"),
    ],
    ["Recruiter screens", count((a) => a.status === "recruiter_screen")],
    [
      "Interviews",
      count((a) => ["technical_screen", "onsite_loop"].includes(a.status)),
    ],
    ["Offers", count((a) => ["offer", "accepted"].includes(a.status))],
    [
      "Response rate",
      apps.length
        ? `${Math.round((count((a) => !["applied", "closed_archived"].includes(a.status)) / apps.length) * 100)}%`
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
  apps.forEach((a) => {
    const d = day(a.appliedAt);
    if (d) {
      const key = d.slice(0, 7);
      weeks[key] = (weeks[key] || 0) + 1;
    }
  });
  $("[data-weekly]").innerHTML =
    Object.entries(weeks)
      .sort()
      .map(([k, v]) => `<span>${esc(k)}: ${v}</span>`)
      .join("") || '<p class="muted">No applications yet.</p>';
}
function filteredApps() {
  const f = $("[data-app-filters]"),
    q = $('[data-filter="search"]', f).value.toLowerCase(),
    status = $('[data-filter="status"]', f).value,
    sort = $('[data-filter="sort"]', f).value;
  return state.apps
    .filter(
      (a) =>
        (!status || a.status === status) &&
        `${a.company} ${a.role}`.toLowerCase().includes(q),
    )
    .sort((a, b) =>
      sort === "fitScore"
        ? (b.fitScore || 0) - (a.fitScore || 0)
        : String(a[sort] || "").localeCompare(String(b[sort] || "")),
    );
}
function renderApps() {
  const tbody = $("[data-app-table] tbody"),
    apps = filteredApps();
  $("[data-empty-apps]").textContent = apps.length
    ? ""
    : "No applications yet. Create one or import compact CSV.";
  tbody.innerHTML = apps
    .map(
      (a) =>
        `<tr><td><button class="button ghost" data-select="${esc(a.id)}">${esc(a.company)}</button></td><td>${esc(a.role)}</td><td>${esc(a.status)}</td><td>${day(a.appliedAt)}</td><td>${day(a.followUpDate)}</td><td>${esc(a.metadata?.outreachStatus || "")}</td><td>${esc(a.metadata?.interviewStage || "")}</td><td>${esc(a.metadata?.outcome || "")}</td><td>${a.fitScore ?? ""}</td><td>${a.postingUrl ? `<a href="${esc(a.postingUrl)}">Posting</a>` : ""}</td></tr>`,
    )
    .join("");
  renderDetail();
}
function renderDetail() {
  const a = state.apps.find((x) => x.id === state.selected),
    el = $("[data-detail]");
  if (!a) {
    el.innerHTML =
      "<p>Select an application to view details and lifecycle timeline.</p>";
    return;
  }
  const b = state.bundle;
  const events = [
    ...(b.lifecycleEvents || []).filter((e) => e.applicationId === a.id),
    ...(b.outreachMessages || [])
      .filter((m) => m.applicationId === a.id)
      .map((m) => ({ occurredAt: m.sentAt, status: "outreach", note: m.body })),
    ...(b.interviews || [])
      .filter((i) => i.applicationId === a.id)
      .map((i) => ({
        occurredAt: i.scheduledAt,
        status: i.stage,
        note: i.notes,
      })),
    ...(b.offers || [])
      .filter((o) => o.applicationId === a.id)
      .map((o) => ({
        occurredAt: o.receivedAt,
        status: "offer",
        note: o.notes,
      })),
  ].sort((x, y) =>
    String(y.occurredAt || "").localeCompare(String(x.occurredAt || "")),
  );
  el.innerHTML = `<div class="section-head"><h3>${esc(a.company)} — ${esc(a.role)}</h3><button class="button" data-edit="${esc(a.id)}">Edit</button></div><p><span class="pill">${esc(a.status)}</span> ${esc(a.metadata?.outcome || "")}</p><p>${esc(a.notes || "")}</p><div class="actions"><button class="button ghost" data-log="outreach">Add outreach message</button><button class="button ghost" data-log="interview">Log interview</button><button class="button ghost" data-log="offer">Log offer</button><button class="button ghost" data-mark-followup>Mark follow-up done</button></div><h4>Lifecycle timeline</h4><ul class="timeline">${events.map((e) => `<li><strong>${day(e.occurredAt)}</strong> ${esc(e.status)} — ${esc(e.note || "")}</li>`).join("") || "<li>No events yet.</li>"}</ul>`;
}
function renderFollowups() {
  const today = day(new Date().toISOString());
  const groups = { Overdue: [], "Due today": [], Upcoming: [] };
  state.apps
    .filter((a) => a.followUpDate)
    .forEach((a) => {
      const d = day(a.followUpDate);
      (d < today
        ? groups.Overdue
        : d === today
          ? groups["Due today"]
          : groups.Upcoming
      ).push(a);
    });
  $("[data-followups]").innerHTML = Object.entries(groups)
    .map(
      ([name, items]) =>
        `<section class="card"><h3>${name}</h3>${items.map((a) => `<p><strong>${esc(a.company)}</strong> ${esc(a.role)} (${day(a.followUpDate)}) <button class="button ghost" data-done="${esc(a.id)}">Mark done</button> <button class="button ghost" data-snooze="${esc(a.id)}">Snooze</button></p>`).join("") || '<p class="muted">None.</p>'}</section>`,
    )
    .join("");
}
function renderOutreach() {
  const b = state.bundle || {};
  $("[data-outreach-list]").innerHTML =
    (b.outreachMessages || [])
      .map((m) => {
        const a = state.apps.find((x) => x.id === m.applicationId) || {};
        return `<section class="card"><strong>${esc(a.company || m.applicationId)}</strong><p>${esc(m.channel)} ${day(m.sentAt)}</p><p>${esc(m.body)}</p></section>`;
      })
      .join("") || '<p class="empty">No outreach recorded yet.</p>';
}
async function saveForm(form) {
  const fd = Object.fromEntries(new FormData(form));
  const now = new Date().toISOString();
  const existing = fd.id ? await repo.getApplication(fd.id) : null;
  const app = {
    ...(existing || {}),
    id: fd.id || uid("app"),
    company: fd.company,
    role: fd.role,
    postingUrl: fd.postingUrl,
    applicationUrl: fd.applicationUrl || undefined,
    source: fd.source,
    status: fd.status,
    appliedAt: iso(fd.appliedAt),
    followUpDate: iso(fd.followUpDate),
    fitScore: fd.fitScore ? Number(fd.fitScore) : undefined,
    notes: fd.notes || "",
    metadata: {
      outreachStatus: fd.outreachStatus || "",
      interviewStage: fd.interviewStage || "",
      outcome: fd.outcome || "",
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await (existing ? repo.updateApplication(app) : repo.createApplication(app));
  await repo.addLifecycleEvent({
    id: uid("event"),
    applicationId: app.id,
    status: app.status,
    occurredAt: now,
    note: existing ? "Application updated" : "Application created",
    createdAt: now,
  });
  state.selected = app.id;
  await refresh();
}
function openForm(app) {
  const d = $("[data-dialog]"),
    f = $("[data-app-form]");
  f.reset();
  $("[data-form-title]").textContent = app
    ? "Edit application"
    : "New application";
  for (const s of $$('select[name=status], [data-filter="status"]'))
    if (!s.dataset.ready) {
      s.insertAdjacentHTML(
        "beforeend",
        STATUSES.map(
          (x) => `<option value="${x}">${x.replaceAll("_", " ")}</option>`,
        ).join(""),
      );
      s.dataset.ready = "1";
    }
  if (app) {
    for (const [k, v] of Object.entries({
      id: app.id,
      company: app.company,
      role: app.role,
      postingUrl: app.postingUrl,
      source: app.source,
      status: app.status,
      appliedAt: day(app.appliedAt),
      followUpDate: day(app.followUpDate),
      outreachStatus: app.metadata?.outreachStatus,
      interviewStage: app.metadata?.interviewStage,
      outcome: app.metadata?.outcome,
      fitScore: app.fitScore,
      applicationUrl: app.applicationUrl,
      notes: app.notes,
    }))
      if (f.elements[k]) f.elements[k].value = v ?? "";
  }
  d.showModal();
}
function download(name, type, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function route() {
  const id = location.hash.slice(1) || "dashboard";
  $$(".view").forEach((v) => (v.hidden = v.id !== id));
  $$(".tabs a").forEach((a) =>
    a.setAttribute("aria-current", a.hash === `#${id}`),
  );
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button,a");
  if (!t) return;
  if (t.matches("[data-new-application]")) openForm();
  if (t.dataset.select) {
    state.selected = t.dataset.select;
    renderDetail();
  }
  if (t.dataset.edit) openForm(state.apps.find((a) => a.id === t.dataset.edit));
  if (t.dataset.done) {
    const a = await repo.getApplication(t.dataset.done);
    a.followUpDate = undefined;
    await repo.updateApplication(a);
    await refresh();
  }
  if (t.dataset.snooze) {
    const a = await repo.getApplication(t.dataset.snooze);
    const d = new Date();
    d.setDate(d.getDate() + 7);
    a.followUpDate = d.toISOString();
    await repo.updateApplication(a);
    await refresh();
  }
  if (t.dataset.markFollowup !== undefined && state.selected) {
    const a = await repo.getApplication(state.selected);
    a.followUpDate = undefined;
    await repo.updateApplication(a);
    await refresh();
  }
  if (t.dataset.log && state.selected) {
    const now = new Date().toISOString();
    if (t.dataset.log === "outreach")
      await repo.addOutreachMessage({
        id: uid("msg"),
        applicationId: state.selected,
        channel: "email",
        sentAt: now,
        body: "Outreach message recorded from detail view.",
        createdAt: now,
      });
    if (t.dataset.log === "interview")
      await repo.upsertInterview({
        id: uid("int"),
        applicationId: state.selected,
        stage: "recruiter_screen",
        scheduledAt: now,
        notes: "Interview logged from detail view.",
        createdAt: now,
        updatedAt: now,
      });
    if (t.dataset.log === "offer")
      await repo.upsertOffer({
        id: uid("offer"),
        applicationId: state.selected,
        status: "received",
        receivedAt: now,
        notes: "Offer logged from detail view.",
        createdAt: now,
        updatedAt: now,
      });
    await refresh();
  }
  if (t.matches("[data-preview-import]")) {
    const file = $("[data-csv-file]").files[0];
    state.csv = file ? await file.text() : "";
    state.preview = bundleFromCsv(state.csv);
    $("[data-import-preview]").textContent =
      `Rows: ${state.preview.rowCount}\nErrors: ${state.preview.errors.length}\n${state.preview.errors.join("\n")}`;
    $("[data-apply-import]").disabled = state.preview.errors.length > 0;
  }
  if (t.matches("[data-apply-import]") && state.preview) {
    await repo.importAllData(state.preview.bundle, { allowOverwrite: false });
    await refresh();
    $("[data-import-preview]").textContent += "\nImport applied.";
  }
  if (t.dataset.export) {
    const b = await repo.exportAllData();
    if (t.dataset.export === "csv")
      download(
        "jobbot-applications.csv",
        "text/csv",
        serializeCsv(rowsFromBundle(b)),
      );
    if (t.dataset.export === "json")
      download(
        "jobbot-backup.json",
        "application/json",
        JSON.stringify(b, null, 2),
      );
    if (t.dataset.export === "ndjson")
      download(
        "jobbot-backup.ndjson",
        "application/x-ndjson",
        [
          JSON.stringify({
            type: "meta",
            schemaVersion: 1,
            exportedAt: b.exportedAt,
          }),
          ...STORES.flatMap((s) =>
            (b[s] || []).map((r) => JSON.stringify({ type: s, record: r })),
          ),
        ].join("\n") + "\n",
      );
  }
  if (
    t.matches("[data-clear-data]") &&
    confirm("Clear all local tracker data?")
  ) {
    await repo.clear();
    state.selected = null;
    await refresh();
  }
});
$("[data-app-form]").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.submitter?.value === "cancel") return $("[data-dialog]").close();
  await saveForm(e.currentTarget);
  $("[data-dialog]").close();
});
$("[data-app-filters]").addEventListener("input", renderApps);
addEventListener("hashchange", route);
repo = await createRepository();
openForm();
$("[data-dialog]").close();
route();
await refresh();
