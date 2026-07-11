import { classifyLifecycleEventType } from "./lifecycleClassification.js";

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => cmp(String(a.id ?? ""), String(b.id ?? ""));
const freezeDeep = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
};

const ORIGINS = [
  ["application_submitted", "Application submitted"],
  ["recruiter_company_outreach", "Recruiter/company reached out"],
  ["candidate_outreach", "Candidate outreach"],
  ["referral", "Referral"],
  ["other_unknown", "Other/unknown"],
];
const MILESTONES = [
  ["recruiter_screen", "Recruiter screen"],
  ["assessment_take_home", "Assessment/take-home"],
  ["technical_interview", "Technical interview"],
  ["onsite_final_loop", "Onsite/final loop"],
  ["offer_received", "Offer received"],
];
const ENDPOINTS = [
  ["awaiting_response", "Awaiting response"],
  ["interviewing", "Interviewing"],
  ["assessment_in_progress", "Assessment in progress"],
  ["offer_negotiating", "Offer/negotiating"],
  ["employer_rejected", "Employer rejected"],
  ["candidate_withdrew", "Candidate withdrew"],
  ["offer_declined", "Offer declined"],
  ["offer_expired_rescinded", "Offer expired/rescinded"],
  ["offer_accepted", "Offer accepted"],
  ["closed_archived", "Closed/archived"],
  ["unknown", "Unknown"],
];
export const LIFECYCLE_DIAGRAM_TAXONOMY = freezeDeep({
  origins: ORIGINS.map(([id, label], rank) => ({ id, label, rank })),
  milestones: MILESTONES.map(([id, label], rank) => ({ id, label, rank })),
  endpoints: ENDPOINTS.map(([id, label], rank) => ({ id, label, rank })),
});

const originIds = new Set(ORIGINS.map(([id]) => id));
const milestoneRank = new Map(MILESTONES.map(([id], rank) => [id, rank]));
const endpointIds = new Set(ENDPOINTS.map(([id]) => id));
const terminal = new Set([
  "employer_rejected",
  "candidate_withdrew",
  "offer_declined",
  "offer_expired_rescinded",
  "offer_accepted",
  "closed_archived",
]);
const statusEndpoint = {
  applied: "awaiting_response",
  outreach_sent: "awaiting_response",
  recruiter_screen: "interviewing",
  technical_screen: "interviewing",
  onsite_loop: "interviewing",
  offer: "offer_negotiating",
  accepted: "offer_accepted",
  rejected: "employer_rejected",
  withdrawn: "candidate_withdrew",
  closed_archived: "closed_archived",
};
const statusMilestone = {
  recruiter_screen: "recruiter_screen",
  technical_screen: "technical_interview",
  onsite_loop: "onsite_final_loop",
  offer: "offer_received",
};
const stageMilestone = {
  recruiter_screen: "recruiter_screen",
  technical_screen: "technical_interview",
  onsite_loop: "onsite_final_loop",
  offer: "offer_received",
};
const normalize = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
const dateKey = (value, precision) => {
  if (precision === "unknown" || value === "1970-01-01")
    return { kind: "unknown" };
  if (precision === "date")
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? { kind: "date", key: value }
      : null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const iso = new Date(time).toISOString();
  return { kind: "instant", key: iso, day: iso.slice(0, 10) };
};
const eventType = (event) =>
  classifyLifecycleEventType(event.eventType).eventType;
const canonicalEvent = (event) => {
  const type = eventType(event);
  if (
    [
      "written_assessment",
      "written_assessment_requested",
      "written_assessment_submitted",
      "take_home",
      "take_home_requested",
      "take_home_submitted",
    ].includes(type)
  )
    return "assessment_take_home";
  if (type === "next_tracking_step") return "status_changed";
  return type;
};
const addWarn = (warnings, code, context = {}) =>
  warnings.push({ code, ...context });

