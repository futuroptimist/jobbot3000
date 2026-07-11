const ORIGINS = new Set([
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
]);
const STATUS_EVENTS = {
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
const INTERVIEW_EVENTS = {
  recruiter_screen: "recruiter_screen",
  technical_screen: "technical_interview",
  onsite_loop: "onsite_final_loop",
};
const OFFER_EVENTS = {
  received: "offer_received",
  negotiating: "offer_negotiating",
  accepted: "offer_accepted",
  declined: "offer_declined",
  expired: "offer_expired_rescinded",
};
const terminal = new Set([
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);
const safeWarn = (warnings, code, applicationId, childId) =>
  warnings.push({ code, applicationId, childId });
const sid = (...parts) =>
  parts
    .map((p) => String(p ?? "none").replace(/[^a-zA-Z0-9_-]+/g, "_"))
    .join("__");
const event = (app, type, at, createdAt, extra = {}) => ({
  id: sid("reconcile", app.id, type, extra.childId, extra.state),
  applicationId: app.id,
  status: extra.status ?? app.status,
  eventType: type,
  occurredAt: at,
  occurredAtPrecision: extra.precision ?? "instant",
  inferred: true,
  source: "reconciliation",
  createdAt,
  ...(extra.previousStatus ? { previousStatus: extra.previousStatus } : {}),
  ...(extra.actionStatus ? { actionStatus: extra.actionStatus } : {}),
  ...(extra.dueAt ? { dueAt: extra.dueAt } : {}),
});
const effectiveEvents = (events) => {
  const superseded = new Set(
    events.map((e) => e.supersedesEventId).filter(Boolean),
  );
  return events.filter((e) => !superseded.has(e.id));
};
const eventKey = (e) =>
  `${e.applicationId}|${e.eventType}|${e.id}|${e.actionStatus ?? e.status}`;
export function planLifecycleReconciliation(
  bundle,
  { createdAt = "1970-01-01T00:00:00.000Z" } = {},
) {
  const warnings = [];
  const additions = [];
  const apps = [...(bundle.applications ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const existing = effectiveEvents(bundle.lifecycleEvents ?? []);
  const existingIds = new Set((bundle.lifecycleEvents ?? []).map((e) => e.id));
  const existingTypes = new Map();
  for (const e of existing)
    existingTypes.set(`${e.applicationId}|${e.eventType}`, e);
  const addOnce = (ev, app) => {
    if (existingIds.has(ev.id) || additions.some((a) => a.id === ev.id)) return;
    const key = eventKey(ev);
    if (
      existing.some((e) => eventKey(e) === key) ||
      additions.some((e) => eventKey(e) === key)
    )
      return;
    additions.push(ev);
    if (ev.occurredAtPrecision === "unknown")
      safeWarn(warnings, "unknown_occurrence_precision", app.id);
  };
  for (const app of apps) {
    const appEvents = existing.filter((e) => e.applicationId === app.id);
    if (!appEvents.some((e) => ORIGINS.has(e.eventType))) {
      const at = app.appliedAt ?? createdAt;
      addOnce(
        event(app, app.origin ?? "other_unknown", at, createdAt, {
          precision: app.appliedAt ? "instant" : "unknown",
        }),
        app,
      );
      if (!app.appliedAt)
        safeWarn(warnings, "missing_origin_timestamp", app.id);
    }
    for (const msg of [...(bundle.outreachMessages ?? [])]
      .filter((m) => m.applicationId === app.id)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const type =
        msg.direction === "inbound"
          ? "employer_response_received"
          : msg.direction === "outbound"
            ? "candidate_outreach"
            : null;
      const at = msg.receivedAt ?? msg.sentAt;
      if (!type || !at) {
        safeWarn(warnings, "unreconciled_child_activity", app.id, msg.id);
        continue;
      }
      addOnce(
        event(app, type, at, createdAt, {
          childId: msg.id,
          state: msg.direction,
        }),
        app,
      );
    }
    for (const i of [...(bundle.interviews ?? [])]
      .filter((x) => x.applicationId === app.id)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const type =
        i.outcome === "cancelled" || i.outcome === "no_show"
          ? "status_changed"
          : (INTERVIEW_EVENTS[i.stage] ?? "status_changed");
      addOnce(
        event(app, type, i.startsAt, createdAt, {
          childId: i.id,
          state: `${i.stage}_${i.outcome}`,
          status: INTERVIEW_EVENTS[i.stage]
            ? {
                recruiter_screen: "recruiter_screen",
                technical_screen: "technical_screen",
                onsite_loop: "onsite_loop",
              }[i.stage]
            : app.status,
        }),
        app,
      );
      if (type === "status_changed")
        safeWarn(warnings, "unreconciled_child_activity", app.id, i.id);
    }
    for (const o of [...(bundle.offers ?? [])]
      .filter((x) => x.applicationId === app.id)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const type = OFFER_EVENTS[o.status];
      if (!type) {
        safeWarn(warnings, "unreconciled_child_activity", app.id, o.id);
        continue;
      }
      addOnce(
        event(app, type, o.updatedAt ?? o.createdAt, createdAt, {
          childId: o.id,
          state: o.status,
          status: o.status === "accepted" ? "accepted" : "offer",
        }),
        app,
      );
    }
    const statusType = STATUS_EVENTS[app.status] ?? "status_changed";
    if (
      !existingTypes.has(`${app.id}|${statusType}`) &&
      !additions.some(
        (e) =>
          e.applicationId === app.id &&
          e.eventType === "migration_status_snapshot",
      )
    ) {
      addOnce(
        event(app, "migration_status_snapshot", createdAt, createdAt, {
          precision: "unknown",
          state: app.status,
        }),
        app,
      );
      safeWarn(warnings, "status_snapshot_inferred", app.id);
      safeWarn(warnings, "status_history_mismatch", app.id);
    }
    const sorted = appEvents.sort(
      (a, b) =>
        String(a.occurredAt).localeCompare(String(b.occurredAt)) ||
        a.id.localeCompare(b.id),
    );
    let sawTerminal = false;
    for (const e of sorted) {
      if (terminal.has(e.status)) sawTerminal = true;
      else if (sawTerminal && e.eventType !== "application_reopened")
        safeWarn(warnings, "regressive_history", app.id);
    }
  }
  additions.sort(
    (a, b) =>
      a.applicationId.localeCompare(b.applicationId) ||
      a.eventType.localeCompare(b.eventType) ||
      a.id.localeCompare(b.id),
  );
  return {
    additions,
    warnings,
    counts: { additions: additions.length, warnings: warnings.length },
  };
}
export default planLifecycleReconciliation;
