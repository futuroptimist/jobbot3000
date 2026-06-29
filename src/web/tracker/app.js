/* global document, indexedDB, location, prompt, confirm, addEventListener */
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
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const now = () => new Date().toISOString();
const id = (p = "id") =>
  `${p}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (s) => (s ? String(s).slice(0, 10) : "");
class TrackerRepository {
  constructor(db) {
    this.db = db;
  }
  static open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open("jobbot3000", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const n of STORES) {
          if (!db.objectStoreNames.contains(n)) {
            const st = db.createObjectStore(n, { keyPath: "id" });
            if (n !== "settings")
              st.createIndex("by_applicationId", "applicationId", {
                unique: false,
              });
          }
        }
      };
      req.onsuccess = () => res(new TrackerRepository(req.result));
      req.onerror = () => rej(req.error);
    });
  }
  tx(n, m = "readonly") {
    return this.db.transaction(n, m).objectStore(n);
  }
  all(n) {
    return new Promise((res, rej) => {
      const r = this.tx(n).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  put(n, v) {
    return new Promise((res, rej) => {
      const r = this.tx(n, "readwrite").put(v);
      r.onsuccess = () => res(v);
      r.onerror = () => rej(r.error);
    });
  }
  add(n, v) {
    return new Promise((res, rej) => {
      const r = this.tx(n, "readwrite").add(v);
      r.onsuccess = () => res(v);
      r.onerror = () => rej(r.error);
    });
  }
  get(n, k) {
    return new Promise((res, rej) => {
      const r = this.tx(n).get(k);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async clear() {
    await Promise.all(
      STORES.map(
        (n) =>
          new Promise((res, rej) => {
            const r = this.tx(n, "readwrite").clear();
            r.onsuccess = res;
            r.onerror = () => rej(r.error);
          }),
      ),
    );
  }
  async exportAllData() {
    const data = { schemaVersion: 1, exportedAt: now() };
    for (const n of STORES) data[n] = await this.all(n);
    data.settings = data.settings[0];
    return data;
  }
  async importAllData(data) {
    await this.clear();
    for (const n of STORES.filter((n) => n !== "settings"))
      for (const r of data[n] || []) await this.put(n, r);
    if (data.settings) await this.put("settings", data.settings);
  }
}
const parseCsv = (t) => {
  const rows = [];
  let r = [],
    f = "",
    q = false;
  for (let i = 0; i < String(t).length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      r.push(f);
      f = "";
    } else if (c === "\n") {
      r.push(f);
      rows.push(r);
      r = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  r.push(f);
  if (r.some(Boolean)) rows.push(r);
  const h = (rows.shift() || []).map((x) => x.trim());
  return rows
    .filter((x) => x.some(Boolean))
    .map((v) => Object.fromEntries(h.map((k, i) => [k, v[i] || ""])));
};
const toCsv = (rows) => {
  const cols = [
    "application_id",
    "company",
    "role_title",
    "status",
    "applied_at",
    "posting_url",
    "application_channel",
    "follow_up_date",
    "outreach_status",
    "interview_stage",
    "outcome",
    "fit_score_100",
    "notes",
  ];
  const cell = (v) =>
    /[",\n]/.test((v = String(v ?? ""))) ? `"${v.replaceAll('"', '""')}"` : v;
  return [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => cell(r[c])).join(",")),
  ].join("\n");
};
const bundleFromCsv = (txt) => {
  const ts = now();
  const apps = parseCsv(txt).map((r) => ({
    id: r.application_id || id("app"),
    company: r.company || "Unknown company",
    role: r.role_title || r.role || "Unknown role",
    status: STATUSES.includes(r.status) ? r.status : "applied",
    source: r.application_channel || undefined,
    postingUrl: r.posting_url || undefined,
    appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : ts,
    followUpDate: r.follow_up_date
      ? new Date(r.follow_up_date).toISOString()
      : undefined,
    notes: [
      r.notes,
      r.fit_score_100 && `fit_score_100:${r.fit_score_100}`,
      r.outreach_status && `outreach_status:${r.outreach_status}`,
      r.interview_stage && `interview_stage:${r.interview_stage}`,
      r.outcome && `outcome:${r.outcome}`,
    ]
      .filter(Boolean)
      .join("\n"),
    createdAt: ts,
    updatedAt: ts,
  }));
  return {
    schemaVersion: 1,
    exportedAt: ts,
    applications: apps,
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: apps.map((a) => ({
      id: id("event"),
      applicationId: a.id,
      status: a.status,
      occurredAt: a.appliedAt || ts,
      source: "csv_import",
      createdAt: ts,
    })),
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
  };
};
let repo,
  state = { apps: [], bundle: null, selected: null };
