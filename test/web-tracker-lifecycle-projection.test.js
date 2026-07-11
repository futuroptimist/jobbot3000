import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_DIAGRAM_TAXONOMY,
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";

const app = (id, extra = {}) => ({
  id,
  company: `Company ${id}`,
  role: "Engineer",
  status: "applied",
  origin: "application_submitted",
  appliedAt: "2026-01-01",
  ...extra,
});
const ev = (id, applicationId, eventType, occurredAt, extra = {}) => ({
  id,
  applicationId,
  eventType,
  occurredAt,
  occurredAtPrecision: occurredAt.includes("T") ? "instant" : "date",
  inferred: false,
  createdAt: occurredAt,
  ...extra,
});
const bundle = (applications, lifecycleEvents) => ({
  applications,
  lifecycleEvents,
});
const shuffled = (b) => ({
  applications: [...b.applications].reverse(),
  lifecycleEvents: [...b.lifecycleEvents].reverse(),
});

const expectInvariants = (projection) => {
  expect(projection.paths).toHaveLength(projection.includedApplications);
  expect(
    Object.values(projection.totals.origins).reduce(
      (sum, value) => sum + value,
      0,
    ),
  ).toBe(projection.includedApplications);
  expect(
    Object.values(projection.totals.endpoints).reduce(
      (sum, value) => sum + value,
      0,
    ),
  ).toBe(projection.includedApplications);
  expect(projection.totals.active + projection.totals.terminal).toBe(
    projection.includedApplications,
  );
  for (const link of projection.links) {
    expect(link.value).toBeGreaterThan(0);
    expect(link.value).toBe(link.applicationIds.length);
    expect(new Set(link.applicationIds).size).toBe(link.applicationIds.length);
    expect(link.source).not.toBe(link.target);
    expect(link.source.startsWith("endpoint:")).toBe(false);
  }
  for (const path of projection.paths) {
    expect(new Set(path.milestones).size).toBe(path.milestones.length);
    expect(path.nodeIds[0]).toBe(`origin:${path.origin}`);
    expect(path.nodeIds.at(-1)).toBe(`endpoint:${path.endpoint}`);
  }
};

