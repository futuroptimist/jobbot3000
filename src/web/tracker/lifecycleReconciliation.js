const ORIGINS = [
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
];

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

const STATUS_EVENT = {
  applied: "application_submitted",
  outreach_sent: "candidate_outreach",
  recruiter_screen: "recruiter_screen",
  technical_screen: "technical_interview",
  onsite_loop: "onsite_final_loop",
  offer: "offer_received",
  accepted: "offer_accepted",
  rejected: "employer_rejected",
  withdrawn: "candidate_withdrew",
  closed_archived: "closed_archived",
};

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

const OFFER_APP_STATUS = { accepted: "accepted" };

const safeWarning = (code, applicationId, extra = {}) => ({
  code,
  applicationId,
  ...extra,
});

const effectiveEvents = (events) => {
  const superseded = new Set(
    events.map((event) => event.supersedesEventId).filter(Boolean),
  );
  return events.filter((event) => !superseded.has(event.id));
};

const eventKey = (event) =>
  [
    event.applicationId,
    event.eventType,
    event.sourceArtifact ?? "",
    event.actionStatus ?? "",
    event.status ?? "",
  ].join("|");

const deterministicId = (...parts) =>
  `event_reconcile_${parts
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`.slice(0, 180);

const precisionFor = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? "date" : "instant";

const makeEvent = ({
  application,
  eventType,
  at,
  childId,
  status,
  actionStatus,
}) => ({
  id: deterministicId(application.id, eventType, childId ?? status ?? "state"),
  applicationId: application.id,
  eventType,
  status: status ?? application.status,
  occurredAt: at,
  occurredAtPrecision: precisionFor(at),
  inferred: true,
  source: "reconciliation",
  previousStatus: application.status,
  sourceArtifact: childId,
  actionStatus,
  createdAt: at,
});

const replayEndpoint = (events) => {
  const sorted = [...events].sort((a, b) =>
    `${a.occurredAt}|${a.id}`.localeCompare(`${b.occurredAt}|${b.id}`),
  );
  let terminal;
  for (const event of sorted) {
    if (event.eventType === "application_reopened") terminal = undefined;
    if (
      [
        "employer_rejected",
        "candidate_withdrew",
        "offer_declined",
        "offer_expired_rescinded",
        "offer_accepted",
        "closed_archived",
      ].includes(event.eventType)
    )
      terminal = event.eventType;
  }
  if (terminal) return terminal;
  if (
    sorted.some((event) =>
      ["offer_received", "offer_negotiating"].includes(event.eventType),
    )
  )
    return "offer_negotiating";
  if (
    sorted.some(
      (event) =>
        event.eventType === "assessment_take_home" &&
        ["requested", "pending", "started", "in_progress"].includes(
          event.actionStatus,
        ),
    )
  )
    return "assessment_in_progress";
  if (
    sorted.some((event) =>
      ["recruiter_screen", "technical_interview", "onsite_final_loop"].includes(
        event.eventType,
      ),
    )
  )
    return "interviewing";
  if (sorted.length) return "awaiting_response";
  return "unknown";
};

