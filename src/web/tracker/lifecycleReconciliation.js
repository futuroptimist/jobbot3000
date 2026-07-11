const ORIGIN_TYPES = new Set([
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
]);
const TERMINAL_TYPES = new Set([
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
const OFFER_EVENT = {
  received: "offer_received",
  negotiating: "offer_negotiating",
  accepted: "offer_accepted",
  declined: "offer_declined",
  expired: "offer_expired_rescinded",
  rescinded: "offer_expired_rescinded",
};
const INTERVIEW_EVENT = {
  recruiter_screen: "recruiter_screen",
  technical_screen: "technical_interview",
  onsite_loop: "onsite_final_loop",
};
const orderById = (a, b) => String(a.id).localeCompare(String(b.id));
const effectiveEvents = (events) => {
  const superseded = new Set(
    events.map((e) => e.supersedesEventId).filter(Boolean),
  );
  return events
    .filter((e) => !superseded.has(e.id))
    .sort(
      (a, b) =>
        String(a.occurredAt).localeCompare(String(b.occurredAt)) ||
        orderById(a, b),
    );
};
const stableId = (...parts) =>
  `event_${parts
    .map(
      (part) =>
        String(part ?? "none")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "none",
    )
    .join("_")}`.slice(0, 180);
const warn = (warnings, code, applicationId, extra = {}) => {
  warnings.push({ code, applicationId, ...extra });
};
const eventFor = ({
  application,
  type,
  child,
  state,
  at,
  status,
  operationTime,
}) => ({
  id: stableId("reconcile", application.id, type, child?.id, state),
  applicationId: application.id,
  eventType: type,
  status: status ?? application.status,
  previousStatus: application.status,
  occurredAt: at ?? "1970-01-01",
  occurredAtPrecision: at
    ? String(at).length === 10
      ? "date"
      : "instant"
    : "unknown",
  inferred: true,
  source: "reconciliation",
  createdAt: operationTime,
  ...(child?.id ? { sourceArtifact: child.id } : {}),
  ...(state ? { actionStatus: state } : {}),
  ...(child?.dueAt ? { dueAt: child.dueAt } : {}),
});
const endpointForReplay = (events) => {
  let terminal = null;
  let active = "unknown";
  for (const e of effectiveEvents(events)) {
    if (e.eventType === "application_reopened") terminal = null;
    if (TERMINAL_TYPES.has(e.eventType)) terminal = e.eventType;
    else if (!terminal) {
      if (["offer_received", "offer_negotiating"].includes(e.eventType))
        active = "offer_negotiating";
      else if (
        [
          "recruiter_screen",
          "technical_interview",
          "onsite_final_loop",
        ].includes(e.eventType)
      )
        active = "interviewing";
      else if (
        [
          "application_submitted",
          "candidate_outreach",
          "employer_response_received",
          "recruiter_company_outreach",
          "referral",
        ].includes(e.eventType)
      )
        active = "awaiting_response";
    }
  }
  return terminal ?? active;
};
export const planLifecycleReconciliation = (
  bundle = {},
  { operationTime = "1970-01-01T00:00:00.000Z" } = {},
) => {
  const additions = [];
  const warnings = [];
  const apps = [...(bundle.applications ?? [])].sort(orderById);
  const events = bundle.lifecycleEvents ?? [];
  const existingKeys = new Set(
    events.map((e) =>
      [
        e.applicationId,
        e.eventType,
        e.sourceArtifact || "",
        e.actionStatus || "",
      ].join("|"),
    ),
  );
  const add = (event) => {
    const key = [
      event.applicationId,
      event.eventType,
      event.sourceArtifact || "",
      event.actionStatus || "",
    ].join("|");
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    additions.push(event);
  };
  for (const application of apps) {
    const appEvents = events.filter((e) => e.applicationId === application.id);
    const effective = effectiveEvents(appEvents);
    if (!effective.some((e) => ORIGIN_TYPES.has(e.eventType))) {
      const at = application.appliedAt;
      if (!at) warn(warnings, "missing_origin_timestamp", application.id);
      add(
        eventFor({
          application,
          type: application.origin || "other_unknown",
          at,
          operationTime,
        }),
      );
    }
    for (const msg of (bundle.outreachMessages ?? [])
      .filter((x) => x.applicationId === application.id)
      .sort(orderById)) {
      const type =
        msg.direction === "inbound"
          ? "employer_response_received"
          : msg.direction === "outbound"
            ? "candidate_outreach"
            : null;
      const at = msg.direction === "inbound" ? msg.receivedAt : msg.sentAt;
      if (!type) {
        warn(warnings, "unreconciled_child_activity", application.id, {
          childStore: "outreachMessages",
          childId: msg.id,
        });
        continue;
      }
      if (!at)
        warn(warnings, "unknown_occurrence_precision", application.id, {
          childStore: "outreachMessages",
          childId: msg.id,
        });
      add(
        eventFor({
          application,
          type,
          child: msg,
          state: msg.direction,
          at,
          operationTime,
        }),
      );
    }
    for (const interview of (bundle.interviews ?? [])
      .filter((x) => x.applicationId === application.id)
      .sort(orderById)) {
      const type = ["cancelled", "no_show"].includes(interview.outcome)
        ? "status_changed"
        : INTERVIEW_EVENT[interview.stage] || "status_changed";
      if (type === "status_changed")
        warn(warnings, "unreconciled_child_activity", application.id, {
          childStore: "interviews",
          childId: interview.id,
        });
      add(
        eventFor({
          application,
          type,
          child: interview,
          state: interview.outcome,
          at: interview.startsAt,
          operationTime,
        }),
      );
    }
    for (const offer of (bundle.offers ?? [])
      .filter((x) => x.applicationId === application.id)
      .sort(orderById)) {
      const type = OFFER_EVENT[offer.status];
      if (!type) {
        warn(warnings, "unreconciled_child_activity", application.id, {
          childStore: "offers",
          childId: offer.id,
        });
        continue;
      }
      add(
        eventFor({
          application,
          type,
          child: offer,
          state: offer.status,
          at: offer.updatedAt || offer.createdAt,
          status: offer.status === "accepted" ? "accepted" : "offer",
          operationTime,
        }),
      );
    }
    const replay = endpointForReplay([
      ...appEvents,
      ...additions.filter((e) => e.applicationId === application.id),
    ]);
    if (
      STATUS_ENDPOINT[application.status] &&
      replay !== STATUS_ENDPOINT[application.status]
    ) {
      warn(warnings, "status_history_mismatch", application.id);
      warn(warnings, "status_snapshot_inferred", application.id);
      warn(warnings, "unknown_occurrence_precision", application.id);
      add(
        eventFor({
          application,
          type: "migration_status_snapshot",
          state: application.status,
          status: application.status,
          operationTime,
        }),
      );
    }
    if (
      effective.some(
        (e, i) =>
          i &&
          String(e.occurredAt).localeCompare(
            String(effective[i - 1].occurredAt),
          ) < 0,
      )
    )
      warn(warnings, "regressive_history", application.id);
  }
  additions.sort(
    (a, b) =>
      String(a.applicationId).localeCompare(String(b.applicationId)) ||
      String(a.eventType).localeCompare(String(b.eventType)) ||
      orderById(a, b),
  );
  return {
    additions,
    warnings: warnings.sort(
      (a, b) =>
        a.code.localeCompare(b.code) ||
        String(a.applicationId).localeCompare(String(b.applicationId)),
    ),
    counts: {
      applications: apps.length,
      additions: additions.length,
      warnings: warnings.length,
    },
  };
};
