import {
  browserApplicationExportSchema,
  browserApplicationLifecycleEventTypeSchema,
  browserApplicationOriginSchema,
  browserApplicationV1ExportSchema,
} from "../../domain/browserApplication.js";

export const BROWSER_BACKUP_SCHEMA_VERSION = 2;
export const LOCAL_SETTINGS_SCHEMA_VERSION = 2;

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
export const ORIGIN_VALUES = browserApplicationOriginSchema.options;
export const CANONICAL_EVENT_TYPES =
  browserApplicationLifecycleEventTypeSchema.options;
const ORIGIN_SET = new Set(ORIGIN_VALUES);
const EVENT_SET = new Set(CANONICAL_EVENT_TYPES);
const LEGACY_EVENT_TYPES = new Map(
  Object.entries({
    application_submitted: "application_submitted",
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
  }),
);
const STATUS_STAGE_ALIAS = new Map([
  ["recruiter_screen", "recruiter_screen"],
  ["technical_screen", "technical_interview"],
  ["onsite_loop", "onsite_final_loop"],
  ["offer", "offer_received"],
]);
const STATUS_EVENT = new Map([
  ["offer", "offer_negotiating"],
  ["accepted", "offer_accepted"],
  ["rejected", "employer_rejected"],
  ["withdrawn", "candidate_withdrew"],
  ["closed_archived", "closed_archived"],
]);
const clean = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
const clone = (v) => JSON.parse(JSON.stringify(v));
const isDateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
const epoch = (v) =>
  v === "1970-01-01" ||
  v === "1970-01-01T00:00:00.000Z" ||
  v === "1970-01-01T00:00:00Z";
const datePart = (v) => String(v).slice(0, 10);
const stableId = (...parts) =>
  parts.map((p) => String(p ?? "").replace(/[^a-zA-Z0-9_-]+/g, "_")).join("_");
const warning = (code, extra = {}) => ({ code, ...extra });

export const normalizeLifecycleEventType = (event, warnings = []) => {
  const raw = clean(event.eventType);
  if (EVENT_SET.has(raw)) return { eventType: raw };
  if (LEGACY_EVENT_TYPES.has(raw)) {
    const out = { eventType: LEGACY_EVENT_TYPES.get(raw), rawEventType: raw };
    if (out.eventType === "assessment_take_home" && !event.actionStatus) {
      if (raw.endsWith("_requested"))
        Object.assign(out, {
          actionStatus: "requested",
          actionStatusInferred: true,
        });
      if (raw.endsWith("_submitted"))
        Object.assign(out, {
          actionStatus: "submitted",
          actionStatusInferred: true,
        });
    }
    return out;
  }
  const alias =
    STATUS_STAGE_ALIAS.get(clean(event.status)) ||
    STATUS_STAGE_ALIAS.get(clean(event.stage));
  if (alias) return { eventType: alias, rawEventType: raw || undefined };
  if (raw || event.stage)
    warnings.push(
      warning("unknown_structured_lifecycle_value", {
        applicationId: event.applicationId,
      }),
    );
  return { eventType: "status_changed", rawEventType: raw || undefined };
};

const normalizePrecision = (event) => {
  if (["instant", "date", "unknown"].includes(event.occurredAtPrecision))
    return {
      occurredAt: event.occurredAt,
      occurredAtPrecision: event.occurredAtPrecision,
    };
  if (event.occurredAtHasTime === true)
    return { occurredAt: event.occurredAt, occurredAtPrecision: "instant" };
  if (event.occurredAtHasTime === false)
    return {
      occurredAt: datePart(event.occurredAt),
      occurredAtPrecision: "date",
    };
  if (epoch(event.occurredAt))
    return {
      occurredAt: datePart(event.occurredAt),
      occurredAtPrecision: "unknown",
    };
  if (isDateOnly(event.occurredAt))
    return { occurredAt: event.occurredAt, occurredAtPrecision: "date" };
  return { occurredAt: event.occurredAt, occurredAtPrecision: "instant" };
};
const effectiveEvents = (events) => {
  const superseded = new Set(
    events.map((e) => e.supersedesEventId).filter(Boolean),
  );
  return events.filter((e) => !superseded.has(e.id));
};
const originFromEvents = (events) =>
  effectiveEvents(events).find((e) => ORIGIN_SET.has(e.eventType))?.eventType;