export function planLifecycleReconciliation(bundle) {
  const applications = [...(bundle.applications ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const events = bundle.lifecycleEvents ?? [];
  const warnings = [];
  const plans = [];
  for (const application of applications) {
    const appEvents = events.filter(
      (event) => event.applicationId === application.id,
    );
    const effective = effectiveEvents(appEvents);
    const existingKeys = new Set(effective.map(eventKey));
    const additions = [];
    const add = (event) => {
      const key = eventKey(event);
      if (
        existingKeys.has(key) ||
        additions.some((item) => eventKey(item) === key)
      )
        return;
      additions.push(event);
    };

    if (!effective.some((event) => ORIGINS.includes(event.eventType))) {
      const at = application.appliedAt ?? application.createdAt;
      if (!at)
        warnings.push(safeWarning("missing_origin_timestamp", application.id));
      add(
        makeEvent({
          application,
          eventType: application.origin ?? "other_unknown",
          at: at ?? "1970-01-01",
          status: application.status,
          childId: "origin",
        }),
      );
      if (!at) additions.at(-1).occurredAtPrecision = "unknown";
    }

    for (const message of [...(bundle.outreachMessages ?? [])]
      .filter((row) => row.applicationId === application.id)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const at =
        message.direction === "inbound" ? message.receivedAt : message.sentAt;
      if (!at) {
        warnings.push(
          safeWarning("unknown_occurrence_precision", application.id, {
            childStore: "outreachMessages",
          }),
        );
        continue;
      }
      add(
        makeEvent({
          application,
          eventType:
            message.direction === "inbound"
              ? "employer_response_received"
              : "candidate_outreach",
          at,
          childId: message.id,
        }),
      );
    }

    for (const interview of [...(bundle.interviews ?? [])]
      .filter((row) => row.applicationId === application.id)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const eventType = ["cancelled", "no_show"].includes(interview.outcome)
        ? "status_changed"
        : (INTERVIEW_EVENT[interview.stage] ?? "status_changed");
      if (eventType === "status_changed")
        warnings.push(
          safeWarning("unreconciled_child_activity", application.id, {
            childStore: "interviews",
          }),
        );
      if (interview.startsAt)
        add(
          makeEvent({
            application,
            eventType,
            at: interview.startsAt,
            childId: interview.id,
          }),
        );
    }

    for (const offer of [...(bundle.offers ?? [])]
      .filter((row) => row.applicationId === application.id)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const eventType = OFFER_EVENT[offer.status];
      if (!eventType) {
        warnings.push(
          safeWarning("unreconciled_child_activity", application.id, {
            childStore: "offers",
          }),
        );
        continue;
      }
      add(
        makeEvent({
          application,
          eventType,
          at: offer.updatedAt ?? offer.createdAt,
          childId: offer.id,
          status: OFFER_APP_STATUS[offer.status] ?? "offer",
        }),
      );
    }

    const projected = replayEndpoint([...effective, ...additions]);
    if (
      STATUS_ENDPOINT[application.status] &&
      projected !== STATUS_ENDPOINT[application.status]
    ) {
      warnings.push(safeWarning("status_history_mismatch", application.id));
      const snapshotExists = effective.some(
        (event) => event.eventType === "migration_status_snapshot",
      );
      if (!snapshotExists) {
        warnings.push(safeWarning("status_snapshot_inferred", application.id));
        const snapshot = makeEvent({
          application,
          eventType: "migration_status_snapshot",
          at: application.updatedAt ?? application.createdAt ?? "1970-01-01",
          childId: `status_${application.status}`,
          status: application.status,
        });
        snapshot.occurredAtPrecision = "unknown";
        snapshot.rawEventType =
          STATUS_EVENT[application.status] ?? "status_changed";
        add(snapshot);
      }
    }

    if (
      effective.some(
        (event) =>
          event.previousStatus && event.previousStatus !== application.status,
      )
    )
      warnings.push(safeWarning("regressive_history", application.id));
    additions.sort((a, b) => a.id.localeCompare(b.id));
    if (additions.length)
      plans.push({ applicationId: application.id, additions });
  }
  plans.sort((a, b) => a.applicationId.localeCompare(b.applicationId));
  return {
    plans,
    additions: plans.flatMap((plan) => plan.additions),
    warnings: warnings.sort((a, b) =>
      `${a.applicationId}|${a.code}`.localeCompare(
        `${b.applicationId}|${b.code}`,
      ),
    ),
    counts: {
      applications: applications.length,
      plannedApplications: plans.length,
      plannedEvents: plans.reduce(
        (sum, plan) => sum + plan.additions.length,
        0,
      ),
      warnings: warnings.length,
    },
  };
}
