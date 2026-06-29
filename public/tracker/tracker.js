/* global document, indexedDB, confirm */
/* eslint-disable max-len */
const statuses = [
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
const stores = [
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
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const now = () => new Date().toISOString();
const id = (p) => `${p}_${crypto.randomUUID()}`;
const dayIso = (d) => (d ? `${d}T12:00:00.000Z` : undefined);
const dateOnly = (v) => (v ? String(v).slice(0, 10) : "");
class BrowserTrackerRepository {
  constructor(db) {
    this.db = db;
  }
  static open() {
    return new Promise((res, rej) => {
      const q = indexedDB.open("jobbot3000", 1);
      q.onupgradeneeded = () => {
        const db = q.result;
        for (const s of stores) {
          if (!db.objectStoreNames.contains(s))
            db.createObjectStore(s, { keyPath: "id" });
        }
      };
      q.onsuccess = () => res(new BrowserTrackerRepository(q.result));
      q.onerror = () => rej(q.error);
    });
  }
  tx(s, m = "readonly") {
    return this.db.transaction(s, m).objectStore(s);
  }
  all(s) {
    return new Promise((res, rej) => {
      const q = this.tx(s).getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }
  put(s, r) {
    return new Promise((res, rej) => {
      const q = this.tx(s, "readwrite").put(r);
      q.onsuccess = () => res(r);
      q.onerror = () => rej(q.error);
    });
  }
  del(s, k) {
    return new Promise((res, rej) => {
      const q = this.tx(s, "readwrite").delete(k);
      q.onsuccess = () => res();
      q.onerror = () => rej(q.error);
    });
  }
  clear() {
    return Promise.all(
      stores.map(
        (s) =>
          new Promise((res, rej) => {
            const q = this.tx(s, "readwrite").clear();
            q.onsuccess = res;
            q.onerror = () => rej(q.error);
          }),
      ),
    );
  }
  async exportAllData() {
    const o = { schemaVersion: 1, exportedAt: now() };
    for (const s of stores) o[s] = await this.all(s);
    o.settings = o.settings[0];
    return o;
  }
  async importAllData(data) {
    await this.clear();
    for (const s of stores.filter((x) => x !== "settings"))
      for (const r of data[s] || []) await this.put(s, r);
    if (data.settings) await this.put("settings", data.settings);
  }
}
let repo,
  state = {
    applications: [],
    artifacts: [],
    outreachMessages: [],
    interviews: [],
    offers: [],
    lifecycleEvents: [],
  },
  pendingImport = null;
const labels = new Map(statuses.map((s) => [s, s.replaceAll("_", " ")]));
function csvRows(text) {
  const lines = text.trim().split(/\r?\n/);
  const h = lines
    .shift()
    .split(",")
    .map((x) => x.trim());
  return lines
    .filter(Boolean)
    .map((l) =>
      Object.fromEntries(
        l.split(",").map((v, i) => [h[i], v.trim().replace(/^"|"$/g, "")]),
      ),
    );
}
function toCsv(rows) {
  const cols = [
    "company",
    "role",
    "status",
    "appliedAt",
    "followUpDate",
    "postingUrl",
    "source",
    "outreachStatus",
    "interviewStage",
    "outcome",
    "fitScore",
    "notes",
  ];
  return [
    cols.join(","),
    ...rows.map((r) =>
      cols
        .map((c) => `"${String(r[c] ?? "").replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\n");
}
function download(name, type, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
async function load() {
  for (const s of [
    "applications",
    "artifacts",
    "outreachMessages",
    "interviews",
    "offers",
    "lifecycleEvents",
  ])
    state[s] = await repo.all(s);
  render();
}
function render() {
  renderAnalytics();
  renderApps();
  renderFollowups();
  renderOutreach();
}
function renderAnalytics() {
  const apps = state.applications;
  const count = (s) => apps.filter((a) => a.status === s).length;
  const outreach =
    state.outreachMessages.length ||
    apps.filter((a) => a.outreachStatus).length;
  const metrics = [
    ["Total applications", apps.length],
    ["Outreach sent", outreach],
    ["Recruiter screens", count("recruiter_screen")],
    [
      "Interviews",
      state.interviews.length +
        count("technical_screen") +
        count("onsite_loop"),
    ],
    ["Offers", count("offer") + state.offers.length],
    [
      "Response rate",
      apps.length
        ? `${Math.round(((outreach ? count("recruiter_screen") + count("technical_screen") + count("onsite_loop") + count("offer") : 0) / apps.length) * 100)}%`
        : "0%",
    ],
  ];
  $("#analytics").innerHTML = metrics
    .map(([k, v]) => `<div class="metric"><strong>${v}</strong>${k}</div>`)
    .join("");
  const weeks = {};
  apps.forEach((a) => {
    const d = new Date(a.appliedAt || a.createdAt);
    const k = `${d.getUTCFullYear()}-W${Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)}`;
    weeks[k] = (weeks[k] || 0) + 1;
  });
  const max = Math.max(1, ...Object.values(weeks));
  $("#weekly-counts").innerHTML =
    Object.entries(weeks)
      .slice(-8)
      .map(
        ([k, v]) =>
          `<div class="bar"><span style="height:${20 + (80 * v) / max}px"></span>${k}<b>${v}</b></div>`,
      )
      .join("") || '<p class="empty">No weekly data yet.</p>';
}
function renderApps() {
  const q = $("#application-filter").value.toLowerCase(),
    sort = $("#application-sort").value;
  const rows = [...state.applications]
    .filter((a) => JSON.stringify(a).toLowerCase().includes(q))
    .sort((a, b) => String(b[sort] ?? "").localeCompare(String(a[sort] ?? "")));
  $("#applications-empty").hidden = rows.length > 0;
  $("#applications-table tbody").innerHTML = rows
    .map((a) => {
      const arts = state.artifacts.filter((x) => x.applicationId === a.id);
      return `<tr><td>${a.company}</td><td>${a.role}</td><td>${labels.get(a.status) || a.status}</td><td>${dateOnly(a.appliedAt)}</td><td>${dateOnly(a.followUpDate)}</td><td>${a.outreachStatus || ""}</td><td>${a.interviewStage || ""}</td><td>${a.outcome || ""}</td><td>${a.fitScore ?? ""}</td><td>${arts.map((x) => (x.url ? `<a href="${x.url}"> ${x.name}</a>` : x.name)).join("<br>")}</td><td><button class="button" data-edit="${a.id}">View/edit</button></td></tr>`;
    })
    .join("");
}
function bucket(a) {
  const d = dateOnly(a.followUpDate),
    t = dateOnly(now());
  return d < t ? "overdue" : d === t ? "today" : "upcoming";
}
function renderFollowups() {
  for (const k of ["overdue", "today", "upcoming"])
    $(`#followups-${k}`).innerHTML = "";
  state.applications
    .filter((a) => a.followUpDate)
    .forEach((a) => {
      const el = document.createElement("div");
      el.className = "follow-card";
      el.innerHTML = `<strong>${a.company}</strong><br>${a.role}<br>Due ${dateOnly(a.followUpDate)}<div class="actions"><button class="button" data-done="${a.id}">Mark done</button><button class="button" data-snooze="${a.id}">Snooze 7 days</button></div>`;
      $(`#followups-${bucket(a)}`).append(el);
    });
  for (const k of ["overdue", "today", "upcoming"])
    if (!$(`#followups-${k}`).children.length)
      $(`#followups-${k}`).innerHTML = '<p class="empty">None.</p>';
}
function renderOutreach() {
  const messages = state.outreachMessages;
  $("#outreach-list").innerHTML =
    messages
      .map(
        (m) =>
          `<div class="card"><strong>${state.applications.find((a) => a.id === m.applicationId)?.company || "Application"}</strong><p>${m.body || m.subject || "Outreach recorded"}</p><small>${dateOnly(m.sentAt || m.createdAt)}</small></div>`,
      )
      .join("") || '<p class="empty">No outreach messages yet.</p>';
}
function openForm(app = {}) {
  const f = $("#application-form");
  f.reset();
  f.id.value = app.id || "";
  for (const k of [
    "company",
    "role",
    "postingUrl",
    "source",
    "status",
    "notes",
    "outcome",
    "interviewStage",
    "fitScore",
  ])
    if (f[k]) f[k].value = app[k] || "";
  f.appliedAt.value = dateOnly(app.appliedAt) || dateOnly(now());
  f.followUpDate.value = dateOnly(app.followUpDate);
  $("#dialog-title").textContent = app.id
    ? "Application detail"
    : "New application";
  $("#artifact-fields").innerHTML =
    state.artifacts
      .filter((a) => a.applicationId === app.id)
      .map((a) => artifactRow(a.name, a.url))
      .join("") || artifactRow("Posting", app.postingUrl || "");
  $("#timeline").innerHTML =
    state.lifecycleEvents
      .filter((e) => e.applicationId === app.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .map(
        (e) => `<li>${dateOnly(e.occurredAt)} — ${labels.get(e.status)}</li>`,
      )
      .join("") || "<li>No lifecycle events yet.</li>";
  $("#application-dialog").showModal();
}
function artifactRow(name = "", url = "") {
  return `<div class="form-grid artifact-row"><label>Name<input name="artifactName" value="${name}"></label><label>URL<input name="artifactUrl" type="url" value="${url}"></label></div>`;
}
async function saveForm(e) {
  e.preventDefault();
  const f = e.currentTarget,
    t = now(),
    existing = state.applications.find((a) => a.id === f.id.value);
  const app = {
    ...existing,
    id: f.id.value || id("app"),
    company: f.company.value,
    role: f.role.value,
    postingUrl: f.postingUrl.value,
    source: f.source.value,
    status: f.status.value,
    appliedAt: dayIso(f.appliedAt.value),
    followUpDate: dayIso(f.followUpDate.value),
    fitScore: f.fitScore.value ? Number(f.fitScore.value) : undefined,
    outcome: f.outcome.value || undefined,
    interviewStage: f.interviewStage.value || undefined,
    notes: f.notes.value || undefined,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  await repo.put("applications", app);
  await repo.put("lifecycleEvents", {
    id: id("event"),
    applicationId: app.id,
    status: app.status,
    occurredAt: t,
    source: "manual",
    note: "Updated in tracker UI",
    createdAt: t,
  });
  for (const row of $$(".artifact-row")) {
    const name = $("[name=artifactName]", row).value,
      url = $("[name=artifactUrl]", row).value;
    if (name || url)
      await repo.put("artifacts", {
        id: id("artifact"),
        applicationId: app.id,
        kind: "link",
        name: name || url,
        url: url || undefined,
        private: true,
        createdAt: t,
        updatedAt: t,
      });
  }
  if (f.outreachBody.value)
    await repo.put("outreachMessages", {
      id: id("message"),
      applicationId: app.id,
      direction: "outbound",
      channel: "email",
      body: f.outreachBody.value,
      sentAt: t,
      createdAt: t,
      updatedAt: t,
    });
  if (f.interviewNotes.value)
    await repo.put("interviews", {
      id: id("interview"),
      applicationId: app.id,
      stage: app.interviewStage || "other",
      startsAt: t,
      preparationNotes: f.interviewNotes.value,
      outcome: "completed",
      createdAt: t,
      updatedAt: t,
      contactIds: [],
    });
  if (f.offerNotes.value)
    await repo.put("offers", {
      id: id("offer"),
      applicationId: app.id,
      status: "received",
      notes: f.offerNotes.value,
      createdAt: t,
      updatedAt: t,
    });
  $("#application-dialog").close();
  await load();
}
async function previewImport() {
  const file = $("#csv-file").files[0];
  if (!file) return;
  const rows = csvRows(await file.text());
  pendingImport = rows.map((r) => ({
    id: r.application_id || id("app"),
    company: r.company,
    role: r.role_title || r.role,
    status: r.status || "applied",
    appliedAt: dayIso((r.applied_at || "").slice(0, 10)),
    postingUrl: r.posting_url || r.postingUrl,
    source: r.application_channel || r.source || "import",
    followUpDate: dayIso((r.follow_up_date || "").slice(0, 10)),
    outreachStatus: r.outreach_status,
    interviewStage: r.interview_stage,
    outcome: r.outcome,
    fitScore: r.fit_score_100 ? Number(r.fit_score_100) : undefined,
    notes: r.notes,
    createdAt: now(),
    updatedAt: now(),
  }));
  $("#import-preview").textContent =
    `Dry-run: ${pendingImport.length} applications ready. Existing records are preserved; matching ids are updated.`;
  $("#apply-import").disabled = false;
}
async function applyImport() {
  for (const a of pendingImport || []) await repo.put("applications", a);
  $("#import-preview").textContent =
    `Imported ${(pendingImport || []).length} applications.`;
  pendingImport = null;
  $("#apply-import").disabled = true;
  await load();
}
function switchSection(name) {
  $$("[data-section-tab]").forEach((b) =>
    b.setAttribute(
      "aria-current",
      b.dataset.sectionTab === name ? "page" : "false",
    ),
  );
  $$(".panel").forEach((p) => (p.hidden = p.id !== name));
  $(`#${name}`).focus();
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.sectionTab) switchSection(b.dataset.sectionTab);
  if (b.id === "new-application-button") openForm();
  if (b.dataset.edit)
    openForm(state.applications.find((a) => a.id === b.dataset.edit));
  if (b.id === "add-artifact")
    $("#artifact-fields").insertAdjacentHTML("beforeend", artifactRow());
  if (b.id === "cancel-dialog") $("#application-dialog").close();
  if (b.id === "preview-import") previewImport();
  if (b.id === "apply-import") applyImport();
  if (b.id === "export-json")
    download(
      "jobbot3000-backup.json",
      "application/json",
      JSON.stringify(await repo.exportAllData(), null, 2),
    );
  if (b.id === "export-ndjson") {
    const data = await repo.exportAllData();
    download(
      "jobbot3000-backup.ndjson",
      "application/x-ndjson",
      stores
        .flatMap((s) =>
          (s === "settings"
            ? data.settings
              ? [data.settings]
              : []
            : data[s] || []
          ).map((r) => JSON.stringify({ store: s, record: r })),
        )
        .join("\n"),
    );
  }
  if (b.id === "export-csv")
    download(
      "jobbot3000-applications.csv",
      "text/csv",
      toCsv(state.applications),
    );
  if (b.dataset.done) {
    const a = state.applications.find((x) => x.id === b.dataset.done);
    delete a.followUpDate;
    a.updatedAt = now();
    await repo.put("applications", a);
    await load();
  }
  if (b.dataset.snooze) {
    const a = state.applications.find((x) => x.id === b.dataset.snooze);
    a.followUpDate = new Date(Date.now() + 7 * 864e5).toISOString();
    a.updatedAt = now();
    await repo.put("applications", a);
    await load();
  }
  if (b.id === "reset-demo" && confirm("Clear all local tracker data?")) {
    await repo.clear();
    await load();
  }
});
$("#application-filter").addEventListener("input", renderApps);
$("#application-sort").addEventListener("change", renderApps);
$("#application-form").addEventListener("submit", saveForm);
$("select[name=status]").innerHTML = statuses
  .map((s) => `<option value="${s}">${labels.get(s)}</option>`)
  .join("");
repo = await BrowserTrackerRepository.open();
await load();
switchSection("dashboard");
