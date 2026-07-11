import { classifyLifecycleEventType } from "./lifecycleClassification.js";

const ORIGINS = [
  ["application_submitted", "application submitted"],
  ["recruiter_company_outreach", "recruiter/company outreach"],
  ["candidate_outreach", "candidate outreach"],
  ["referral", "referral"],
  ["other_unknown", "other/unknown"],
];
const MILESTONES = [
  ["recruiter_screen", "recruiter screen"],
  ["assessment_take_home", "assessment/take-home"],
  ["technical_interview", "technical interview"],
  ["onsite_final_loop", "onsite/final loop"],
  ["offer_received", "offer received"],
];
const ENDPOINTS = [
  ["awaiting_response", "awaiting response", false],
  ["interviewing", "interviewing", false],
  ["assessment_in_progress", "assessment in progress", false],
  ["offer_negotiating", "offer/negotiating", false],
  ["employer_rejected", "employer rejected", true],
  ["candidate_withdrew", "candidate withdrew", true],
  ["offer_declined", "offer declined", true],
  ["offer_expired_rescinded", "offer expired/rescinded", true],
  ["offer_accepted", "offer accepted", true],
  ["closed_archived", "closed/archived", true],
  ["unknown", "unknown", false],
];
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
const items = (rows, ns) =>
  rows.map(([id, label, terminal], rank) => ({
    id,
    nodeId: `${ns}:${id}`,
    label,
    rank,
    ...(terminal == null ? {} : { terminal }),
  }));
export const LIFECYCLE_DIAGRAM_TAXONOMY = deepFreeze({
  origins: items(ORIGINS, "origin"),
  milestones: items(MILESTONES, "milestone"),
  endpoints: items(ENDPOINTS, "endpoint"),
});
const ORIGIN_IDS = new Set(ORIGINS.map(([id]) => id));
const MILESTONE_IDS = new Set(MILESTONES.map(([id]) => id));
const TERMINAL_STATUS = new Set([
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);
const TERMINAL_ENDPOINTS = new Set(
  ENDPOINTS.filter((x) => x[2]).map(([id]) => id),
);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => cmp(String(a?.id ?? ""), String(b?.id ?? ""));
const countCodes = (warnings) =>
  warnings.reduce(
    (out, w) => ({ ...out, [w.code]: (out[w.code] ?? 0) + 1 }),
    {},
  );
const parseTime = (event, warnings) => {
  if (!event?.occurredAt || event.occurredAtPrecision === "unknown")
    return { known: false, key: "unknown", date: undefined };
  if (event.occurredAtPrecision === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(event.occurredAt))
      return {
        known: true,
        key: `date:${event.occurredAt}`,
        date: event.occurredAt,
        instant: `${event.occurredAt}T00:00:00.000Z`,
      };
  } else {
    const t = Date.parse(event.occurredAt);
    if (!Number.isNaN(t)) {
      const iso = new Date(t).toISOString();
      return {
        known: true,
        key: `instant:${iso}`,
        date: iso.slice(0, 10),
        instant: iso,
      };
    }
  }
  warnings.push({
    code: "invalid_timestamp",
    applicationId: event.applicationId,
    eventId: event.id,
  });
  return { known: false, key: "unknown", date: undefined };
};
const effective = (events) => {
  const superseded = new Set(
    events.map((e) => e?.supersedesEventId).filter(Boolean),
  );
  return events
    .filter((e) => e && !superseded.has(e.id))
    .sort(
      (a, b) =>
        cmp(String(a.applicationId), String(b.applicationId)) ||
        cmp(timeSort(a), timeSort(b)) ||
        cmp(String(a.id), String(b.id)),
    );
};
const timeSort = (e) =>
  e?.occurredAtPrecision === "date"
    ? `0:${e.occurredAt}`
    : e?.occurredAtPrecision === "instant" &&
        !Number.isNaN(Date.parse(e.occurredAt))
      ? `1:${new Date(Date.parse(e.occurredAt)).toISOString()}`
      : `2:${e?.occurredAt ?? ""}`;
