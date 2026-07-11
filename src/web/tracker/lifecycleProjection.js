import { classifyLifecycleEventType } from "./lifecycleClassification.js";

const codeCompare = (a, b) =>
  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
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

const toItems = (entries, namespace) =>
  entries.map(([id, label], rank) => ({
    id,
    nodeId: `${namespace}:${id}`,
    label,
    rank,
  }));
export const LIFECYCLE_DIAGRAM_TAXONOMY = deepFreeze({
  origins: toItems(ORIGINS, "origin"),
  milestones: toItems(MILESTONES, "milestone"),
  endpoints: toItems(ENDPOINTS, "endpoint"),
});

const ORIGIN_IDS = new Set(ORIGINS.map(([id]) => id));
const MILESTONE_IDS = new Set(MILESTONES.map(([id]) => id));
const KNOWN_EVENT_IDS = new Set([
  ...ORIGINS.map(([id]) => id),
  ...MILESTONES.map(([id]) => id),
  ...ENDPOINTS.map(([id]) => id),
  "employer_response_received",
  "offer_negotiating",
  "application_reopened",
  "status_changed",
  "migration_status_snapshot",
]);
const TERMINAL_IDS = new Set([
  "employer_rejected",
  "candidate_withdrew",
  "offer_declined",
  "offer_expired_rescinded",
  "offer_accepted",
  "closed_archived",
]);
const STATUS_ENDPOINT = {
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
const TERMINAL_EVENT_ENDPOINT = {
  employer_rejected: "employer_rejected",
  candidate_withdrew: "candidate_withdrew",
  offer_declined: "offer_declined",
  offer_expired_rescinded: "offer_expired_rescinded",
  offer_accepted: "offer_accepted",
  closed_archived: "closed_archived",
};
const LEGACY = {
  hiring_manager_reply: "employer_response_received",
  recruiter_screen_scheduled: "recruiter_screen",
  recruiter_screen_completed: "recruiter_screen",
  devops_interview_scheduled: "technical_interview",
  devops_interview_completed: "technical_interview",
  technical_interview_scheduled: "technical_interview",
  technical_interview_completed: "technical_interview",
  technical_screen_scheduled: "technical_interview",
  technical_screen_completed: "technical_interview",
  onsite_interview_scheduled: "onsite_final_loop",
  onsite_interview_completed: "onsite_final_loop",
  final_interview_scheduled: "onsite_final_loop",
  final_interview_completed: "onsite_final_loop",
  written_assessment: "assessment_take_home",
  written_assessment_requested: "assessment_take_home",
  written_assessment_submitted: "assessment_take_home",
  take_home: "assessment_take_home",
  take_home_requested: "assessment_take_home",
  take_home_submitted: "assessment_take_home",
  next_tracking_step: "status_changed",
};
const ASSESSMENT_IN_PROGRESS = new Set([
  "requested",
  "pending",
  "started",
  "in_progress",
]);
const MILESTONE_RANK = new Map(MILESTONES.map(([id], index) => [id, index]));
const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const canonicalEventType = (event) =>
  LEGACY[normalize(event?.eventType)] ?? normalize(event?.eventType);
const eventId = (event, index) => String(event?.id ?? `missing_event_${index}`);
const appId = (app, index) => String(app?.id ?? `missing_application_${index}`);
const isUnknownTime = (event) =>
  event?.occurredAtPrecision === "unknown" ||
  String(event?.occurredAt ?? "").startsWith("1970-01-01");
const dateKey = (value) => /^\d{4}-\d{2}-\d{2}/u.exec(String(value ?? ""))?.[0];
const instantMs = (value) => {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : undefined;
};
const eventTime = (event) => {
  if (isUnknownTime(event)) return { kind: "unknown", sort: "" };
  if (event?.occurredAtPrecision === "date") {
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(String(event.occurredAt))
      ? String(event.occurredAt)
      : dateKey(event.occurredAt);
    return date
      ? { kind: "date", date, sort: `${date}|0` }
      : { kind: "invalid", sort: "" };
  }
  const ms = instantMs(event?.occurredAt);
  if (ms === undefined) return { kind: "invalid", sort: "" };
  const iso = new Date(ms).toISOString();
  return {
    kind: "instant",
    instant: iso,
    date: iso.slice(0, 10),
    sort: `${iso.slice(0, 10)}|1|${iso}`,
  };
};
const makeWarning = (code, applicationId, extra = {}) => ({
  code,
  applicationId,
  ...extra,
});

const prepare = (bundle) => {
  const warnings = [];
  const apps = (bundle.applications ?? [])
    .map((app, index) => ({ ...app, id: appId(app, index) }))
    .sort((a, b) => codeCompare(a.id, b.id));
  const knownApps = new Set(apps.map((app) => app.id));
  const superseded = new Set(
    (bundle.lifecycleEvents ?? [])
      .map((event) => event?.supersedesEventId)
      .filter(Boolean)
      .map(String),
  );
  const events = (bundle.lifecycleEvents ?? [])
    .map((event, index) => ({
      ...event,
      id: eventId(event, index),
      applicationId: String(event?.applicationId ?? ""),
      canonicalType: canonicalEventType(event),
      time: eventTime(event),
    }))
    .filter((event) => !superseded.has(event.id))
    .sort(
      (a, b) =>
        codeCompare(a.time.sort, b.time.sort) || codeCompare(a.id, b.id),
    );
  for (const event of events) {
    if (!knownApps.has(event.applicationId))
      warnings.push(
        makeWarning("orphan_event", event.applicationId || undefined, {
          eventId: event.id,
        }),
      );
    if (event.time.kind === "invalid")
      warnings.push(
        makeWarning("invalid_timestamp", event.applicationId || undefined, {
          eventId: event.id,
        }),
      );
    if (!KNOWN_EVENT_IDS.has(event.canonicalType))
      warnings.push(
        makeWarning("unknown_event_type", event.applicationId || undefined, {
          eventId: event.id,
          eventType: event.eventType,
        }),
      );
  }
  return {
    apps,
    events: events.filter((event) => knownApps.has(event.applicationId)),
    warnings,
  };
};

const bucketEvents = (events, bucketId) => {
  if (bucketId === "current") return events;
  if (bucketId === "unknown-date")
    return events.filter((event) => event.time.kind === "unknown");
  return events.filter(
    (event) =>
      event.time.kind !== "unknown" &&
      event.time.kind !== "invalid" &&
      codeCompare(event.time.sort, bucketId) <= 0,
  );
};

const originFor = (app, events, details) => {
  const origin = events.find((event) =>
    ORIGIN_IDS.has(event.canonicalType),
  )?.canonicalType;
  if (origin) return origin;
  if (ORIGIN_IDS.has(app.origin)) return app.origin;
  if (normalize(app.source) === "referral") return "referral";
  details.push(makeWarning("inferred_origin", app.id));
  return "other_unknown";
};
const endpointFromStatusEvent = (event) =>
  STATUS_ENDPOINT[normalize(event.status)] ??
  STATUS_ENDPOINT[normalize(event.currentStatus)];
const projectApp = (app, appEvents, isCurrent) => {
  const details = [];
  const events = [...appEvents].sort(
    (a, b) => codeCompare(a.time.sort, b.time.sort) || codeCompare(a.id, b.id),
  );
  const origin = originFor(app, events, details);
  const milestoneSet = new Set();
  let highestObservedMilestoneRank = -1;
  let endpoint = "unknown";
  let terminal = undefined;
  for (const event of events) {
    const type = event.canonicalType;
    const classified = classifyLifecycleEventType(type);
    if (event.inferred)
      details.push(
        makeWarning("inferred_event", app.id, { eventId: event.id }),
      );
    let milestone = undefined;
    if (MILESTONE_IDS.has(type)) milestone = type;
    else if (
      ["technical_screen", "onsite_loop"].includes(normalize(event.stage))
    )
      milestone =
        normalize(event.stage) === "technical_screen"
          ? "technical_interview"
          : "onsite_final_loop";
    if (milestone) {
      const rank = MILESTONE_RANK.get(milestone) ?? 0;
      if (rank < highestObservedMilestoneRank)
        details.push(
          makeWarning("regressive_history", app.id, { eventId: event.id }),
        );
      highestObservedMilestoneRank = Math.max(
        highestObservedMilestoneRank,
        rank,
      );
      milestoneSet.add(milestone);
    }
    if (type === "application_reopened") {
      terminal = undefined;
      endpoint = "awaiting_response";
      continue;
    }
    if (
      terminal &&
      !TERMINAL_EVENT_ENDPOINT[type] &&
      !TERMINAL_IDS.has(endpointFromStatusEvent(event))
    ) {
      details.push(
        makeWarning("terminal_without_reopen", app.id, { eventId: event.id }),
      );
      continue;
    }
    if (TERMINAL_EVENT_ENDPOINT[type]) {
      endpoint = TERMINAL_EVENT_ENDPOINT[type];
      terminal = endpoint;
      continue;
    }
    if (type === "offer_received" || type === "offer_negotiating")
      endpoint = "offer_negotiating";
    else if (
      type === "assessment_take_home" &&
      ASSESSMENT_IN_PROGRESS.has(normalize(event.actionStatus ?? event.action))
    )
      endpoint = "assessment_in_progress";
    else if (
      ["recruiter_screen", "technical_interview", "onsite_final_loop"].includes(
        type,
      )
    )
      endpoint = "interviewing";
    else if (ORIGIN_IDS.has(type) || type === "employer_response_received")
      endpoint = "awaiting_response";
    else if (endpointFromStatusEvent(event))
      endpoint = endpointFromStatusEvent(event);
    if (classified.eventType !== type)
      details.push(
        makeWarning("event_type_normalized", app.id, { eventId: event.id }),
      );
  }
  const milestones = [...milestoneSet].sort(
    (a, b) => (MILESTONE_RANK.get(a) ?? 0) - (MILESTONE_RANK.get(b) ?? 0),
  );
  if (
    isCurrent &&
    STATUS_ENDPOINT[normalize(app.status)] &&
    endpoint !== STATUS_ENDPOINT[normalize(app.status)]
  )
    details.push(
      makeWarning("status_mismatch", app.id, {
        replayEndpoint: endpoint,
        statusEndpoint: STATUS_ENDPOINT[normalize(app.status)],
      }),
    );
  return {
    applicationId: app.id,
    origin,
    milestones,
    endpoint,
    nodeIds: [
      `origin:${origin}`,
      ...milestones.map((id) => `milestone:${id}`),
      `endpoint:${endpoint}`,
    ],
    details,
  };
};

const makeNodes = (paths) => {
  const totals = new Map();
  for (const path of paths)
    for (const nodeId of path.nodeIds)
      totals.set(nodeId, (totals.get(nodeId) ?? 0) + 1);
  const tax = [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
  ];
  return tax
    .filter((item) => totals.has(item.nodeId))
    .map((item) => ({
      id: item.nodeId,
      taxonomyId: item.id,
      label: item.label,
      rank: item.rank,
      total: totals.get(item.nodeId),
    }));
};
const makeLinks = (paths) => {
  const map = new Map();
  for (const path of paths)
    for (let i = 0; i < path.nodeIds.length - 1; i += 1) {
      const source = path.nodeIds[i],
        target = path.nodeIds[i + 1];
      if (source === target) continue;
      const key = `${source}->${target}`;
      const link = map.get(key) ?? {
        id: `link:${key}`,
        source,
        target,
        value: 0,
        applicationIds: [],
      };
      if (!link.applicationIds.includes(path.applicationId)) {
        link.applicationIds.push(path.applicationId);
        link.value += 1;
      }
      map.set(key, link);
    }
  return [...map.values()]
    .map((l) => ({ ...l, applicationIds: l.applicationIds.sort(codeCompare) }))
    .sort((a, b) => codeCompare(a.id, b.id));
};
const countBy = (paths, key, order = []) => {
  const map = paths.reduce(
    (m, p) => m.set(p[key], (m.get(p[key]) ?? 0) + 1),
    new Map(),
  );
  const rank = new Map(order.map((id, index) => [id, index]));
  return Object.fromEntries(
    [...map.entries()].sort(
      ([a], [b]) =>
        (rank.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b) ?? Number.MAX_SAFE_INTEGER) || codeCompare(a, b),
    ),
  );
};
const warningCounts = (warnings) =>
  Object.fromEntries(
    [
      ...warnings
        .reduce((m, w) => m.set(w.code, (m.get(w.code) ?? 0) + 1), new Map())
        .entries(),
    ].sort(([a], [b]) => codeCompare(a, b)),
  );

