const ORIGINS = new Set([
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
]);
const INTERVIEW_EVENT = {
  recruiter_screen: "recruiter_screen",
  technical_screen: "technical_interview",
  onsite_loop: "onsite_final_loop",
};
const OFFER_EVENT = {
  received: "offer_received",
  negotiating: "offer_negotiating",
  accepted: "offer_accepted",
  declined: "offer_declined",
  expired: "offer_expired_rescinded",
  rescinded: "offer_expired_rescinded",
};
const terminal = new Set([
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);
const idPart = (part) =>
  String(part ?? "none")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 40);
const hashPart = (part) => {
  const input = String(part ?? "none");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
};
const stableId = (...parts) =>
  `recon_${parts.map(idPart).join("_")}_${parts.map(hashPart).join("_")}`.slice(
    0,
    220,
  );
const sortById = (a, b) => String(a.id).localeCompare(String(b.id));
const sortChronologically = (a, b) =>
  String(a.occurredAt).localeCompare(String(b.occurredAt)) ||
  String(a.id).localeCompare(String(b.id));
const effectiveEvents = (events = []) => {
  const superseded = new Set(
    events.map((event) => event.supersedesEventId).filter(Boolean),
  );
  return events.filter((event) => !superseded.has(event.id)).sort(sortById);
};
const persistedTimestamp = (...records) => {
  for (const record of records) {
    const timestamp = record?.updatedAt || record?.createdAt;
    if (timestamp) return timestamp;
  }
  return undefined;
};
const persistedApplicationTimestamp = (app) =>
  app.updatedAt || app.createdAt || "1970-01-01";
const warn = (warnings, code, applicationId, extra = {}) =>
  warnings.push({ code, applicationId, ...extra });
const event = (
  app,
  eventType,
  occurredAt,
  childId,
  state,
  status = app.status,
  extra = {},
) => ({
  id: stableId("event", app.id, eventType, childId, state),
  applicationId: app.id,
  eventType,
  status,
  previousStatus: app.status,
  occurredAt,
  occurredAtPrecision:
    extra.occurredAtPrecision ??
    (String(occurredAt).includes("T") ? "instant" : "unknown"),
  inferred: true,
  source: "reconciliation",
  createdAt: "1970-01-01T00:00:00.000Z",
  ...extra,
});
const hasEvent = (events, appId, type, childId, state) =>
  events.some(
    (e) =>
      e.applicationId === appId &&
      e.eventType === type &&
      String(e.sourceArtifact ?? "") === String(childId ?? "") &&
      String(e.actionStatus ?? "") === String(state ?? ""),
  );
const add = (plan, existing, app, type, at, childId, state, status, extra) => {
  if (!at) return false;
  if (!hasEvent([...existing, ...plan.additions], app.id, type, childId, state))
    plan.additions.push(
      event(app, type, at, childId, state, status, {
        sourceArtifact: childId,
        actionStatus: state,
        ...extra,
      }),
    );
  return true;
};
const replayStatus = (events) =>
  [...events].sort(sortChronologically).at(-1)?.status;
