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
  origin: "application_submitted",
  status: "applied",
  ...extra,
});
const ev = (id, applicationId, eventType, occurredAt, extra = {}) => ({
  id,
  applicationId,
  eventType,
  status: extra.status ?? "applied",
  occurredAt,
  occurredAtPrecision:
    extra.occurredAtPrecision ?? (occurredAt ? "instant" : "unknown"),
  inferred: false,
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});
const ids = (items) => items.map((item) => item.id);

const expectInvariants = (projection) => {
  expect(projection.paths).toHaveLength(projection.includedApplications);
  expect(
    Object.values(projection.totals.origins).reduce((a, b) => a + b, 0),
  ).toBe(projection.includedApplications);
  expect(
    Object.values(projection.totals.endpoints).reduce((a, b) => a + b, 0),
  ).toBe(projection.includedApplications);
  expect(projection.totals.active + projection.totals.terminal).toBe(
    projection.includedApplications,
  );
  const rank = (node) =>
    ({ origin: 0, milestone: 1, endpoint: 2 })[node.split(":")[0]];
  for (const link of projection.links) {
    expect(link.value).toBeGreaterThan(0);
    expect(Number.isInteger(link.value)).toBe(true);
    expect(link.source).not.toBe(link.target);
    expect(rank(link.source)).toBeLessThanOrEqual(rank(link.target));
    expect(new Set(link.applicationIds).size).toBe(link.applicationIds.length);
  }
  for (const path of projection.paths) {
    expect(new Set(path.milestones).size).toBe(path.milestones.length);
    expect(path.nodeIds.at(0)).toBe(`origin:${path.origin}`);
    expect(path.nodeIds.at(-1)).toBe(`endpoint:${path.endpoint}`);
  }
};

describe("lifecycle projection taxonomy", () => {
  it("exports the exact frozen diagram taxonomy", () => {
    expect(Object.isFrozen(LIFECYCLE_DIAGRAM_TAXONOMY)).toBe(true);
    expect(ids(LIFECYCLE_DIAGRAM_TAXONOMY.origins)).toEqual([
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
    ]);
    expect(ids(LIFECYCLE_DIAGRAM_TAXONOMY.milestones)).toEqual([
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
    ]);
    expect(ids(LIFECYCLE_DIAGRAM_TAXONOMY.endpoints)).toEqual([
      "awaiting_response",
      "interviewing",
      "assessment_in_progress",
      "offer_negotiating",
      "employer_rejected",
      "candidate_withdrew",
      "offer_declined",
      "offer_expired_rescinded",
      "offer_accepted",
      "closed_archived",
      "unknown",
    ]);
  });

  it("handles empty bundles", () => {
    const projection = projectLifecycleAt();
    expect(projection).toMatchObject({
      includedApplications: 0,
      totalApplications: 0,
      paths: [],
      nodes: [],
      links: [],
    });
    expect(buildLifecycleTimeline().buckets.map((b) => b.id)).toEqual([
      "unknown-date",
      "current",
    ]);
  });
});

