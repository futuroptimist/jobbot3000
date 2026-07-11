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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});
const event = (id, applicationId, eventType, occurredAt, extra = {}) => ({
  id,
  applicationId,
  eventType,
  status: extra.status ?? "applied",
  occurredAt,
  occurredAtPrecision: occurredAt?.includes?.("T") ? "instant" : "date",
  source: "manual",
  inferred: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("lifecycle projection", () => {
  it("exports the frozen diagram taxonomy with namespaced node IDs", () => {
    expect(Object.isFrozen(LIFECYCLE_DIAGRAM_TAXONOMY)).toBe(true);
    expect(LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((item) => item.id)).toEqual([
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
    ]);
    expect(
      LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((item) => item.nodeId),
    ).toEqual([
      "milestone:recruiter_screen",
      "milestone:assessment_take_home",
      "milestone:technical_interview",
      "milestone:onsite_final_loop",
      "milestone:offer_received",
    ]);
    expect(LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((item) => item.id)).toEqual(
      [
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
      ],
    );
  });

  it("handles empty bundles and a single skipped-stage application", () => {
    expect(projectLifecycleAt()).toMatchObject({
      includedApplications: 0,
      totalApplications: 0,
      paths: [],
      links: [],
    });
    const result = projectLifecycleAt({ applications: [app("a1")] });
    expect(result.paths).toEqual([
      {
        applicationId: "a1",
        origin: "application_submitted",
        milestones: [],
        endpoint: "awaiting_response",
        nodes: ["origin:application_submitted", "endpoint:awaiting_response"],
      },
    ]);
    expect(result.links).toEqual([
      {
        id: "origin:application_submitted=>endpoint:awaiting_response",
        source: "origin:application_submitted",
        target: "endpoint:awaiting_response",
        value: 1,
        applicationIds: ["a1"],
      },
    ]);
  });

  it("collapses repeated milestones and preserves forward order", () => {
    const bundle = {
      applications: [app("a1")],
      lifecycleEvents: [
        event("e1", "a1", "application_submitted", "2026-01-01"),
        event("e2", "a1", "recruiter_screen", "2026-01-02", {
          status: "recruiter_screen",
        }),
        event("e3", "a1", "recruiter_screen", "2026-01-03", {
          status: "recruiter_screen",
        }),
        event("e4", "a1", "technical_interview", "2026-01-04", {
          status: "technical_screen",
        }),
      ],
    };
    const result = projectLifecycleAt(bundle);
    expect(result.paths[0].milestones).toEqual([
      "recruiter_screen",
      "technical_interview",
    ]);
    expect(result.links).toContainEqual({
      id: "origin:application_submitted=>milestone:recruiter_screen",
      source: "origin:application_submitted",
      target: "milestone:recruiter_screen",
      value: 1,
      applicationIds: ["a1"],
    });
  });

  it("maps every origin and terminal endpoint", () => {
    const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((item) => item.id);
    const terminals = [
      "employer_rejected",
      "candidate_withdrew",
      "offer_declined",
      "offer_expired_rescinded",
      "offer_accepted",
      "closed_archived",
    ];
    const applications = terminals.map((endpoint, index) =>
      app(`a${index}`, { origin: origins[index % origins.length] }),
    );
    const lifecycleEvents = applications.flatMap((application, index) => [
      event(`origin${index}`, application.id, application.origin, "2026-01-01"),
      event(`end${index}`, application.id, terminals[index], "2026-01-02", {
        status:
          terminals[index] === "offer_accepted"
            ? "accepted"
            : terminals[index] === "candidate_withdrew"
              ? "withdrawn"
              : terminals[index] === "closed_archived"
                ? "closed_archived"
                : "rejected",
      }),
    ]);
    const result = projectLifecycleAt({ applications, lifecycleEvents });
    expect(result.totals.terminal).toBe(applications.length);
    expect(result.paths.map((path) => path.endpoint)).toEqual(terminals);
  });

  it("builds deterministic time buckets for all precision types", () => {
    const bundle = {
      applications: [app("a1"), app("a2")],
      lifecycleEvents: [
        event("unknown", "a1", "application_submitted", "2026-01-01", {
          occurredAtPrecision: "unknown",
        }),
        event(
          "instant-b",
          "a1",
          "recruiter_screen",
          "2026-01-02T01:00:00+01:00",
          {
            status: "recruiter_screen",
          },
        ),
        event("date", "a2", "application_submitted", "2026-01-02"),
        event(
          "instant-a",
          "a2",
          "technical_interview",
          "2026-01-01T16:00:00-08:00",
          {
            status: "technical_screen",
          },
        ),
      ],
    };
    const timeline = buildLifecycleTimeline(bundle);
    expect(timeline.buckets.map((bucket) => bucket.id)).toEqual([
      "unknown-date",
      "date:2026-01-02",
      "instant:2026-01-02T00:00:00.000Z",
      "current",
    ]);
    expect(timeline.buckets[2].eventIds).toEqual(["instant-a", "instant-b"]);
    expect(
      projectLifecycleAt(bundle, "date:2026-01-02").paths.map(
        (path) => path.applicationId,
      ),
    ).toEqual(["a2"]);
    expect(
      projectLifecycleAt(bundle, "unknown-date").paths.map(
        (path) => path.applicationId,
      ),
    ).toEqual(["a1"]);
    expect(projectLifecycleAt(bundle, "current").includedApplications).toBe(2);
  });

  it("does not mutate inputs and is stable for shuffled arrays", () => {
    const applications = [app("b"), app("a")];
    const lifecycleEvents = [
      event("e2", "a", "recruiter_screen", "2026-01-02", {
        status: "recruiter_screen",
      }),
      event("e1", "a", "application_submitted", "2026-01-01"),
      event("e3", "b", "candidate_outreach", "2026-01-01", {
        status: "outreach_sent",
      }),
    ];
    const bundle = { applications, lifecycleEvents };
    const before = structuredClone(bundle);
    const first = projectLifecycleAt(bundle);
    const second = projectLifecycleAt({
      applications: [...applications].reverse(),
      lifecycleEvents: [...lifecycleEvents].reverse(),
    });
    expect(bundle).toEqual(before);
    expect(second).toEqual(first);
  });

  it("reports orphan, inferred, mismatch, terminal-without-reopen, and regression warnings", () => {
    const result = projectLifecycleAt({
      applications: [app("a1", { status: "rejected" })],
      lifecycleEvents: [
        event("e1", "a1", "application_submitted", "2026-01-01", {
          inferred: true,
        }),
        event("e2", "a1", "technical_interview", "2026-01-02", {
          status: "technical_screen",
        }),
        event("e3", "a1", "recruiter_screen", "2026-01-03", {
          status: "recruiter_screen",
        }),
        event("e4", "a1", "employer_rejected", "2026-01-04", {
          status: "rejected",
        }),
        event("e5", "a1", "offer_received", "2026-01-05", {
          status: "rejected",
        }),
        event("e6", "a1", "status_changed", "2026-01-06", {
          status: "applied",
        }),
        event("orphan", "missing", "application_submitted", "2026-01-01"),
      ],
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "orphaned_event",
        "inferred_event",
        "status_mismatch",
        "regressive_history",
        "terminal_without_reopen",
      ]),
    );
    expect(result.paths[0].milestones).toEqual([
      "technical_interview",
      "offer_received",
    ]);
  });
});