const inferOrigin = (app, bundle, events, warnings) => {
  const originEvent = originFromEvents(events);
  if (originEvent) return { origin: originEvent, timed: false };
  if (clean(app.source) === "referral")
    return { origin: "referral", timed: false };
  const evidence = [];
  if (app.appliedAt)
    evidence.push({
      origin: "application_submitted",
      at: app.appliedAt,
      id: app.id,
    });
  for (const m of bundle.outreachMessages.filter(
    (m) => m.applicationId === app.id,
  )) {
    if (m.direction === "inbound" && m.receivedAt)
      evidence.push({
        origin: "recruiter_company_outreach",
        at: m.receivedAt,
        id: m.id,
      });
    if (m.direction === "outbound" && m.sentAt)
      evidence.push({ origin: "candidate_outreach", at: m.sentAt, id: m.id });
  }
  if (!evidence.length) return { origin: "other_unknown", timed: false };
  const distinct = new Set(evidence.map((e) => e.origin));
  if (distinct.size > 1)
    warnings.push(
      warning("origin_structured_evidence_conflict", {
        applicationId: app.id,
        count: evidence.length,
      }),
    );
  evidence.sort(
    (a, b) =>
      String(a.at).localeCompare(String(b.at)) ||
      ORIGIN_VALUES.indexOf(a.origin) - ORIGIN_VALUES.indexOf(b.origin) ||
      String(a.id).localeCompare(String(b.id)),
  );
  return {
    origin: evidence[0].origin,
    at: evidence[0].at,
    precision: isDateOnly(evidence[0].at) ? "date" : "instant",
    timed: true,
  };
};
const normalizeEvent = (event, warnings) => {
  const mapped = normalizeLifecycleEventType(event, warnings);
  const precision = normalizePrecision(event);
  return {
    ...event,
    ...mapped,
    rawEventType: event.rawEventType ?? mapped.rawEventType,
    actionStatus: event.actionStatus ?? mapped.actionStatus,
    actionStatusInferred:
      event.actionStatusInferred ?? mapped.actionStatusInferred,
    ...precision,
    inferred: Boolean(event.inferred),
    createdAt: event.createdAt,
  };
};

export const upgradeBrowserExportToV2 = (
  input,
  { migrationTimestamp = new Date().toISOString() } = {},
) => {
  const data = clone(input);
  const warnings = [];
  let parsed = browserApplicationExportSchema.safeParse(data).success
    ? data
    : browserApplicationV1ExportSchema.parse(data);
  const bundle = {
    schemaVersion: 2,
    exportedAt: parsed.exportedAt,
    ...Object.fromEntries(ARRAY_STORES.map((s) => [s, parsed[s] ?? []])),
    settings: parsed.settings,
  };
  bundle.lifecycleEvents = bundle.lifecycleEvents.map((event) =>
    normalizeEvent(event, warnings),
  );
  bundle.applications = bundle.applications.map((app) => {
    const appEvents = bundle.lifecycleEvents.filter(
      (event) => event.applicationId === app.id,
    );
    const inferred = inferOrigin(app, bundle, appEvents, warnings);
    return { ...app, origin: app.origin ?? inferred.origin };
  });
  for (const app of bundle.applications) {
    const appEvents = bundle.lifecycleEvents.filter(
      (event) => event.applicationId === app.id,
    );
    const inferred = inferOrigin(app, bundle, appEvents, warnings);
    if (!originFromEvents(appEvents) && inferred.timed) {
      const id = stableId(
        "event",
        app.id,
        "origin",
        inferred.origin,
        inferred.at,
      );
      if (!bundle.lifecycleEvents.some((e) => e.id === id))
        bundle.lifecycleEvents.push({
          id,
          applicationId: app.id,
          status: app.status,
          eventType: inferred.origin,
          occurredAt:
            inferred.precision === "date" ? datePart(inferred.at) : inferred.at,
          occurredAtPrecision: inferred.precision,
          inferred: true,
          source: "browser_migration",
          createdAt: migrationTimestamp,
        });
    }
    const represented = effectiveEvents(
      bundle.lifecycleEvents.filter((e) => e.applicationId === app.id),
    ).some(
      (event) =>
        event.status === app.status ||
        STATUS_STAGE_ALIAS.get(event.status) ||
        STATUS_EVENT.get(app.status) === event.eventType,
    );
    if (!represented) {
      const anchor = app.updatedAt ?? app.createdAt;
      const id = stableId(
        "event",
        app.id,
        "migration_status_snapshot",
        app.status,
        anchor,
      );
      if (!bundle.lifecycleEvents.some((e) => e.id === id))
        bundle.lifecycleEvents.push({
          id,
          applicationId: app.id,
          status: app.status,
          eventType: "migration_status_snapshot",
          occurredAt: anchor,
          occurredAtPrecision: "unknown",
          inferred: true,
          source: "browser_migration",
          createdAt: migrationTimestamp,
        });
    }
  }
  if (bundle.settings)
    bundle.settings = { ...bundle.settings, schemaVersion: 2 };
  const result = browserApplicationExportSchema.parse(bundle);
  return { data: result, warnings };
};