const detectsRegressiveHistory = (events) => {
  let terminalReached = false;
  for (const event of [...events].sort(sortChronologically)) {
    if (event.eventType === "application_reopened") {
      terminalReached = false;
      continue;
    }
    if (terminalReached && event.status && !terminal.has(event.status))
      return true;
    if (terminal.has(event.status)) terminalReached = true;
  }
  return false;
};
export function planLifecycleReconciliation(bundle = {}) {
  const applications = [...(bundle.applications ?? [])].sort(sortById);
  const existing = effectiveEvents(bundle.lifecycleEvents ?? []);
  const warnings = [];
  const plans = applications.map((app) => {
    const plan = { applicationId: app.id, additions: [], warnings: [] };
    const appEvents = existing.filter((e) => e.applicationId === app.id);
    if (!appEvents.some((e) => ORIGINS.has(e.eventType))) {
      if (!app.appliedAt) warn(warnings, "missing_origin_timestamp", app.id);
      add(
        plan,
        existing,
        app,
        app.origin || "other_unknown",
        app.appliedAt || "1970-01-01",
        "origin",
        app.origin || "other_unknown",
        app.status,
        {
          occurredAtPrecision: app.appliedAt
            ? String(app.appliedAt).includes("T")
              ? "instant"
              : "date"
            : "unknown",
        },
      );
    }
    for (const m of [...(bundle.outreachMessages ?? [])]
      .filter((x) => x.applicationId === app.id)
      .sort(sortById)) {
      if (m.direction === "outbound") {
        const occurredAt = m.sentAt || persistedTimestamp(m);
        if (!m.sentAt) warn(warnings, "unknown_occurrence_precision", app.id);
        if (occurredAt)
          add(
            plan,
            existing,
            app,
            "candidate_outreach",
            occurredAt,
            m.id,
            "outbound",
            app.status,
            {
              channel: m.channel,
              occurredAtPrecision: m.sentAt ? "instant" : "unknown",
            },
          );
        else
          warn(warnings, "unreconciled_child_activity", app.id, {
            childStore: "outreachMessages",
            childId: m.id,
          });
      } else if (m.direction === "inbound") {
        const occurredAt = m.receivedAt || persistedTimestamp(m);
        if (!m.receivedAt)
          warn(warnings, "unknown_occurrence_precision", app.id);
        if (occurredAt)
          add(
            plan,
            existing,
            app,
            "employer_response_received",
            occurredAt,
            m.id,
            "inbound",
            app.status,
            {
              channel: m.channel,
              occurredAtPrecision: m.receivedAt ? "instant" : "unknown",
            },
          );
        else
          warn(warnings, "unreconciled_child_activity", app.id, {
            childStore: "outreachMessages",
            childId: m.id,
          });
      } else
        warn(warnings, "unreconciled_child_activity", app.id, {
          childStore: "outreachMessages",
          childId: m.id,
        });
    }
    for (const i of [...(bundle.interviews ?? [])]
      .filter((x) => x.applicationId === app.id)
      .sort(sortById)) {
      const type = ["cancelled", "no_show"].includes(i.outcome)
        ? "status_changed"
        : (INTERVIEW_EVENT[i.stage] ?? "status_changed");
      if (!INTERVIEW_EVENT[i.stage])
        warn(warnings, "unreconciled_child_activity", app.id, {
          childStore: "interviews",
          childId: i.id,
        });
      const occurredAt = i.updatedAt || i.createdAt;
      if (!occurredAt) {
        warn(warnings, "unknown_occurrence_precision", app.id);
        warn(warnings, "unreconciled_child_activity", app.id, {
          childStore: "interviews",
          childId: i.id,
        });
      }
      add(
        plan,
        existing,
        app,
        type,
        occurredAt,
        i.id,
        i.outcome,
        INTERVIEW_EVENT[i.stage] &&
          !["cancelled", "no_show"].includes(i.outcome)
          ? i.stage
          : app.status,
        {
          stageLabel: i.stage,
          dueAt: i.startsAt,
          occurredAtPrecision: occurredAt ? "instant" : "unknown",
        },
      );
    }
    for (const o of [...(bundle.offers ?? [])]
      .filter((x) => x.applicationId === app.id)
      .sort(sortById)) {
      const type = OFFER_EVENT[o.status];
      if (!type) {
        warn(warnings, "unreconciled_child_activity", app.id, {
          childStore: "offers",
          childId: o.id,
        });
        continue;
      }
      const occurredAt = o.updatedAt || o.createdAt;
      if (!occurredAt) {
        warn(warnings, "unknown_occurrence_precision", app.id);
        warn(warnings, "unreconciled_child_activity", app.id, {
          childStore: "offers",
          childId: o.id,
        });
      }
      add(
        plan,
        existing,
        app,
        type,
        occurredAt,
        o.id,
        o.status,
        o.status === "accepted" ? "accepted" : "offer",
        { occurredAtPrecision: "instant" },
      );
    }
    const effectiveAppEvents = existing
      .concat(plan.additions)
      .filter((e) => e.applicationId === app.id);
    const replayedBeforeSnapshot = replayStatus(effectiveAppEvents);
    if (
      replayedBeforeSnapshot !== app.status &&
      !existing.some(
        (e) =>
          e.applicationId === app.id &&
          e.eventType === "migration_status_snapshot",
      )
    ) {
      warn(warnings, "status_snapshot_inferred", app.id);
      warn(warnings, "unknown_occurrence_precision", app.id);
      plan.additions.push(
        event(
          app,
          "migration_status_snapshot",
          persistedApplicationTimestamp(app),
          "status",
          app.status,
          app.status,
          { occurredAtPrecision: "unknown" },
        ),
      );
    }
    const replayEvents = existing
      .concat(plan.additions)
      .filter((e) => e.applicationId === app.id);
    const replayed = replayStatus(replayEvents);
    if (replayed && replayed !== app.status)
      warn(warnings, "status_history_mismatch", app.id);
    if (detectsRegressiveHistory(replayEvents))
      warn(warnings, "regressive_history", app.id);
    plan.additions.sort(sortById);
    plan.warnings = warnings
      .filter((w) => w.applicationId === app.id)
      .sort((a, b) => a.code.localeCompare(b.code));
    return plan;
  });
  return {
    plans,
    additions: plans.flatMap((p) => p.additions),
    warnings: warnings.sort(
      (a, b) =>
        a.applicationId.localeCompare(b.applicationId) ||
        a.code.localeCompare(b.code),
    ),
    counts: {
      applications: applications.length,
      additions: plans.reduce((n, p) => n + p.additions.length, 0),
      warnings: warnings.length,
    },
  };
}