export function projectLifecycleAt(bundle = {}, bucketId = "current") {
  const { apps, events, warnings: globalWarnings } = prepare(bundle);
  const selectedEvents = bucketEvents(events, bucketId);
  const eventAppIds = new Set(
    selectedEvents.map((event) => event.applicationId),
  );
  const includedApps =
    bucketId === "current"
      ? apps
      : apps.filter((app) => eventAppIds.has(app.id));
  const paths = includedApps.map((app) =>
    projectApp(
      app,
      selectedEvents.filter((event) => event.applicationId === app.id),
      bucketId === "current",
    ),
  );
  const warnings = [
    ...globalWarnings,
    ...paths.flatMap((path) => path.details),
  ];
  const terminalTotal = paths.filter((path) =>
    TERMINAL_IDS.has(path.endpoint),
  ).length;
  const projection = {
    bucket: buildBucketMetadata(bucketId, events),
    includedApplications: paths.length,
    totalApplications: apps.length,
    paths,
    nodes: makeNodes(paths),
    links: makeLinks(paths),
    totals: {
      origins: countBy(
        paths,
        "origin",
        LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((x) => x.id),
      ),
      milestones: countBy(
        paths.flatMap((path) =>
          path.milestones.map((milestone) => ({ milestone })),
        ),
        "milestone",
      ),
      endpoints: countBy(
        paths,
        "endpoint",
        LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((x) => x.id),
      ),
      active: paths.length - terminalTotal,
      terminal: terminalTotal,
    },
    events: selectedEvents
      .map((event) => ({
        id: event.id,
        applicationId: event.applicationId,
        eventType: event.canonicalType,
        occurredAt: event.occurredAt,
        occurredAtPrecision: event.occurredAtPrecision,
      }))
      .sort((a, b) => codeCompare(a.id, b.id)),
    warnings,
    warningCounts: warningCounts(warnings),
  };
  return deepFreeze(projection);
}