describe("lifecycle projection", () => {
  it("exports the deeply frozen exact taxonomy", () => {
    expect(Object.isFrozen(LIFECYCLE_DIAGRAM_TAXONOMY.origins[0])).toBe(true);
    expect(LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((x) => x.id)).toEqual([
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
    ]);
    expect(LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((x) => x.id)).toContain(
      "offer_expired_rescinded",
    );
  });

  it("handles empty and single bundles without mutation", () => {
    expect(projectLifecycleAt()).toMatchObject({
      includedApplications: 0,
      totalApplications: 0,
      paths: [],
      links: [],
    });
    const input = bundle([app("a1")], []);
    const before = structuredClone(input);
    const projection = projectLifecycleAt(input);
    expect(projection.paths[0].nodeIds).toEqual([
      "origin:application_submitted",
      "endpoint:unknown",
    ]);
    expect(input).toEqual(before);
    expect(() => projection.paths.push({})).toThrow();
    expectInvariants(projection);
  });

  it("projects every origin and endpoint exactly once", () => {
    const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((x) => x.id);
    const terminalEvents = [
      "employer_rejected",
      "candidate_withdrew",
      "offer_declined",
      "offer_expired_rescinded",
      "offer_accepted",
      "closed_archived",
    ];
    const applications = origins.map((origin) =>
      app(`origin_${origin}`, { origin, status: "applied" }),
    );
    const events = applications.flatMap((application, i) => [
      ev(`o_${i}`, application.id, application.origin, "2026-01-01"),
      ev(
        `e_${i}`,
        application.id,
        terminalEvents[i] ?? "offer_negotiating",
        "2026-01-02",
      ),
    ]);
    const projection = projectLifecycleAt(bundle(applications, events));
    expect(Object.keys(projection.totals.origins)).toEqual(origins);
    expect(projection.totals.endpoints).toMatchObject({
      employer_rejected: 1,
      candidate_withdrew: 1,
      offer_declined: 1,
      offer_expired_rescinded: 1,
      offer_accepted: 1,
    });
    expectInvariants(projection);
  });

  it("collapses repeated milestones and aggregates by application", () => {
    const b = bundle(
      [app("a1", { status: "offer" }), app("a2", { status: "offer" })],
      [
        ev("a1_o", "a1", "application_submitted", "2026-01-01"),
        ev("a1_t1", "a1", "technical_interview", "2026-01-02"),
        ev("a1_t2", "a1", "technical_interview", "2026-01-03"),
        ev("a1_offer", "a1", "offer_received", "2026-01-04"),
        ev("a2_o", "a2", "application_submitted", "2026-01-01"),
        ev("a2_t", "a2", "technical_interview", "2026-01-02"),
      ],
    );
    const projection = projectLifecycleAt(b);
    expect(
      projection.paths.find((p) => p.applicationId === "a1").milestones,
    ).toEqual(["technical_interview", "offer_received"]);
    expect(
      projection.links.find(
        (link) =>
          link.source === "origin:application_submitted" &&
          link.target === "milestone:technical_interview",
      ),
    ).toMatchObject({ value: 2, applicationIds: ["a1", "a2"] });
    expectInvariants(projection);
  });

  it("uses assessment action status for in-progress behavior", () => {
    const requested = projectLifecycleAt(
      bundle(
        [app("a", { status: "technical_screen" })],
        [
          ev("o", "a", "application_submitted", "2026-01-01"),
          ev("assess", "a", "assessment_take_home", "2026-01-02", {
            actionStatus: "requested",
          }),
        ],
      ),
    );
    expect(requested.paths[0].endpoint).toBe("assessment_in_progress");
    const submitted = projectLifecycleAt(
      bundle(
        [app("a", { status: "technical_screen" })],
        [
          ev("o", "a", "application_submitted", "2026-01-01"),
          ev("assess", "a", "assessment_take_home", "2026-01-02", {
            actionStatus: "submitted",
          }),
        ],
      ),
    );
    expect(submitted.paths[0].milestones).toEqual(["assessment_take_home"]);
    expect(submitted.paths[0].endpoint).toBe("awaiting_response");
  });

  it("builds deterministic atomic timeline buckets", () => {
    const b = bundle(
      [app("a"), app("b"), app("c")],
      [
        ev("date", "a", "application_submitted", "2026-01-02"),
        ev("same1", "a", "technical_interview", "2026-01-02T10:00:00+02:00"),
        ev("same2", "b", "application_submitted", "2026-01-02T08:00:00.000Z"),
        ev("future", "c", "application_submitted", "2026-01-03T00:00:00.000Z"),
        ev("unknown", "c", "application_submitted", "1970-01-01", {
          occurredAtPrecision: "unknown",
        }),
      ],
    );
    const timeline = buildLifecycleTimeline(b);
    expect(timeline.buckets.map((bucket) => bucket.id)).toEqual([
      "unknown-date",
      "2026-01-02|0",
      "2026-01-02|1|2026-01-02T08:00:00.000Z",
      "2026-01-03|1|2026-01-03T00:00:00.000Z",
      "current",
    ]);
    expect(timeline.buckets[2].eventIds).toEqual(["same1", "same2"]);
    expect(projectLifecycleAt(b, "2026-01-02|0").includedApplications).toBe(1);
    expect(
      projectLifecycleAt(b, timeline.buckets[2].id).includedApplications,
    ).toBe(2);
    expect(
      projectLifecycleAt(b, "unknown-date").paths.map((p) => p.applicationId),
    ).toEqual(["c"]);
  });

  it("keeps future and unknown activity out of dated snapshots", () => {
    const b = bundle(
      [app("a", { status: "offer" })],
      [
        ev("origin", "a", "application_submitted", "2026-01-01"),
        ev("unknown_offer", "a", "offer_received", "1970-01-01", {
          occurredAtPrecision: "unknown",
        }),
        ev("accepted", "a", "offer_accepted", "2026-02-01"),
      ],
    );
    expect(projectLifecycleAt(b, "2026-01-01|0").paths[0].endpoint).toBe(
      "awaiting_response",
    );
    expect(projectLifecycleAt(b).paths[0].endpoint).toBe("offer_accepted");
  });

  it("preserves terminal state until explicit reopen", () => {
    const noReopen = projectLifecycleAt(
      bundle(
        [app("a", { status: "rejected" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("reject", "a", "employer_rejected", "2026-01-02"),
          ev("screen", "a", "recruiter_screen", "2026-01-03"),
        ],
      ),
    );
    expect(noReopen.paths[0].endpoint).toBe("employer_rejected");
    expect(noReopen.warningCounts.terminal_without_reopen).toBe(1);
    const reopened = projectLifecycleAt(
      bundle(
        [app("a", { status: "recruiter_screen" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("reject", "a", "employer_rejected", "2026-01-02"),
          ev("reopen", "a", "application_reopened", "2026-01-03"),
          ev("screen", "a", "recruiter_screen", "2026-01-04"),
        ],
      ),
    );
    expect(reopened.paths[0].endpoint).toBe("interviewing");
  });

  it("reports deterministic structured warnings", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "accepted" })],
        [
          ev("origin", "a", "application_submitted", "not-a-date", {
            occurredAtPrecision: "instant",
            inferred: true,
          }),
          ev("late", "a", "onsite_final_loop", "2026-01-01"),
          ev("early", "a", "recruiter_screen", "2026-01-02"),
          ev("mystery", "a", "totally_new", "2026-01-03"),
          ev("orphan", "missing", "application_submitted", "2026-01-01"),
        ],
      ),
    );
    expect(projection.warningCounts).toMatchObject({
      invalid_timestamp: 1,
      inferred_event: 1,
      status_mismatch: 1,
      unknown_event_type: 1,
      orphan_event: 1,
      regressive_history: 1,
    });
    expect(
      projection.links.some(
        (l) => l.source.includes("onsite") && l.target.includes("recruiter"),
      ),
    ).toBe(false);
  });

  it("is deterministic for shuffled arrays and a large aggregate fixture", () => {
    const applications = Array.from({ length: 120 }, (_, index) =>
      app(`app_${String(index).padStart(3, "0")}`, {
        status: index % 3 === 0 ? "offer" : "technical_screen",
        origin: index % 2 === 0 ? "referral" : "candidate_outreach",
      }),
    );
    const events = applications.flatMap((application, index) => [
      ev(
        `o_${application.id}`,
        application.id,
        application.origin,
        "2026-01-01",
      ),
      ev(
        `t_${application.id}`,
        application.id,
        "technical_interview",
        "2026-01-02",
      ),
      ...(index % 3 === 0
        ? [
            ev(
              `offer_${application.id}`,
              application.id,
              "offer_received",
              "2026-01-03",
            ),
          ]
        : []),
    ]);
    const b = bundle(applications, events);
    expect(projectLifecycleAt(shuffled(b))).toEqual(projectLifecycleAt(b));
    expect(buildLifecycleTimeline(shuffled(b))).toEqual(
      buildLifecycleTimeline(b),
    );
    expectInvariants(projectLifecycleAt(b));
  });
});
