import {
  browserApplicationExportSchema,
  browserApplicationLifecycleEventTypeSchema,
  browserApplicationV1ExportSchema,
} from "../../domain/browserApplication.js";

export const BROWSER_BACKUP_SCHEMA_VERSION = 2;
export const LOCAL_SETTINGS_SCHEMA_VERSION = 2;

const ORIGIN_ORDER = [
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
];
const ORIGIN_SET = new Set(ORIGIN_ORDER);
const CANONICAL_EVENTS = new Set(
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
  ["recruiter_screen", "recruiter_screen"],
  ["technical_screen", "technical_interview"],
  ["onsite_loop", "onsite_final_loop"],
  ["offer", "offer_received"],
  ["accepted", "offer_accepted"],
  ["rejected", "employer_rejected"],
  ["withdrawn", "candidate_withdrew"],
  ["closed_archived", "closed_archived"],
]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const epoch = new Set([
  "1970-01-01",
  "1970-01-01T00:00:00.000Z",
  "1970-01-01T00:00:00Z",
]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const slug = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "record";
const stableId = (...parts) => parts.map(slug).join("_");
const norm = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
const compareEvidence = (a, b) =>
  a.at.localeCompare(b.at) ||
  ORIGIN_ORDER.indexOf(a.origin) - ORIGIN_ORDER.indexOf(b.origin) ||
  a.id.localeCompare(b.id);

const precisionFor = (event) => {
  if (["instant", "date", "unknown"].includes(event.occurredAtPrecision))
    return event.occurredAtPrecision;
  if (event.occurredAtHasTime === true) return "instant";
  if (event.occurredAtHasTime === false) return "date";
  if (epoch.has(event.occurredAt)) return "unknown";
  if (isoDate.test(String(event.occurredAt))) return "date";
  return "instant";
};
const occurredAtFor = (event, precision) => {
  if (precision === "date" && event.occurredAtHasTime === false)
    return String(event.occurredAt).slice(0, 10);
  if (
    precision === "unknown" &&
    String(event.occurredAt).startsWith("1970-01-01")
  )
    return "1970-01-01";
  return event.occurredAt;
};
const normalizeEventType = (event, warnings) => {
  const raw = event.eventType;
  if (CANONICAL_EVENTS.has(raw)) return { eventType: raw };
  if (LEGACY_EVENT_TYPES.has(raw))
    return { eventType: LEGACY_EVENT_TYPES.get(raw), rawEventType: raw };
  for (const field of [event.status, event.stage]) {
    if (STRUCTURED_ALIASES.has(field))
      return { eventType: STRUCTURED_ALIASES.get(field), rawEventType: raw };
  }
  if (raw) warnings.push({ code: "unknown_lifecycle_event_type", count: 1 });
  return { eventType: "status_changed", rawEventType: raw };
};
const normalizeEvent = (event, warnings) => {
  const precision = precisionFor(event);
  const type = normalizeEventType(event, warnings);
  const out = {
    ...event,
    ...type,
    occurredAt: occurredAtFor(event, precision),
    occurredAtPrecision: precision,
    inferred: Boolean(event.inferred),
  };
  if (!out.eventType)
    out.eventType = STATUS_EVENT.get(out.status) ?? "status_changed";
  if (!out.rawEventType) delete out.rawEventType;
  if (!out.previousStatus) delete out.previousStatus;
  if (!out.supersedesEventId) delete out.supersedesEventId;
  if (out.eventType === "assessment_take_home" && !out.actionStatus) {
    if (
      ["written_assessment_requested", "take_home_requested"].includes(
        type.rawEventType,
      )
    )
      out.actionStatus = "requested";
    if (
      ["written_assessment_submitted", "take_home_submitted"].includes(
        type.rawEventType,
      )
    )
      out.actionStatus = "submitted";
  }
  delete out.occurredAtHasTime;
  delete out.dueAtHasTime;
  delete out.stage;
  return out;
};
const effectiveEvents = (events) => {
  const superseded = new Set(
    events.map((e) => e.supersedesEventId).filter(Boolean),
  );
  return events.filter((e) => !superseded.has(e.id));
};
const inferOrigin = (app, events, messages, warnings) => {
  const originEvent = effectiveEvents(events)
    .filter((e) => e.applicationId === app.id && ORIGIN_SET.has(e.eventType))
    .sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    )[0];
  if (originEvent) return { origin: originEvent.eventType, evidence: null };
  if (norm(app.source) === "referral")
    return { origin: "referral", evidence: null };
  const evidence = [];
  if (app.appliedAt)
    evidence.push({
      origin: "application_submitted",
      at: app.appliedAt,
      id: app.id,
    });
  for (const m of messages.filter((m) => m.applicationId === app.id)) {
    if (m.direction === "inbound" && m.receivedAt)
      evidence.push({
        origin: "recruiter_company_outreach",
        at: m.receivedAt,
        id: m.id,
      });
    if (m.direction === "outbound" && m.sentAt)
      evidence.push({ origin: "candidate_outreach", at: m.sentAt, id: m.id });
  }
  if (!evidence.length) return { origin: "other_unknown", evidence: null };
  evidence.sort(compareEvidence);
  if (new Set(evidence.map((e) => e.origin)).size > 1)
    warnings.push({ code: "origin_structured_evidence_conflict", count: 1 });
  return { origin: evidence[0].origin, evidence: evidence[0] };
};
const hasStatusRepresented = (app, events) =>
  effectiveEvents(events).some(
    (e) =>
      e.applicationId === app.id &&
      (e.status === app.status || e.eventType === STATUS_EVENT.get(app.status)),
  );

