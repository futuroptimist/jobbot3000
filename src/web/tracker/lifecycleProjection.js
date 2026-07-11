import { classifyLifecycleEventType } from "./lifecycleClassification.js";

const codeCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => codeCompare(a.id, b.id);
const norm = (v) => String(v ?? "").trim();
const keyNorm = (v) =>
  norm(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const origins = [
  ["application_submitted", "Application submitted"],
  ["recruiter_company_outreach", "Recruiter/company outreach"],
  ["candidate_outreach", "Candidate outreach"],
  ["referral", "Referral"],
  ["other_unknown", "Other/unknown"],
];
const milestones = [
  ["recruiter_screen", "Recruiter screen"],
  ["assessment_take_home", "Assessment/take-home"],
  ["technical_interview", "Technical interview"],
  ["onsite_final_loop", "Onsite/final loop"],
  ["offer_received", "Offer received"],
];
const endpoints = [
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
const makeTaxon = (prefix, rows) =>
  rows.map(([id, label], rank) => ({
    id,
    namespacedId: `${prefix}:${id}`,
    label,
    rank,
  }));
export const LIFECYCLE_DIAGRAM_TAXONOMY = deepFreeze({
  origins: makeTaxon("origin", origins),
  milestones: makeTaxon("milestone", milestones),
  endpoints: makeTaxon("endpoint", endpoints),
});

const ORIGIN = new Set(origins.map(([id]) => id));
const MILESTONE_RANK = new Map(milestones.map(([id], i) => [id, i]));
const TERMINAL = new Set([
  "employer_rejected",
  "candidate_withdrew",
  "offer_declined",
  "offer_expired_rescinded",
  "offer_accepted",
  "closed_archived",
]);
const STATUS_ENDPOINT = new Map(
  Object.entries({
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
  }),
);
const ASSESSMENT_ACTIVE = new Set([
  "requested",
  "pending",
  "started",
  "in_progress",
]);
const ASSESSMENT_DONE = new Set(["submitted", "completed", "done"]);

const addWarning = (warnings, code, details = {}) =>
  warnings.push({ code, ...details });
const countWarnings = (warnings) =>
  warnings.reduce(
    (acc, w) => ({ ...acc, [w.code]: (acc[w.code] ?? 0) + 1 }),
    {},
  );

const parseTemporal = (event, warnings) => {
  const precision =
    event.occurredAtPrecision === "date" ||
    event.occurredAtPrecision === "unknown" ||
    event.occurredAtPrecision === "instant"
      ? event.occurredAtPrecision
      : "unknown";
  const raw = norm(event.occurredAt);
  if (precision === "unknown" || raw.startsWith("1970-01-01"))
    return { kind: "unknown", sort: "" };
  if (precision === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw))
      return { kind: "date", date: raw, sort: `${raw}T00:00:00.000Z` };
    addWarning(warnings, "invalid_timestamp", { eventId: event.id });
    return { kind: "unknown", sort: "" };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    addWarning(warnings, "invalid_timestamp", { eventId: event.id });
    return { kind: "unknown", sort: "" };
  }
  const iso = new Date(ms).toISOString();
  return { kind: "instant", instant: iso, date: iso.slice(0, 10), sort: iso };
};

const canonicalEventType = (event) =>
  classifyLifecycleEventType(event.eventType).eventType ||
  keyNorm(event.eventType);
const eventSort = (a, b) =>
  codeCompare(a.temporal.sort, b.temporal.sort) || codeCompare(a.id, b.id);

const prepare = (bundle) => {
  const warnings = [];
  const apps = (Array.isArray(bundle.applications) ? bundle.applications : [])
    .map((a) => ({ ...a, id: norm(a.id) }))
    .filter((a) => a.id)
    .sort(byId);
  const appIds = new Set(apps.map((a) => a.id));
  const rawEvents = (
    Array.isArray(bundle.lifecycleEvents) ? bundle.lifecycleEvents : []
  )
    .map((e) => ({
      ...e,
      id: norm(e.id),
      applicationId: norm(e.applicationId),
    }))
    .filter((e) => e.id)
    .sort(byId);
  const superseded = new Set(
    rawEvents.map((e) => norm(e.supersedesEventId)).filter(Boolean),
  );
  const events = [];
  for (const e of rawEvents) {
    if (superseded.has(e.id)) continue;
    if (!appIds.has(e.applicationId)) {
      addWarning(warnings, "orphaned_event", {
        eventId: e.id,
        applicationId: e.applicationId,
      });
      continue;
    }
    const temporal = parseTemporal(e, warnings);
    const eventType = canonicalEventType(e);
    const known = [
      ...ORIGIN,
      ...MILESTONE_RANK.keys(),
      "employer_response_received",
      "offer_negotiating",
      ...TERMINAL,
      "application_reopened",
      "status_changed",
      "migration_status_snapshot",
    ].includes(eventType);
    if (!known)
      addWarning(warnings, "unknown_event_type", { eventId: e.id, eventType });
    if (e.inferred) addWarning(warnings, "inferred_event", { eventId: e.id });
    events.push({ ...e, eventType, temporal });
  }
  return { apps, events: events.sort(eventSort), warnings };
};