const canonicalEvents = (bundle, cutoff) => {
  const apps = [...(bundle.applications ?? [])].filter((a) => a?.id).sort(byId);
  const appIds = new Set(apps.map((a) => String(a.id)));
  const warnings = [];
  const superseded = new Set(
    (bundle.lifecycleEvents ?? [])
      .map((e) => e?.supersedesEventId)
      .filter(Boolean)
      .map(String),
  );
  let events = [];
  for (const e of bundle.lifecycleEvents ?? []) {
    if (!e?.id || !e.applicationId || !appIds.has(String(e.applicationId))) {
      addWarn(warnings, "orphaned_event", { eventId: e?.id });
      continue;
    }
    if (superseded.has(String(e.id))) continue;
    const dk = dateKey(e.occurredAt, e.occurredAtPrecision);
    if (!dk) {
      addWarn(warnings, "invalid_timestamp", { eventId: e.id });
      continue;
    }
    if (cutoff?.kind === "unknown" && dk.kind !== "unknown") continue;
    if (
      cutoff?.kind === "date" &&
      (dk.kind === "unknown" || cmp(dk.key, cutoff.key) > 0)
    )
      continue;
    if (cutoff?.kind === "instant") {
      if (dk.kind === "unknown") continue;
      if (dk.kind === "date" && cmp(dk.key, cutoff.day) > 0) continue;
      if (dk.kind === "instant" && cmp(dk.key, cutoff.key) > 0) continue;
    }
    const canonicalType = canonicalEvent(e);
    if (
      canonicalType === "status_changed" &&
      !["status_changed", "next_tracking_step"].includes(eventType(e))
    )
      addWarn(warnings, "unknown_event_type", { eventId: e.id });
    events.push({
      ...e,
      id: String(e.id),
      applicationId: String(e.applicationId),
      canonicalType,
      dateKey: dk,
    });
  }
  events.sort(
    (a, b) =>
      cmp(String(a.applicationId), String(b.applicationId)) ||
      cmp(bucketSort(a.dateKey), bucketSort(b.dateKey)) ||
      cmp(a.id, b.id),
  );
  return { apps, events, warnings };
};
const bucketSort = (dk) =>
  dk.kind === "unknown"
    ? "0:"
    : dk.kind === "date"
      ? `1:${dk.key}:0`
      : `1:${dk.day}:1:${dk.key}`;
const bucketId = (dk) =>
  dk.kind === "unknown"
    ? "unknown-date"
    : dk.kind === "date"
      ? `date:${dk.key}`
      : `instant:${dk.key}`;
const nodeId = (kind, id) => `${kind}:${id}`;
const warningCounts = (warnings) => {
  const counts = {};
  for (const warning of warnings)
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
  return counts;
};

function build(cApps, cEvents, warnings, current) {
  const byApp = new Map();
  for (const e of cEvents) {
    const list = byApp.get(e.applicationId) ?? [];
    list.push(e);
    byApp.set(e.applicationId, list);
  }
  const includedApps = current
    ? cApps
    : cApps.filter((a) => byApp.has(String(a.id)));
  const paths = [],
    linkApps = new Map();
  const totals = {
    origins: {},
    milestones: {},
    endpoints: {},
    active: 0,
    terminal: 0,
  };
  for (const app of includedApps) {
    const appId = String(app.id);
    const events = byApp.get(appId) ?? [];
    let origin = originIds.has(app.origin) ? app.origin : "other_unknown";
    const originEvent = events.find((e) => originIds.has(e.canonicalType));
    if (originEvent) origin = originEvent.canonicalType;
    const seen = new Set();
    let endpoint = "unknown";
    let terminalEndpoint = null;
    let best = -1;
    const details = [];
    for (const e of events) {
      const type = e.canonicalType;
      const ms = milestoneRank.has(type)
        ? type
        : statusMilestone[e.status] || stageMilestone[e.stage];
      if (ms) {
        const rank = milestoneRank.get(ms);
        if (rank < best)
          addWarn(warnings, "regressive_history", {
            applicationId: appId,
            eventId: e.id,
          });
        best = Math.max(best, rank);
        seen.add(ms);
      } else if (
        (e.status && !statusEndpoint[e.status]) ||
        (e.stage && e.stage !== "other" && !stageMilestone[e.stage])
      )
        addWarn(warnings, "unknown_structured_value", {
          applicationId: appId,
          eventId: e.id,
        });
      if (e.inferred)
        addWarn(warnings, "inferred_event", {
          applicationId: appId,
          eventId: e.id,
        });
      if (type === "application_reopened") {
        terminalEndpoint = null;
        endpoint = "awaiting_response";
      } else if (terminal.has(type)) {
        terminalEndpoint = type;
        endpoint = type;
      } else if (terminalEndpoint)
        addWarn(warnings, "terminal_without_reopen", {
          applicationId: appId,
          eventId: e.id,
        });
      else if (
        ["offer_received", "offer_negotiating"].includes(type) ||
        e.status === "offer"
      )
        endpoint = "offer_negotiating";
      else if (
        type === "assessment_take_home" &&
        ["requested", "pending", "started", "in_progress"].includes(
          normalize(e.actionStatus),
        )
      )
        endpoint = "assessment_in_progress";
      else if (
        [
          "recruiter_screen",
          "technical_interview",
          "onsite_final_loop",
        ].includes(type) ||
        ["recruiter_screen", "technical_screen", "onsite_loop"].includes(
          e.status,
        )
      )
        endpoint = "interviewing";
      else if (
        [
          "application_submitted",
          "recruiter_company_outreach",
          "candidate_outreach",
          "referral",
          "other_unknown",
          "employer_response_received",
        ].includes(type)
      )
        endpoint = "awaiting_response";
      details.push({
        id: e.id,
        eventType: type,
        occurredAt: e.occurredAt,
        occurredAtPrecision: e.occurredAtPrecision,
      });
    }
    if (
      current &&
      app.status &&
      statusEndpoint[app.status] &&
      statusEndpoint[app.status] !== endpoint
    )
      addWarn(warnings, "status_history_mismatch", {
        applicationId: appId,
        status: app.status,
        endpoint,
      });
    if (!endpointIds.has(endpoint)) endpoint = "unknown";
    const milestones = [...seen].sort(
      (a, b) => milestoneRank.get(a) - milestoneRank.get(b),
    );
    const ids = [
      nodeId("origin", origin),
      ...milestones.map((m) => nodeId("milestone", m)),
      nodeId("endpoint", endpoint),
    ];
    for (let i = 0; i < ids.length - 1; i++) {
      const key = `${ids[i]}→${ids[i + 1]}`;
      if (!linkApps.has(key))
        linkApps.set(key, {
          source: ids[i],
          target: ids[i + 1],
          apps: new Set(),
        });
      linkApps.get(key).apps.add(appId);
    }
    totals.origins[origin] = (totals.origins[origin] ?? 0) + 1;
    for (const m of milestones)
      totals.milestones[m] = (totals.milestones[m] ?? 0) + 1;
    totals.endpoints[endpoint] = (totals.endpoints[endpoint] ?? 0) + 1;
    terminal.has(endpoint) ? totals.terminal++ : totals.active++;
    paths.push({
      applicationId: appId,
      origin,
      milestones,
      endpoint,
      nodeIds: ids,
      events: details,
    });
  }
  paths.sort((a, b) => cmp(a.applicationId, b.applicationId));
  const nodeTotals = new Map();
  for (const p of paths)
    for (const id of p.nodeIds)
      nodeTotals.set(id, (nodeTotals.get(id) ?? 0) + 1);
  const nodes = [...nodeTotals]
    .map(([id, value]) => ({
      id,
      kind: id.split(":")[0],
      taxonomyId: id.slice(id.indexOf(":") + 1),
      value,
    }))
    .sort((a, b) => cmp(a.id, b.id));
  const links = [...linkApps.values()]
    .map((l) => ({
      id: `${l.source}->${l.target}`,
      source: l.source,
      target: l.target,
      value: l.apps.size,
      applicationIds: [...l.apps].sort(cmp),
    }))
    .sort((a, b) => cmp(a.id, b.id));
  warnings.sort(
    (a, b) =>
      cmp(a.code, b.code) ||
      cmp(a.applicationId ?? "", b.applicationId ?? "") ||
      cmp(a.eventId ?? "", b.eventId ?? ""),
  );
  return freezeDeep({
    includedApplications: includedApps.length,
    totalApplications: cApps.length,
    paths,
    nodes,
    links,
    totals,
    warnings,
    warningCounts: warningCounts(warnings),
  });
}