const endpointFor = (events, app) => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (
      [
        "offer_accepted",
        "employer_rejected",
        "candidate_withdrew",
        "offer_declined",
        "offer_expired_rescinded",
        "closed_archived",
        "offer_negotiating",
      ].includes(e.eventType)
    )
      return e.eventType;
    if (e.eventType === "offer_received") return "offer_negotiating";
    if (
      e.eventType === "assessment_take_home" &&
      !["submitted", "completed"].includes(String(e.actionStatus ?? ""))
    )
      return "assessment_in_progress";
    if (
      ["recruiter_screen", "technical_interview", "onsite_final_loop"].includes(
        e.eventType,
      )
    )
      return "interviewing";
  }
  const status = app?.status;
  return (
    {
      accepted: "offer_accepted",
      rejected: "employer_rejected",
      withdrawn: "candidate_withdrew",
      closed_archived: "closed_archived",
      offer: "offer_negotiating",
      recruiter_screen: "interviewing",
      technical_screen: "interviewing",
      onsite_loop: "interviewing",
      outreach_sent: "awaiting_response",
      applied: "awaiting_response",
    }[status] ?? "unknown"
  );
};
const project = (bundle, cutoff) => {
  const warnings = [];
  const apps = [...(bundle.applications ?? [])].filter((a) => a?.id).sort(byId);
  const appIds = new Set(apps.map((a) => a.id));
  let events = effective([...(bundle.lifecycleEvents ?? [])]);
  for (const e of events)
    if (!appIds.has(e.applicationId))
      warnings.push({
        code: "orphaned_event",
        applicationId: e.applicationId,
        eventId: e.id,
      });
  events = events.filter((e) => appIds.has(e.applicationId));
  const timed = new Map(events.map((e) => [e.id, parseTime(e, warnings)]));
  if (cutoff !== "current")
    events = events.filter((e) =>
      cutoff === "unknown"
        ? !timed.get(e.id).known
        : timed.get(e.id).known && timed.get(e.id).key <= cutoff,
    );
  const byApp = new Map(events.map((e) => [e.applicationId, []]));
  for (const e of events) byApp.get(e.applicationId).push(e);
  const includedApps = apps.filter(
    (a) => cutoff === "current" || byApp.get(a.id)?.length,
  );
  const paths = [];
  for (const app of includedApps) {
    const evs = (byApp.get(app.id) ?? []).sort(
      (a, b) =>
        cmp(timeSort(a), timeSort(b)) || cmp(String(a.id), String(b.id)),
    );
    for (const e of evs) {
      const c = classifyLifecycleEventType(e.eventType);
      if (e.inferred)
        warnings.push({
          code: "inferred_event",
          applicationId: app.id,
          eventId: e.id,
        });
      if (c.status && e.status && c.status !== e.status)
        warnings.push({
          code: "status_mismatch",
          applicationId: app.id,
          eventId: e.id,
        });
    }
    let origin =
      evs.find((e) => ORIGIN_IDS.has(e.eventType))?.eventType ??
      app.origin ??
      "other_unknown";
    if (!ORIGIN_IDS.has(origin)) origin = "other_unknown";
    const seen = new Set();
    let lastRank = -1;
    const milestones = [];
    let terminal = false;
    for (const e of evs) {
      if (e.eventType === "application_reopened") terminal = false;
      if (terminal && !TERMINAL_STATUS.has(e.status))
        warnings.push({
          code: "terminal_without_reopen",
          applicationId: app.id,
          eventId: e.id,
        });
      if (MILESTONE_IDS.has(e.eventType) && !seen.has(e.eventType)) {
        const rank = MILESTONES.findIndex(([id]) => id === e.eventType);
        if (rank < lastRank)
          warnings.push({
            code: "regressive_history",
            applicationId: app.id,
            eventId: e.id,
          });
        else {
          milestones.push(e.eventType);
          seen.add(e.eventType);
          lastRank = rank;
        }
      }
      if (TERMINAL_STATUS.has(e.status)) terminal = true;
    }
    const endpoint = endpointFor(evs, app);
    paths.push({
      applicationId: app.id,
      origin,
      milestones,
      endpoint,
      nodes: [
        `origin:${origin}`,
        ...milestones.map((m) => `milestone:${m}`),
        `endpoint:${endpoint}`,
      ],
    });
  }
  const linkMap = new Map();
  for (const p of paths)
    for (let i = 0; i < p.nodes.length - 1; i += 1) {
      const id = `${p.nodes[i]}=>${p.nodes[i + 1]}`;
      const l = linkMap.get(id) ?? {
        id,
        source: p.nodes[i],
        target: p.nodes[i + 1],
        value: 0,
        applicationIds: [],
      };
      l.value += 1;
      l.applicationIds.push(p.applicationId);
      linkMap.set(id, l);
    }
  const links = [...linkMap.values()]
    .map((l) => ({
      ...l,
      applicationIds: [...new Set(l.applicationIds)].sort(cmp),
    }))
    .sort((a, b) => cmp(a.id, b.id));
  const nodeIds = new Set(paths.flatMap((p) => p.nodes));
  const nodes = [
    ...LIFECYCLE_DIAGRAM_TAXONOMY.origins,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.milestones,
    ...LIFECYCLE_DIAGRAM_TAXONOMY.endpoints,
  ]
    .map((n) => ({
      id: n.nodeId,
      taxonomyId: n.id,
      label: n.label,
      rank: n.rank,
      value: paths.filter((p) => p.nodes.includes(n.nodeId)).length,
    }))
    .filter((n) => nodeIds.has(n.id));
  const endpointTotals = Object.fromEntries(
    ENDPOINTS.map(([id]) => [
      id,
      paths.filter((p) => p.endpoint === id).length,
    ]),
  );
  return {
    includedApplications: paths.length,
    totalApplications: apps.length,
    paths,
    nodes,
    links,
    totals: {
      origins: Object.fromEntries(
        ORIGINS.map(([id]) => [
          id,
          paths.filter((p) => p.origin === id).length,
        ]),
      ),
      milestones: Object.fromEntries(
        MILESTONES.map(([id]) => [
          id,
          paths.filter((p) => p.milestones.includes(id)).length,
        ]),
      ),
      endpoints: endpointTotals,
      active: Object.entries(endpointTotals)
        .filter(([id]) => !TERMINAL_ENDPOINTS.has(id))
        .reduce((n, [, v]) => n + v, 0),
      terminal: Object.entries(endpointTotals)
        .filter(([id]) => TERMINAL_ENDPOINTS.has(id))
        .reduce((n, [, v]) => n + v, 0),
    },
    warnings: warnings.sort(
      (a, b) =>
        cmp(a.applicationId, b.applicationId) ||
        cmp(a.code, b.code) ||
        cmp(String(a.eventId), String(b.eventId)),
    ),
    counts: { warnings: warnings.length, warningCodes: countCodes(warnings) },
  };
};
export function buildLifecycleTimeline(bundle = {}) {
  const warnings = [];
  const buckets = new Map();
  for (const e of effective([...(bundle.lifecycleEvents ?? [])])) {
    const t = parseTime(e, warnings);
    const id = t.known ? t.key : "unknown";
    buckets.set(id, {
      id,
      label:
        id === "unknown" ? "Unknown date" : id.replace(/^(date|instant):/, ""),
      cutoff: id,
      eventIds: [...(buckets.get(id)?.eventIds ?? []), e.id].sort(cmp),
    });
  }
  const dated = [...buckets.values()]
    .filter((b) => b.id !== "unknown")
    .sort((a, b) => cmp(a.id, b.id));
  return {
    buckets: [
      {
        id: "unknown-date",
        label: "Unknown date",
        cutoff: "unknown",
        eventIds: buckets.get("unknown")?.eventIds ?? [],
      },
      ...dated,
      {
        id: "current",
        label: "Current",
        cutoff: "current",
        eventIds: [...(bundle.lifecycleEvents ?? [])]
          .map((e) => e.id)
          .filter(Boolean)
          .sort(cmp),
      },
    ],
    warnings,
    counts: { buckets: dated.length + 2, warnings: warnings.length },
  };
}
export function projectLifecycleAt(bundle = {}, bucketId = "current") {
  const timeline = buildLifecycleTimeline(bundle);
  const bucket =
    timeline.buckets.find((b) => b.id === bucketId || b.cutoff === bucketId) ??
    timeline.buckets.at(-1);
  const projection = project(bundle, bucket.cutoff);
  return {
    bucket: {
      id: bucket.id,
      label: bucket.label,
      cutoff: bucket.cutoff,
      eventIds: bucket.eventIds,
    },
    ...projection,
    boundaryEvents: bucket.eventIds,
    warnings: [...timeline.warnings, ...projection.warnings].sort(
      (a, b) =>
        cmp(a.applicationId ?? "", b.applicationId ?? "") ||
        cmp(a.code, b.code),
    ),
  };
}