function meta(app, k) {
  return (
    (app.notes || "")
      .split(/\n/)
      .find((l) => l.startsWith(`${k}:`))
      ?.slice(k.length + 1) || ""
  );
}
function sortApps(apps) {
  const [k, d] = ($("[name=sort]")?.value || "appliedAt:desc").split(":");
  return [...apps].sort(
    (a, b) =>
      String(a[k] || "").localeCompare(String(b[k] || "")) *
      (d === "desc" ? -1 : 1),
  );
}
async function load() {
  state.bundle = await repo.exportAllData();
  state.apps = state.bundle.applications;
  render();
}
function render() {
  renderNav();
  renderStatusOptions();
  renderMetrics();
  renderTable();
  renderFollowups();
  renderOutreach();
}
function renderNav() {
  const h = location.hash || "#dashboard";
  $$(".tabs a").forEach((a) => a.setAttribute("aria-current", a.hash === h));
}
function renderStatusOptions() {
  const s = $("[name=status]");
  if (s && s.options.length === 1)
    STATUSES.forEach((x) =>
      s.insertAdjacentHTML("beforeend", `<option>${x}</option>`),
    );
}
function renderMetrics() {
  const b = state.bundle,
    a = state.apps,
    out = b.outreachMessages.length,
    inter = b.interviews.length,
    offers = b.offers.length;
  const recruiter = a.filter((x) => x.status === "recruiter_screen").length;
  const rate = a.length
    ? Math.round(((out + recruiter + inter + offers) / a.length) * 100)
    : 0;
  $("[data-metrics]").innerHTML = [
    ["Total applications", a.length],
    ["Outreach sent", out],
    ["Recruiter screens", recruiter],
    ["Interviews", inter],
    ["Offers", offers],
    ["Response rate", `${rate}%`],
  ]
    .map(
      ([l, v]) =>
        `<div class="metric"><span>${l}</span><strong>${v}</strong></div>`,
    )
    .join("");
  const weeks = {};
  a.forEach((x) => {
    const w = date(x.appliedAt);
    weeks[w] = (weeks[w] || 0) + 1;
  });
  $("[data-weekly]").textContent = `Weekly application count: ${
    Object.entries(weeks)
      .slice(-8)
      .map(([d, c]) => `${d}: ${c}`)
      .join(" • ") || "No applications yet"
  }`;
}
function renderTable() {
  const q = $("[name=search]").value.toLowerCase(),
    st = $("[name=status]").value;
  const rows = sortApps(
    state.apps.filter(
      (a) =>
        (!st || a.status === st) &&
        `${a.company} ${a.role} ${a.status}`.toLowerCase().includes(q),
    ),
  );
  $("[data-empty]").hidden = rows.length > 0;
  $("tbody", $("[data-applications-table]")).innerHTML = rows
    .map(
      (a) =>
        `<tr><td><button class="linklike" data-open="${esc(a.id)}">${esc(a.company)}</button></td><td>${esc(a.role)}</td><td>${esc(a.status)}</td><td>${date(a.appliedAt)}</td><td>${date(a.followUpDate)}</td><td>${esc(meta(a, "outreach_status"))}</td><td>${esc(meta(a, "interview_stage"))}</td><td>${esc(meta(a, "outcome"))}</td><td>${esc(meta(a, "fit_score_100"))}</td><td>${a.postingUrl ? `<a href="${esc(a.postingUrl)}">Posting</a>` : ""}</td></tr>`,
    )
    .join("");
}
function renderFollowups() {
  const today = date(now());
  const groups = { Overdue: [], "Due today": [], Upcoming: [] };
  state.apps
    .filter((a) => a.followUpDate)
    .forEach((a) => {
      const d = date(a.followUpDate);
      groups[
        d < today ? "Overdue" : d === today ? "Due today" : "Upcoming"
      ].push(a);
    });
  $("[data-followups]").innerHTML = Object.entries(groups)
    .map(
      ([g, items]) =>
        `<div><h3>${g}</h3>${items.map((a) => `<div class="followup-card"><strong>${esc(a.company)}</strong><p>${esc(a.role)} • ${date(a.followUpDate)}</p><button class="button" data-done="${esc(a.id)}">Mark done</button> <button class="button button--secondary" data-snooze="${esc(a.id)}">Snooze 7 days</button></div>`).join("") || '<p class="muted">None</p>'}</div>`,
    )
    .join("");
}
function renderOutreach() {
  const b = state.bundle;
  $("[data-outreach-list]").innerHTML =
    [...b.contacts, ...b.outreachMessages]
      .map(
        (x) =>
          `<div class="followup-card"><strong>${esc(x.name || x.channel || "Message")}</strong><p>${esc(x.company || x.subject || x.body || "")}</p></div>`,
      )
      .join("") || '<p class="muted">No contacts or outreach yet.</p>';
}
async function openDetail(idv) {
  const a = await repo.get("applications", idv);
  if (!a) return;
  state.selected = a;
  const b = await repo.exportAllData();
  const by = (r) => r.applicationId === a.id;
  $("[data-detail]").innerHTML =
    `<h2>${esc(a.company)} — ${esc(a.role)}</h2><form data-edit-form class="detail-grid"><label>Company<input name="company" required value="${esc(a.company)}"></label><label>Role title<input name="role" required value="${esc(a.role)}"></label><label>Posting URL<input name="postingUrl" type="url" value="${esc(a.postingUrl)}"></label><label>Application channel<input name="source" value="${esc(a.source)}"></label><label>Status<select name="status">${STATUSES.map((s) => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>Applied at<input name="appliedAt" type="date" value="${date(a.appliedAt)}"></label><label>Follow-up date<input name="followUpDate" type="date" value="${date(a.followUpDate)}"></label><label>Notes<textarea name="notes">${esc(a.notes)}</textarea></label><button class="button" type="submit">Save application</button></form><h3>Add records</h3><div class="actions"><button class="button" data-add="outreach">Add outreach message</button><button class="button" data-add="interview">Log interview</button><button class="button" data-add="offer">Log offer</button><button class="button" data-add="artifact">Add link/artifact</button></div><h3>Lifecycle timeline</h3><ul class="timeline">${[...b.lifecycleEvents.filter(by), ...b.outreachMessages.filter(by), ...b.interviews.filter(by), ...b.offers.filter(by), ...b.artifacts.filter(by)].map((x) => `<li>${esc(x.status || x.channel || x.stage || x.name)} <span class="muted">${date(x.occurredAt || x.sentAt || x.startsAt || x.createdAt)}</span></li>`).join("") || "<li>No lifecycle events yet.</li>"}</ul>`;
  $("[data-detail-dialog]").showModal();
}
async function saveEdit(form) {
  const a = { ...state.selected };
  new FormData(form).forEach((v, k) => (a[k] = v || undefined));
  a.appliedAt = a.appliedAt ? new Date(a.appliedAt).toISOString() : undefined;
  a.followUpDate = a.followUpDate
    ? new Date(a.followUpDate).toISOString()
    : undefined;
  a.updatedAt = now();
  await repo.put("applications", a);
  await repo.add("lifecycleEvents", {
    id: id("event"),
    applicationId: a.id,
    status: a.status,
    occurredAt: now(),
    source: "manual",
    note: "Application updated",
    createdAt: now(),
  });
  await load();
  openDetail(a.id);
}
async function newApp() {
  const company = prompt("Company?");
  if (!company) return;
  const role = prompt("Role title?");
  if (!role) return;
  const postingUrl = prompt("Posting URL?") || undefined;
  const source = prompt("Application channel?") || undefined;
  const ts = now();
  const app = {
    id: id("app"),
    company,
    role,
    postingUrl,
    source,
    status: "applied",
    appliedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  };
  await repo.add("applications", app);
  await repo.add("lifecycleEvents", {
    id: id("event"),
    applicationId: app.id,
    status: "applied",
    occurredAt: ts,
    source: "manual",
    createdAt: ts,
  });
  await load();
  openDetail(app.id);
}
async function addRecord(kind) {
  const a = state.selected,
    ts = now();
  if (kind === "outreach")
    await repo.add("outreachMessages", {
      id: id("msg"),
      applicationId: a.id,
      direction: "outbound",
      channel: "email",
      body: prompt("Outreach message?") || "Outreach sent",
      sentAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
  if (kind === "interview")
    await repo.put("interviews", {
      id: id("int"),
      applicationId: a.id,
      contactIds: [],
      stage: "recruiter_screen",
      startsAt: ts,
      outcome: "scheduled",
      createdAt: ts,
      updatedAt: ts,
    });
  if (kind === "offer")
    await repo.put("offers", {
      id: id("offer"),
      applicationId: a.id,
      status: "received",
      createdAt: ts,
      updatedAt: ts,
    });
  if (kind === "artifact")
    await repo.put("artifacts", {
      id: id("art"),
      applicationId: a.id,
      kind: "link",
      name: prompt("Link name?") || "Link",
      url: prompt("URL?") || undefined,
      private: true,
      createdAt: ts,
      updatedAt: ts,
    });
  await load();
  openDetail(a.id);
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button,[data-open],[data-export]");
  if (!t) return;
  if (t.dataset.action === "new-application") newApp();
  if (t.dataset.open) openDetail(t.dataset.open);
  if (t.dataset.done) {
    const a = await repo.get("applications", t.dataset.done);
    a.followUpDate = undefined;
    a.updatedAt = now();
    await repo.put("applications", a);
    load();
  }
  if (t.dataset.snooze) {
    const a = await repo.get("applications", t.dataset.snooze);
    const d = new Date();
    d.setDate(d.getDate() + 7);
    a.followUpDate = d.toISOString();
    a.updatedAt = now();
    await repo.put("applications", a);
    load();
  }
  if (t.dataset.add) addRecord(t.dataset.add);
  if (
    t.dataset.action === "clear-data" &&
    confirm("Clear all local tracker data?")
  ) {
    await repo.clear();
    load();
  }
  if (t.dataset.action === "preview-import") {
    const text =
      $("[name=csv]").value || (await $("[name=file]").files[0]?.text()) || "";
    const b = bundleFromCsv(text);
    $("[data-import-preview]").textContent =
      `Dry-run OK: ${b.applications.length} applications, ${b.lifecycleEvents.length} lifecycle events.`;
  }
  if (t.dataset.export) {
    const b = await repo.exportAllData();
    if (t.dataset.export === "json")
      download(
        "jobbot3000-backup.json",
        JSON.stringify(b, null, 2),
        "application/json",
      );
    if (t.dataset.export === "ndjson")
      download(
        "jobbot3000-backup.ndjson",
        [
          JSON.stringify({ type: "meta", schemaVersion: 1, exportedAt: now() }),
          ...STORES.flatMap((s) =>
            (s === "settings"
              ? b.settings
                ? [b.settings]
                : []
              : b[s] || []
            ).map((r) => JSON.stringify({ type: s, record: r })),
          ),
        ].join("\n"),
        "application/x-ndjson",
      );
    if (t.dataset.export === "csv")
      download(
        "jobbot3000-applications.csv",
        toCsv(
          b.applications.map((a) => ({
            application_id: a.id,
            company: a.company,
            role_title: a.role,
            status: a.status,
            applied_at: date(a.appliedAt),
            posting_url: a.postingUrl,
            application_channel: a.source,
            follow_up_date: date(a.followUpDate),
            outreach_status: meta(a, "outreach_status"),
            interview_stage: meta(a, "interview_stage"),
            outcome: meta(a, "outcome"),
            fit_score_100: meta(a, "fit_score_100"),
            notes: a.notes,
          })),
        ),
        "text/csv",
      );
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.matches("[data-edit-form]")) {
    e.preventDefault();
    await saveEdit(e.target);
  }
  if (e.target.matches("[data-import-form]")) {
    e.preventDefault();
    const text =
      $("[name=csv]").value || (await $("[name=file]").files[0]?.text()) || "";
    await repo.importAllData(bundleFromCsv(text));
    $("[data-import-preview]").textContent = "Import applied.";
    await load();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.closest("[data-filter-form]")) renderTable();
});
addEventListener("hashchange", renderNav);
repo = await TrackerRepository.open();
await load();