const selectEvents = (events, bucket) => {
  if (bucket.id === "current") return events;
  if (bucket.id === "unknown-date")
    return events.filter((e) => e.temporal.kind === "unknown");
  return events.filter(
    (e) =>
      e.temporal.kind !== "unknown" &&
      codeCompare(e.temporal.sort, bucket.cutoffSort) <= 0,
  );
};

const nodeId = (type, id) => `${type}:${id}`;

const projectWithPrepared = (prepared, bucket) => {
  const warnings = [...prepared.warnings];
  const selectedEvents = selectEvents(prepared.events, bucket);
  const eventsByApp = new Map();
  for (const e of selectedEvents)
    (
      eventsByApp.get(e.applicationId) ??
      eventsByApp.set(e.applicationId, []).get(e.applicationId)
    ).push(e);
  const historical = bucket.id !== "current";
  const includedApps = prepared.apps.filter(
    (a) =>
      !historical ||
      (eventsByApp.get(a.id) ?? []).some((e) =>
        bucket.id === "unknown-date"
          ? e.temporal.kind === "unknown"
          : e.temporal.kind !== "unknown",
      ),
  );
  const paths = [];
  for (const app of includedApps) {
    const appEvents = (eventsByApp.get(app.id) ?? []).sort(eventSort);
    let origin = ORIGIN.has(app.origin) ? app.origin : "other_unknown";
    const originEvent = appEvents.find((e) => ORIGIN.has(e.eventType));
    if (originEvent) origin = originEvent.eventType;
    else if (keyNorm(app.source) === "referral") origin = "referral";
    if (app.origin && app.origin !== origin)
      addWarning(warnings, "origin_conflict", { applicationId: app.id });
    const seen = new Set();
    let endpoint = "unknown",
      terminal = null,
      activeAssessment = false,
      activeInterview = false,
      awaiting = false,
      offer = false;
    for (const e of appEvents) {
      const previousRank = seen.size
        ? Math.max(...[...seen].map((id) => MILESTONE_RANK.get(id)))
        : -1;
      let milestone = MILESTONE_RANK.has(e.eventType) ? e.eventType : undefined;
      if (e.status === "technical_screen" || e.stage === "technical_screen")
        milestone = "technical_interview";
      if (e.status === "onsite_loop" || e.stage === "onsite_loop")
        milestone = "onsite_final_loop";
      if (e.status === "offer") milestone = "offer_received";
      if (milestone) {
        if (MILESTONE_RANK.get(milestone) < previousRank)
          addWarning(warnings, "regressive_history", {
            applicationId: app.id,
            eventId: e.id,
          });
        seen.add(milestone);
      }
      const action = keyNorm(e.actionStatus);
      if (
        e.eventType === "assessment_take_home" &&
        ASSESSMENT_ACTIVE.has(action)
      )
        activeAssessment = true;
      if (e.eventType === "assessment_take_home" && ASSESSMENT_DONE.has(action))
        activeAssessment = false;
      if (
        [
          "recruiter_screen",
          "technical_interview",
          "onsite_final_loop",
        ].includes(e.eventType)
      )
        activeInterview = true;
      if ([...ORIGIN, "employer_response_received"].includes(e.eventType))
        awaiting = true;
      if (["offer_received", "offer_negotiating"].includes(e.eventType))
        offer = true;
      if (e.eventType === "application_reopened") {
        terminal = null;
        continue;
      }
      if (TERMINAL.has(e.eventType)) terminal = e.eventType;
      else if (
        terminal &&
        (milestone || activeAssessment || activeInterview || awaiting || offer)
      )
        addWarning(warnings, "terminal_without_reopen", {
          applicationId: app.id,
          eventId: e.id,
        });
    }
    const milestoneIds = [...seen].sort(
      (a, b) => MILESTONE_RANK.get(a) - MILESTONE_RANK.get(b),
    );
    if (terminal) endpoint = terminal;
    else if (offer) endpoint = "offer_negotiating";
    else if (activeAssessment) endpoint = "assessment_in_progress";
    else if (activeInterview) endpoint = "interviewing";
    else if (awaiting) endpoint = "awaiting_response";
    else endpoint = STATUS_ENDPOINT.get(app.status) ?? "unknown";
    if (
      bucket.id === "current" &&
      STATUS_ENDPOINT.has(app.status) &&
      STATUS_ENDPOINT.get(app.status) !== endpoint
    )
      addWarning(warnings, "status_mismatch", {
        applicationId: app.id,
        status: app.status,
        endpoint,
      });
    const nodes = [
      nodeId("origin", origin),
      ...milestoneIds.map((m) => nodeId("milestone", m)),
      nodeId("endpoint", endpoint),
    ];
    paths.push({
      applicationId: app.id,
      origin: nodeId("origin", origin),
      milestones: milestoneIds.map((m) => nodeId("milestone", m)),
      endpoint: nodeId("endpoint", endpoint),
      nodes,
      events: appEvents.map((e) => e.id),
    });
  }
  paths.sort((a, b) => codeCompare(a.applicationId, b.applicationId));
  const linkMap = new Map();
  for (const p of paths)
    for (let i = 0; i < p.nodes.length - 1; i += 1) {
      const source = p.nodes[i],
        target = p.nodes[i + 1];
      if (source === target) continue;
      const id = `${source}->${target}`;
      const link = linkMap.get(id) ?? {
        id,
        source,
        target,
        value: 0,
        applicationIds: [],
      };
      link.value += 1;
      link.applicationIds.push(p.applicationId);
      linkMap.set(id, link);
    }
  const links = [...linkMap.values()]
    .map((l) => ({
      ...l,
      applicationIds: [...new Set(l.applicationIds)].sort(codeCompare),
    }))
    .sort((a, b) => codeCompare(a.id, b.id));
  const makeTotals = (prefix, rows) =>
    Object.fromEntries(rows.map(([id]) => [nodeId(prefix, id), 0]));
  const totals = {
    origins: makeTotals("origin", origins),
    milestones: makeTotals("milestone", milestones),
    endpoints: makeTotals("endpoint", endpoints),
    active: 0,
    terminal: 0,
  };
  for (const p of paths) {
    totals.origins[p.origin] += 1;
    for (const m of p.milestones) totals.milestones[m] += 1;
    totals.endpoints[p.endpoint] += 1;
    if (TERMINAL.has(p.endpoint.replace("endpoint:", ""))) totals.terminal += 1;
    else totals.active += 1;
  }
  const allNodeIds = new Set([
    ...Object.keys(totals.origins),
    ...Object.keys(totals.milestones),
    ...Object.keys(totals.endpoints),
  ]);
  const nodes = [...allNodeIds].sort(codeCompare).map((id) => ({
    id,
    value:
      totals.origins[id] ?? totals.milestones[id] ?? totals.endpoints[id] ?? 0,
  }));
  const resultWarnings = warnings.sort((a, b) =>
    codeCompare(JSON.stringify(a), JSON.stringify(b)),
  );
  return deepFreeze({
    bucket,
    includedApplications: paths.length,
    totalApplications: prepared.apps.length,
    paths,
    nodes,
    links,
    totals,
    boundaryEvents: selectedEvents.map((e) => e.id).sort(codeCompare),
    warnings: resultWarnings,
    warningCounts: countWarnings(resultWarnings),
  });
};

