import {
  BROWSER_EXPORT_SCHEMA_VERSION,
  LOCAL_SETTINGS_SCHEMA_VERSION,
  browserApplicationCanonicalEventTypeSchema,
  browserApplicationExportV1Schema,
  browserApplicationExportV2Schema,
} from "../../domain/browserApplication.js";

const ORIGIN_ORDER = [
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
];
const ORIGIN_EVENTS = new Set(ORIGIN_ORDER);
const CANONICAL_EVENTS = new Set(
  browserApplicationCanonicalEventTypeSchema.options,
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
const STRUCTURED_MILESTONE_ALIASES = new Map([
  ["recruiter_screen", "recruiter_screen"],
  ["technical_screen", "technical_interview"],
  ["onsite_loop", "onsite_final_loop"],
  ["offer", "offer_received"],
]);
const STATUS_TO_EVENT = new Map([
  ["applied", "application_submitted"],
  ["outreach_sent", "candidate_outreach"],
  ["offer", "offer_negotiating"],
  ["accepted", "offer_accepted"],
  ["rejected", "employer_rejected"],
  ["withdrawn", "candidate_withdrew"],
  ["closed_archived", "closed_archived"],
]);
const STATUS_ENDPOINT_EVENT = new Map([
  ...STATUS_TO_EVENT,
  ...STRUCTURED_MILESTONE_ALIASES,
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeExact = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
const isEpoch = (value) =>
  value === "1970-01-01" ||
  value === "1970-01-01T00:00:00.000Z" ||
  value === "1970-01-01T00:00:00Z";
const dateKey = (value) => (isDateOnly(value) ? value : String(value ?? ""));
const cmp = (a, b) => String(a).localeCompare(String(b));
const stableId = (...parts) =>
  parts
    .map(
      (p) =>
        String(p ?? "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "record",
    )
    .join("_");
const warning = (code, extra = {}) => ({ code, count: 1, ...extra });

export const normalizeLifecycleEventType = (event, warnings = []) => {
  const raw = normalizeExact(event.eventType);
  let eventType;
  let rawEventType;
  if (CANONICAL_EVENTS.has(raw)) eventType = raw;
  else if (LEGACY_EVENT_TYPES.has(raw)) {
    eventType = LEGACY_EVENT_TYPES.get(raw);
    rawEventType = raw;
  } else if (STRUCTURED_MILESTONE_ALIASES.has(event.status)) {
    eventType = STRUCTURED_MILESTONE_ALIASES.get(event.status);
  } else if (STRUCTURED_MILESTONE_ALIASES.has(event.stage)) {
    eventType = STRUCTURED_MILESTONE_ALIASES.get(event.stage);
  } else if (raw) {
    eventType = "status_changed";
    rawEventType = raw;
    warnings.push(warning("unknown_legacy_event_type"));
  } else if (STATUS_TO_EVENT.has(event.status))
    eventType = STATUS_TO_EVENT.get(event.status);
  else eventType = "status_changed";
  const patch = { eventType };
  if (rawEventType && rawEventType !== eventType)
    patch.rawEventType = rawEventType;
  if (eventType === "assessment_take_home" && !event.actionStatus) {
    if (raw.endsWith("_requested"))
      Object.assign(patch, {
        actionStatus: "requested",
        actionStatusInferred: true,
      });
    if (raw.endsWith("_submitted"))
      Object.assign(patch, {
        actionStatus: "submitted",
        actionStatusInferred: true,
      });
  }
  return patch;
};

const normalizeOccurred = (event) => {
  const original = event.occurredAt;
  if (event.occurredAtPrecision)
    return {
      occurredAt: original,
      occurredAtPrecision: event.occurredAtPrecision,
    };
  if (isEpoch(original))
    return {
      occurredAt: isDateOnly(original) ? original : "1970-01-01",
      occurredAtPrecision: "unknown",
    };
  if (event.occurredAtHasTime === false)
    return {
      occurredAt: String(original).slice(0, 10),
      occurredAtPrecision: "date",
    };
  if (event.occurredAtHasTime === true)
    return { occurredAt: original, occurredAtPrecision: "instant" };
  if (isDateOnly(original))
    return { occurredAt: original, occurredAtPrecision: "date" };
  return { occurredAt: original, occurredAtPrecision: "instant" };
};

const effectiveEvents = (events) => {
  const superseded = new Set(
    events.map((e) => e.supersedesEventId).filter(Boolean),
  );
  return events.filter((e) => !superseded.has(e.id));
};

export const inferApplicationOrigin = (
  application,
  bundle,
  events,
  warnings = [],
) => {
  const effective = effectiveEvents(
    events.filter((e) => e.applicationId === application.id),
  );
  const originEvent = effective
    .filter((e) => ORIGIN_EVENTS.has(e.eventType))
    .sort(
      (a, b) =>
        cmp(dateKey(a.occurredAt), dateKey(b.occurredAt)) ||
        ORIGIN_ORDER.indexOf(a.eventType) - ORIGIN_ORDER.indexOf(b.eventType) ||
        cmp(a.id, b.id),
    )[0];
  if (originEvent)
    return {
      origin: originEvent.eventType,
      evidence: originEvent,
      createEvent: false,
    };
  if (normalizeExact(application.source) === "referral")
    return { origin: "referral", createEvent: false };
  const evidence = [];
  if (application.appliedAt)
    evidence.push({
      origin: "application_submitted",
      at: application.appliedAt,
      id: application.id,
      precision: isDateOnly(application.appliedAt) ? "date" : "instant",
    });
  for (const m of bundle.outreachMessages ?? []) {
    if (m.applicationId !== application.id) continue;
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
  if (evidence.length === 0)
    return { origin: "other_unknown", createEvent: false };
  const distinct = new Set(evidence.map((e) => e.origin));
  if (distinct.size > 1)
    warnings.push(
      warning("origin_structured_evidence_conflict", {
        applicationId: application.id,
      }),
    );
  evidence.sort(
    (a, b) =>
      cmp(dateKey(a.at), dateKey(b.at)) ||
      ORIGIN_ORDER.indexOf(a.origin) - ORIGIN_ORDER.indexOf(b.origin) ||
      cmp(a.id, b.id),
  );
  return {
    origin: evidence[0].origin,
    evidence: evidence[0],
    createEvent: true,
  };
};

const normalizeEvent = (event, warnings) => {
  const { occurredAt, occurredAtPrecision } = normalizeOccurred(event);
  const typePatch = normalizeLifecycleEventType(event, warnings);
  const normalized = {
    ...event,
    ...typePatch,
    occurredAt,
    occurredAtPrecision,
    inferred: Boolean(event.inferred),
    createdAt: event.createdAt,
  };
  delete normalized.occurredAtHasTime;
  delete normalized.dueAtHasTime;
  return normalized;
};

const hasRepresentingEvent = (application, events) => {
  const expected = STATUS_ENDPOINT_EVENT.get(application.status);
  if (!expected) return false;
  return effectiveEvents(
    events.filter((e) => e.applicationId === application.id),
  ).some((e) => e.eventType === expected || e.status === application.status);
};

const normalizeSettings = (settings) =>
  settings
    ? { ...settings, schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION }
    : undefined;

export const upgradeBrowserExportToV2 = (input, options = {}) => {
  const migrationCreatedAt =
    options.migrationCreatedAt ?? new Date().toISOString();
  const source = clone(input ?? {});
  const warnings = [];
  const inputVersion = source.schemaVersion ?? 1;
  let base;
  if (inputVersion === BROWSER_EXPORT_SCHEMA_VERSION) {
    base = clone(source);
  } else {
    const parsed = browserApplicationExportV1Schema.parse({
      schemaVersion: 1,
      exportedAt: source.exportedAt ?? migrationCreatedAt,
      applications: source.applications ?? [],
      contacts: source.contacts ?? [],
      outreachMessages: source.outreachMessages ?? [],
      lifecycleEvents: source.lifecycleEvents ?? [],
      interviews: source.interviews ?? [],
      offers: source.offers ?? [],
      artifacts: source.artifacts ?? [],
      reminders: source.reminders ?? [],
      settings: source.settings,
    });
    base = parsed;
  }
  let events = (base.lifecycleEvents ?? []).map((event) =>
    normalizeEvent(event, warnings),
  );
  const applications = (base.applications ?? []).map((application) => {
    if (application.origin && inputVersion === BROWSER_EXPORT_SCHEMA_VERSION)
      return application;
    const inferred = inferApplicationOrigin(
      application,
      base,
      events,
      warnings,
    );
    return { ...application, origin: inferred.origin };
  });
  for (const app of applications) {
    const inferred = inferApplicationOrigin(app, base, events, warnings);
    if (
      inferred.createEvent &&
      !events.some(
        (e) => e.applicationId === app.id && e.eventType === inferred.origin,
      )
    ) {
      events.push({
        id: stableId(
          "event",
          app.id,
          "origin",
          inferred.origin,
          inferred.evidence.at,
        ),
        applicationId: app.id,
        status: app.status,
        eventType: inferred.origin,
        occurredAt:
          inferred.evidence.precision === "date"
            ? String(inferred.evidence.at).slice(0, 10)
            : inferred.evidence.at,
        occurredAtPrecision: inferred.evidence.precision,
        inferred: true,
        source: "browser_migration",
        createdAt: migrationCreatedAt,
      });
    }
    if (
      !hasRepresentingEvent(app, events) &&
      !events.some(
        (e) =>
          e.applicationId === app.id &&
          e.eventType === "migration_status_snapshot" &&
          e.status === app.status,
      )
    ) {
      const anchor = app.updatedAt ?? app.createdAt ?? migrationCreatedAt;
      events.push({
        id: stableId(
          "event",
          app.id,
          "migration_status_snapshot",
          app.status,
          anchor,
        ),
        applicationId: app.id,
        status: app.status,
        eventType: "migration_status_snapshot",
        occurredAt: isDateOnly(anchor) ? anchor : anchor,
        occurredAtPrecision: "unknown",
        inferred: true,
        source: "browser_migration",
        createdAt: migrationCreatedAt,
      });
    }
  }
  const output = {
    schemaVersion: BROWSER_EXPORT_SCHEMA_VERSION,
    exportedAt: base.exportedAt ?? migrationCreatedAt,
    applications,
    contacts: base.contacts ?? [],
    outreachMessages: base.outreachMessages ?? [],
    lifecycleEvents: events,
    interviews: base.interviews ?? [],
    offers: base.offers ?? [],
    artifacts: base.artifacts ?? [],
    reminders: base.reminders ?? [],
    settings: normalizeSettings(base.settings),
  };
  if (!output.settings) delete output.settings;
  const parsed = browserApplicationExportV2Schema.parse(output);
  const sortedWarnings = warnings.sort(
    (a, b) =>
      cmp(a.code, b.code) || cmp(a.applicationId ?? "", b.applicationId ?? ""),
  );
  return { data: parsed, warnings: sortedWarnings };
};

export const normalizeBrowserExportToV2 = (input, options) =>
  upgradeBrowserExportToV2(input, options).data;