export const upgradeBrowserExportToV2 = (input, options = {}) => {
  const migrationCreatedAt =
    options.migrationCreatedAt ?? new Date().toISOString();
  const warnings = [];
  const source = clone(input);
  let parsed;
  if (source?.schemaVersion === 2) {
    const v2 = browserApplicationExportSchema.safeParse(source);
    parsed = v2.success
      ? v2.data
      : browserApplicationV1ExportSchema.parse({ ...source, schemaVersion: 1 });
  } else
    parsed = browserApplicationV1ExportSchema.parse({
      ...source,
      schemaVersion: 1,
    });
  const lifecycleEvents = parsed.lifecycleEvents.map((event) =>
    normalizeEvent(event, warnings),
  );
  const outreachMessages = parsed.outreachMessages ?? [];
  const applications = parsed.applications.map((app) => {
    const { origin, evidence } = app.origin
      ? { origin: app.origin, evidence: null }
      : inferOrigin(app, lifecycleEvents, outreachMessages, warnings);
    const out = { ...app, origin };
    if (
      !effectiveEvents(lifecycleEvents).some(
        (e) => e.applicationId === app.id && ORIGIN_SET.has(e.eventType),
      ) &&
      evidence
    ) {
      lifecycleEvents.push({
        id: stableId("event", app.id, "origin", origin, evidence.at),
        applicationId: app.id,
        status: app.status,
        eventType: origin,
        occurredAt: isoDate.test(evidence.at) ? evidence.at : evidence.at,
        occurredAtPrecision: isoDate.test(evidence.at) ? "date" : "instant",
        inferred: true,
        source: "browser_migration",
        createdAt: migrationCreatedAt,
      });
    }
    return out;
  });
  for (const app of applications) {
    if (!hasStatusRepresented(app, lifecycleEvents)) {
      const anchor = app.updatedAt ?? app.createdAt;
      const id = stableId(
        "event",
        app.id,
        "migration_status_snapshot",
        app.status,
        anchor,
      );
      if (
        !lifecycleEvents.some(
          (e) =>
            e.id === id ||
            (e.applicationId === app.id &&
              e.eventType === "migration_status_snapshot" &&
              e.status === app.status),
        )
      ) {
        lifecycleEvents.push({
          id,
          applicationId: app.id,
          status: app.status,
          eventType: "migration_status_snapshot",
          occurredAt: anchor,
          occurredAtPrecision: "unknown",
          inferred: true,
          source: "browser_migration",
          createdAt: migrationCreatedAt,
        });
      }
    }
  }
  const settings = parsed.settings
    ? { ...parsed.settings, schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION }
    : undefined;
  const data = browserApplicationExportSchema.parse({
    ...parsed,
    schemaVersion: BROWSER_BACKUP_SCHEMA_VERSION,
    applications,
    lifecycleEvents,
    settings,
  });
  return { data, warnings };
};