const bucketFor = (id) =>
  id === "current"
    ? { id: "current", label: "Current" }
    : id === "unknown-date"
      ? { id: "unknown-date", label: "Unknown date" }
      : null;

export const buildLifecycleTimeline = (bundle = {}) => {
  const prepared = prepare(bundle);
  const bucketMap = new Map();
  for (const e of prepared.events) {
    if (e.temporal.kind === "unknown") continue;
    const id =
      e.temporal.kind === "date"
        ? `date:${e.temporal.date}`
        : `instant:${e.temporal.instant}`;
    const b = bucketMap.get(id) ?? {
      id,
      kind: e.temporal.kind,
      date: e.temporal.date,
      instant: e.temporal.instant,
      cutoffSort: e.temporal.sort,
      eventIds: [],
    };
    b.eventIds.push(e.id);
    bucketMap.set(id, b);
  }
  const dated = [...bucketMap.values()]
    .map((b) => ({
      ...b,
      eventIds: b.eventIds.sort(codeCompare),
      label: b.kind === "date" ? `${b.date} (time not recorded)` : b.instant,
    }))
    .sort(
      (a, b) =>
        codeCompare(a.date, b.date) ||
        (a.kind === b.kind
          ? codeCompare(a.cutoffSort, b.cutoffSort)
          : a.kind === "date"
            ? -1
            : 1),
    );
  const buckets = [
    {
      id: "unknown-date",
      label: "Unknown date",
      kind: "unknown",
      eventIds: prepared.events
        .filter((e) => e.temporal.kind === "unknown")
        .map((e) => e.id)
        .sort(codeCompare),
    },
    ...dated,
    {
      id: "current",
      label: "Current",
      kind: "current",
      eventIds: prepared.events.map((e) => e.id).sort(codeCompare),
    },
  ];
  return deepFreeze({
    buckets,
    warnings: prepared.warnings.sort((a, b) =>
      codeCompare(JSON.stringify(a), JSON.stringify(b)),
    ),
    warningCounts: countWarnings(prepared.warnings),
  });
};

export const projectLifecycleAt = (bundle = {}, bucketId = "current") => {
  const prepared = prepare(bundle);
  const timeline = buildLifecycleTimeline(bundle);
  const bucket =
    timeline.buckets.find((b) => b.id === bucketId) ??
    bucketFor(bucketId) ??
    timeline.buckets.at(-1);
  return projectWithPrepared(prepared, bucket);
};