describe("lifecycle path projection", () => {
  it("projects every origin and endpoint without inventing skipped milestones", () => {
    const endpoints = [
      ["awaiting_response", "application_submitted", "applied"],
      ["interviewing", "technical_interview", "technical_screen"],
      [
        "assessment_in_progress",
        "assessment_take_home",
        "applied",
        { actionStatus: "started" },
      ],
      ["offer_negotiating", "offer_received", "offer"],
      ["employer_rejected", "employer_rejected", "rejected"],
      ["candidate_withdrew", "candidate_withdrew", "withdrawn"],
      ["offer_declined", "offer_declined", "offer"],
      ["offer_expired_rescinded", "offer_expired_rescinded", "offer"],
      ["offer_accepted", "offer_accepted", "accepted"],
      ["closed_archived", "closed_archived", "closed_archived"],
      ["unknown", "status_changed", "applied"],
    ];
    const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((o) => o.id);
    const bundle = {
      applications: endpoints.map(([endpoint], index) =>
        app(`app_${endpoint}`, {
          origin: origins[index % origins.length],
          status: endpoint === "unknown" ? "applied" : endpoints[index][2],
        }),
      ),
      lifecycleEvents: endpoints.map(([endpoint, type, status, extra], index) =>
        ev(
          `event_${endpoint}`,
          `app_${endpoint}`,
          type,
          `2026-02-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
          { status, ...(extra ?? {}) },
        ),
      ),
    };
    const projection = projectLifecycleAt(bundle);
    expect(Object.keys(projection.totals.origins).sort()).toEqual(
      origins.sort(),
    );
    expect(Object.keys(projection.totals.endpoints).sort()).toEqual(
      endpoints.map(([endpoint]) => endpoint).sort(),
    );
    expect(
      projection.paths.find((p) => p.endpoint === "offer_negotiating")
        .milestones,
    ).toEqual(["offer_received"]);
    expectInvariants(projection);
  });

  it("collapses repeats, aggregates by app, and keeps all-milestone order", () => {
    const bundle = {
      applications: [app("a", { status: "offer" })],
      lifecycleEvents: [
        ev("e1", "a", "onsite_final_loop", "2026-01-04T00:00:00Z", {
          status: "onsite_loop",
        }),
        ev("e2", "a", "recruiter_screen", "2026-01-02T00:00:00Z", {
          status: "recruiter_screen",
        }),
        ev("e3", "a", "assessment_take_home", "2026-01-03T00:00:00Z", {
          actionStatus: "submitted",
        }),
        ev("e4", "a", "technical_interview", "2026-01-03T01:00:00Z", {
          status: "technical_screen",
        }),
        ev("e5", "a", "recruiter_screen", "2026-01-02T01:00:00Z", {
          status: "recruiter_screen",
        }),
        ev("e6", "a", "offer_received", "2026-01-05T00:00:00Z", {
          status: "offer",
        }),
      ],
    };
    const projection = projectLifecycleAt(bundle);
    expect(projection.paths[0].milestones).toEqual([
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
    ]);
    expect(projection.links.every((link) => link.value === 1)).toBe(true);
    expectInvariants(projection);
  });

  it("keeps assessment submissions out of assessment-in-progress", () => {
    const projection = projectLifecycleAt({
      applications: [app("a")],
      lifecycleEvents: [
        ev("e", "a", "assessment_take_home", "2026-01-01T00:00:00Z", {
          actionStatus: "completed",
        }),
      ],
    });
    expect(projection.paths[0]).toMatchObject({
      milestones: ["assessment_take_home"],
      endpoint: "unknown",
    });
  });

  it("warns for terminal activity without reopen and clears terminal after explicit reopen", () => {
    const noReopen = projectLifecycleAt({
      applications: [app("a", { status: "rejected" })],
      lifecycleEvents: [
        ev("t", "a", "employer_rejected", "2026-01-01T00:00:00Z", {
          status: "rejected",
        }),
        ev("i", "a", "technical_interview", "2026-01-02T00:00:00Z", {
          status: "technical_screen",
        }),
      ],
    });
    expect(noReopen.paths[0].endpoint).toBe("employer_rejected");
    expect(noReopen.warningCounts.terminal_without_reopen).toBe(1);

    const reopened = projectLifecycleAt({
      applications: [app("a", { status: "technical_screen" })],
      lifecycleEvents: [
        ev("t", "a", "employer_rejected", "2026-01-01T00:00:00Z", {
          status: "rejected",
        }),
        ev("r", "a", "application_reopened", "2026-01-02T00:00:00Z"),
        ev("i", "a", "technical_interview", "2026-01-03T00:00:00Z", {
          status: "technical_screen",
        }),
      ],
    });
    expect(reopened.paths[0].endpoint).toBe("interviewing");
  });

  it("reports regressions and does not create backward links", () => {
    const projection = projectLifecycleAt({
      applications: [app("a", { status: "technical_screen" })],
      lifecycleEvents: [
        ev("tech", "a", "technical_interview", "2026-01-01T00:00:00Z", {
          status: "technical_screen",
        }),
        ev("rec", "a", "recruiter_screen", "2026-01-02T00:00:00Z", {
          status: "recruiter_screen",
        }),
      ],
    });
    expect(projection.warningCounts.regressive_history).toBe(1);
    expect(
      projection.links.some(
        (link) =>
          link.source === "milestone:technical_interview" &&
          link.target === "milestone:recruiter_screen",
      ),
    ).toBe(false);
    expectInvariants(projection);
  });
});

describe("lifecycle timeline", () => {
  it("groups equal instants, simultaneous events, cutoffs, and date-only order", () => {
    const bundle = {
      applications: [app("a"), app("b"), app("c")],
      lifecycleEvents: [
        ev("date", "a", "application_submitted", "2026-03-01", {
          occurredAtPrecision: "date",
        }),
        ev("same1", "a", "recruiter_screen", "2026-03-01T12:00:00+00:00", {
          status: "recruiter_screen",
        }),
        ev("same2", "b", "application_submitted", "2026-03-01T07:00:00-05:00"),
        ev("future", "c", "application_submitted", "2026-03-02T00:00:00Z"),
      ],
    };
    const timeline = buildLifecycleTimeline(bundle);
    expect(timeline.buckets.map((b) => b.id)).toEqual([
      "unknown-date",
      "date:2026-03-01",
      "instant:2026-03-01T12:00:00.000Z",
      "instant:2026-03-02T00:00:00.000Z",
      "current",
    ]);
    expect(timeline.buckets[2].eventIds).toEqual(["same1", "same2"]);
    expect(
      projectLifecycleAt(bundle, "instant:2026-03-01T12:00:00.000Z")
        .includedApplications,
    ).toBe(2);
  });

  it("isolates unknown-date history and includes it in current", () => {
    const bundle = {
      applications: [app("a"), app("b")],
      lifecycleEvents: [
        ev("u", "a", "application_submitted", "1970-01-01", {
          occurredAtPrecision: "unknown",
        }),
        ev("d", "b", "application_submitted", "2026-01-01", {
          occurredAtPrecision: "date",
        }),
      ],
    };
    expect(
      projectLifecycleAt(bundle, "unknown-date").paths.map(
        (p) => p.applicationId,
      ),
    ).toEqual(["a"]);
    expect(
      projectLifecycleAt(bundle, "date:2026-01-01").paths.map(
        (p) => p.applicationId,
      ),
    ).toEqual(["b"]);
    expect(projectLifecycleAt(bundle).includedApplications).toBe(2);
  });
});

describe("lifecycle projection safety and determinism", () => {
  it("warns for inferred, mismatch, invalid and orphan records without mutating inputs", () => {
    const bundle = {
      applications: [app("a", { status: "accepted" })],
      lifecycleEvents: [
        ev("bad", "a", "application_submitted", "not-a-date"),
        ev("inf", "a", "application_submitted", "2026-01-01T00:00:00Z", {
          inferred: true,
        }),
        ev("orphan", "missing", "offer_accepted", "2026-01-01T00:00:00Z"),
      ],
    };
    const before = structuredClone(bundle);
    const projection = projectLifecycleAt(bundle);
    expect(bundle).toEqual(before);
    expect(projection.warningCounts).toMatchObject({
      invalid_timestamp: 1,
      orphaned_event: 1,
      inferred_event: 1,
      status_history_mismatch: 1,
    });
  });

  it("is independent of application and event input order", () => {
    const applications = [
      app("b", { status: "offer" }),
      app("a", { status: "technical_screen" }),
    ];
    const lifecycleEvents = [
      ev("b2", "b", "offer_received", "2026-01-03T00:00:00Z", {
        status: "offer",
      }),
      ev("a1", "a", "technical_interview", "2026-01-02T00:00:00Z", {
        status: "technical_screen",
      }),
      ev("b1", "b", "application_submitted", "2026-01-01T00:00:00Z"),
    ];
    expect(projectLifecycleAt({ applications, lifecycleEvents })).toEqual(
      projectLifecycleAt({
        applications: [...applications].reverse(),
        lifecycleEvents: [...lifecycleEvents].reverse(),
      }),
    );
  });

  it("handles a large aggregate fixture and every invariant", () => {
    const applications = Array.from({ length: 120 }, (_, index) =>
      app(`app_${String(index).padStart(3, "0")}`, {
        status:
          index % 5 === 0
            ? "accepted"
            : index % 3 === 0
              ? "technical_screen"
              : "applied",
      }),
    );
    const lifecycleEvents = applications.flatMap((application, index) => [
      ev(
        `submit_${application.id}`,
        application.id,
        "application_submitted",
        `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      ),
      ...(index % 3 === 0
        ? [
            ev(
              `tech_${application.id}`,
              application.id,
              "technical_interview",
              "2026-02-01T00:00:00Z",
              { status: "technical_screen" },
            ),
          ]
        : []),
      ...(index % 5 === 0
        ? [
            ev(
              `offer_${application.id}`,
              application.id,
              "offer_accepted",
              "2026-03-01T00:00:00Z",
              { status: "accepted" },
            ),
          ]
        : []),
    ]);
    const projection = projectLifecycleAt({ applications, lifecycleEvents });
    expect(projection.includedApplications).toBe(120);
    expectInvariants(projection);
  });
});