export function buildLifecycleTimeline(bundle = {}) {
  const { events, warnings } = canonicalEvents(bundle);
  const map = new Map([
    [
      "unknown-date",
      {
        id: "unknown-date",
        label: "Unknown date",
        kind: "unknown",
        eventIds: [],
      },
    ],
  ]);
  for (const e of events) {
    const id = bucketId(e.dateKey);
    if (id === "unknown-date") map.get(id).eventIds.push(e.id);
    else if (!map.has(id))
      map.set(id, {
        id,
        label:
          e.dateKey.kind === "date"
            ? `${e.dateKey.key} (time not recorded)`
            : e.dateKey.key,
        kind: e.dateKey.kind,
        cutoff: e.dateKey,
        eventIds: [e.id],
      });
    else map.get(id).eventIds.push(e.id);
  }
  const buckets = [...map.values()]
    .map((b) => ({ ...b, eventIds: b.eventIds.sort(cmp) }))
    .sort((a, b) =>
      a.id === "unknown-date"
        ? -1
        : b.id === "unknown-date"
          ? 1
          : cmp(bucketSort(a.cutoff), bucketSort(b.cutoff)),
    );
  buckets.push({
    id: "current",
    label: "Current",
    kind: "current",
    eventIds: events.map((e) => e.id).sort(cmp),
  });
  return freezeDeep({ buckets, warnings });
}

export function projectLifecycleAt(bundle = {}, bucketIdValue = "current") {
  const timeline = buildLifecycleTimeline(bundle);
  const selectedBucket =
    timeline.buckets.find((b) => b.id === bucketIdValue) ??
    timeline.buckets.at(-1);
  const cutoff =
    selectedBucket.kind === "current"
      ? null
      : selectedBucket.kind === "unknown"
        ? { kind: "unknown" }
        : selectedBucket.cutoff;
  const { apps, events, warnings } = canonicalEvents(bundle, cutoff);
  return freezeDeep({
    selectedBucket,
    ...build(apps, events, warnings, selectedBucket.kind === "current"),
    boundaryEvents: selectedBucket.eventIds ?? [],
  });
}