function buildBucketMetadata(bucketId, events) {
  if (bucketId === "current")
    return { id: "current", label: "Current", kind: "current" };
  if (bucketId === "unknown-date")
    return { id: "unknown-date", label: "Unknown date", kind: "unknown-date" };
  const event = events.find((candidate) => candidate.time.sort === bucketId);
  return {
    id: bucketId,
    label:
      event?.time.kind === "date"
        ? `${event.time.date} (time not recorded)`
        : (event?.time.instant ?? bucketId),
    kind: event?.time.kind ?? "instant",
    cutoff: bucketId,
  };
}

export function buildLifecycleTimeline(bundle = {}) {
  const { apps, events, warnings } = prepare(bundle);
  const datedKeys = [
    ...new Set(
      events
        .filter(
          (event) =>
            event.time.kind !== "unknown" && event.time.kind !== "invalid",
        )
        .map((event) => event.time.sort),
    ),
  ].sort(codeCompare);
  const buckets = ["unknown-date", ...datedKeys, "current"].map((id) => {
    const selected = bucketEvents(events, id);
    const included =
      id === "current"
        ? apps.length
        : new Set(selected.map((event) => event.applicationId)).size;
    return {
      ...buildBucketMetadata(id, events),
      includedApplications: included,
      totalApplications: apps.length,
      eventIds: (id === "current" || id === "unknown-date"
        ? selected
        : events.filter((event) => event.time.sort === id)
      )
        .map((event) => event.id)
        .sort(codeCompare),
    };
  });
  return deepFreeze({
    buckets,
    warnings,
    warningCounts: warningCounts(warnings),
  });
}
