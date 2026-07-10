import {
  browserApplicationExportV1Schema,
  browserApplicationExportV2Schema,
  browserApplicationLifecycleEventTypeSchema,
} from "../../domain/browserApplication.js";

export const BROWSER_BACKUP_SCHEMA_VERSION = 2;
export const LOCAL_SETTINGS_SCHEMA_VERSION = 2;

const ORIGIN_TYPES = [
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
];
const ORIGIN_SET = new Set(ORIGIN_TYPES);
const CANONICAL_EVENT_TYPES = new Set(
  browserApplicationLifecycleEventTypeSchema.options,
);
const LEGACY_EVENT_TYPES = new Map([
  ["application_submitted", "application_submitted"],
  ["hiring_manager_reply", "employer_response_received"],
  ["recruiter_screen_scheduled", "recruiter_screen"],
  ["recruiter_screen_completed", "recruiter_screen"],
  ["devops_interview_scheduled", "technical_interview"],
  ["devops_interview_completed", "technical_interview"],
  ["technical_interview_scheduled", "technical_interview"],
  ["technical_interview_completed", "technical_interview"],
  ["technical_screen_scheduled", "technical_interview"],
  ["technical_screen_completed", "technical_interview"],
  ["onsite_interview_scheduled", "onsite_final_loop"],
  ["onsite_interview_completed", "onsite_final_loop"],
  ["final_interview_scheduled", "onsite_final_loop"],
  ["final_interview_completed", "onsite_final_loop"],
  ["written_assessment", "assessment_take_home"],
  ["written_assessment_requested", "assessment_take_home"],
  ["written_assessment_submitted", "assessment_take_home"],
  ["take_home", "assessment_take_home"],
  ["take_home_requested", "assessment_take_home"],
  ["take_home_submitted", "assessment_take_home"],
  ["next_tracking_step", "status_changed"],
]);
const STRUCTURED_ALIASES = new Map([
  ["recruiter_screen", "recruiter_screen"],
  ["technical_screen", "technical_interview"],
  ["onsite_loop", "onsite_final_loop"],
  ["offer", "offer_received"],
]);
const STATUS_EVENT = new Map([
  ["applied", "application_submitted"],
  ["outreach_sent", "candidate_outreach"],
  ["offer", "offer_negotiating"],
  ["accepted", "offer_accepted"],
  ["rejected", "employer_rejected"],
  ["withdrawn", "candidate_withdrew"],
  ["closed_archived", "closed_archived"],
]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
const epoch = (value) =>
  value === "1970-01-01" ||
  value === "1970-01-01T00:00:00.000Z" ||
  value === "1970-01-01T00:00:00Z";
const datePart = (value) => String(value).slice(0, 10);
const stableId = (...parts) =>
  parts
    .map(
      (p) =>
        String(p ?? "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "x",
    )
    .join("_");
const warning = (code, details = {}) => ({ code, ...details });

export const normalizeLifecycleEventType = (event, warnings = []) => {
  const raw = event.eventType;
  if (CANONICAL_EVENT_TYPES.has(raw)) return { eventType: raw };
  if (LEGACY_EVENT_TYPES.has(raw))
    return { eventType: LEGACY_EVENT_TYPES.get(raw), rawEventType: raw };
  const structured = event.status ?? event.stage;
  if (STRUCTURED_ALIASES.has(structured))
    return { eventType: STRUCTURED_ALIASES.get(structured), rawEventType: raw };
  if (raw || structured)
    warnings.push(
      warning("unknown_lifecycle_event_type", { eventId: event.id }),
    );
  return { eventType: "status_changed", rawEventType: raw || undefined };
};

const normalizeOccurredAt = (event) => {
  if (event.occurredAtPrecision)
    return {
      occurredAt: event.occurredAt,
      occurredAtPrecision: event.occurredAtPrecision,
    };
  if (epoch(event.occurredAt))
    return {
      occurredAt: datePart(event.occurredAt),
      occurredAtPrecision: "unknown",
    };
  if (event.occurredAtHasTime === true)
    return { occurredAt: event.occurredAt, occurredAtPrecision: "instant" };
  if (event.occurredAtHasTime === false)
    return {
      occurredAt: datePart(event.occurredAt),
      occurredAtPrecision: "date",
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

const inferOrigin = (app, outreach, events, warnings) => {
  const originEvent = effectiveEvents(events)
    .filter((e) => ORIGIN_SET.has(e.eventType))
    .sort(
      (a, b) =>
        ORIGIN_TYPES.indexOf(a.eventType) - ORIGIN_TYPES.indexOf(b.eventType) ||
        a.id.localeCompare(b.id),
    )[0];
  if (originEvent)
    return {
      origin: originEvent.eventType,
      eventTime: originEvent.occurredAt,
      precision: originEvent.occurredAtPrecision,
      eventExists: true,
    };
  if (normalizeText(app.source) === "referral") return { origin: "referral" };
  const evidence = [];
  if (app.appliedAt)
    evidence.push({
      origin: "application_submitted",
      at: app.appliedAt,
      id: app.id,
      precision: "instant",
    });
  for (const m of outreach) {
    if (m.direction === "inbound" && m.receivedAt)
      evidence.push({
        origin: "recruiter_company_outreach",
        at: m.receivedAt,
        id: m.id,
        precision: "instant",
      });
    if (m.direction === "outbound" && m.sentAt)
      evidence.push({
        origin: "candidate_outreach",
        at: m.sentAt,
        id: m.id,
        precision: "instant",
      });
  }
  if (!evidence.length) return { origin: "other_unknown" };
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
      a.at.localeCompare(b.at) ||
      ORIGIN_TYPES.indexOf(a.origin) - ORIGIN_TYPES.indexOf(b.origin) ||
      a.id.localeCompare(b.id),
  );
  return { ...evidence[0], eventTime: evidence[0].at };
};

const normalizeEvent = (event, warnings) => {
  const type = normalizeLifecycleEventType(event, warnings);
  const time = normalizeOccurredAt(event);
  const out = {
    ...event,
    ...type,
    ...time,
    inferred: event.inferred ?? false,
    createdAt: event.createdAt,
  };
  delete out.occurredAtHasTime;
  delete out.dueAtHasTime;
  if (type.eventType === "assessment_take_home" && !out.actionStatus) {
    if (String(type.rawEventType).endsWith("_requested")) {
      out.actionStatus = "requested";
      out.actionInferred = true;
    }
    if (String(type.rawEventType).endsWith("_submitted")) {
      out.actionStatus = "submitted";
      out.actionInferred = true;
    }
  }
  return out;
};

export const upgradeBrowserExportToV2 = (
  input,
  { migrationTimestamp = new Date().toISOString() } = {},
) => {
  const source = clone(input);
  const warnings = [];
  const v2 = browserApplicationExportV2Schema.safeParse(source);
  if (v2.success) return { data: v2.data, warnings };
  const v1res = browserApplicationExportV1Schema.safeParse(source);
  if (!v1res.success)
    return { data: browserApplicationExportV2Schema.parse(source), warnings };
  const v1 = v1res.data;
  const eventsByApp = new Map();
  for (const event of v1.lifecycleEvents) {
    const normalized = normalizeEvent(event, warnings);
    if (!eventsByApp.has(normalized.applicationId))
      eventsByApp.set(normalized.applicationId, []);
    eventsByApp.get(normalized.applicationId).push(normalized);
  }
  const outreachByApp = new Map();
  for (const message of v1.outreachMessages) {
    if (!outreachByApp.has(message.applicationId))
      outreachByApp.set(message.applicationId, []);
    outreachByApp.get(message.applicationId).push(message);
  }
  const lifecycleEvents = [...eventsByApp.values()].flat();
  const applications = v1.applications.map((app) => {
    const appEvents = lifecycleEvents.filter((e) => e.applicationId === app.id);
    const originInfo = inferOrigin(
      app,
      outreachByApp.get(app.id) ?? [],
      appEvents,
      warnings,
    );
    if (
      !originInfo.eventExists &&
      originInfo.eventTime &&
      originInfo.origin !== "other_unknown"
    ) {
      const id = stableId(
        "event",
        app.id,
        "origin",
        originInfo.origin,
        originInfo.eventTime,
      );
      if (
        !appEvents.some((e) => e.id === id || e.eventType === originInfo.origin)
      )
        lifecycleEvents.push({
          id,
          applicationId: app.id,
          status: app.status,
          eventType: originInfo.origin,
          occurredAt: originInfo.eventTime,
          occurredAtPrecision: originInfo.precision ?? "instant",
          inferred: true,
          source: "browser_migration",
          createdAt: migrationTimestamp,
        });
    }
    const statusEventType =
      STATUS_EVENT.get(app.status) ?? STRUCTURED_ALIASES.get(app.status);
    if (
      statusEventType &&
      !effectiveEvents(
        lifecycleEvents.filter((e) => e.applicationId === app.id),
      ).some((e) => e.eventType === statusEventType || e.status === app.status)
    ) {
      const anchor = app.updatedAt ?? app.createdAt;
      const id = stableId(
        "event",
        app.id,
        "status_snapshot",
        app.status,
        anchor,
      );
      if (!lifecycleEvents.some((e) => e.id === id))
        lifecycleEvents.push({
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
    return { ...app, origin: originInfo.origin };
  });
  const settings = v1.settings
    ? { ...v1.settings, schemaVersion: 2 }
    : undefined;
  const data = {
    ...v1,
    schemaVersion: 2,
    applications,
    lifecycleEvents: lifecycleEvents.sort((a, b) => a.id.localeCompare(b.id)),
    settings,
  };
  return { data: browserApplicationExportV2Schema.parse(data), warnings };
};
