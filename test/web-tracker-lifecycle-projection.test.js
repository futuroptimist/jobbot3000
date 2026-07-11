import { describe, expect, it } from "vitest";
import {
  buildLifecycleTimeline,
  LIFECYCLE_DIAGRAM_TAXONOMY,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";

const app = (id, extra = {}) => ({
  id,
  company: id,
  role: "Role",
  origin: "application_submitted",
  status: "applied",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...extra,
});
const ev = (
  id,
  applicationId,
  eventType,
  occurredAt = "2025-01-01T00:00:00.000Z",
  extra = {},
) => ({
  id,
  applicationId,
  eventType,
  status: "applied",
  occurredAt,
  occurredAtPrecision: occurredAt.includes("T") ? "instant" : "date",
  source: "manual",
  inferred: false,
  createdAt: "2025-01-01T00:00:00.000Z",
  ...extra,
});
describe("lifecycle projection", () => {
  it("exports the exact deeply frozen diagram taxonomy", () => {
    expect(Object.isFrozen(LIFECYCLE_DIAGRAM_TAXONOMY.origins[0])).toBe(true);
    expect(LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((x) => x.id)).toEqual([
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
    ]);
    expect(LIFECYCLE_DIAGRAM_TAXONOMY.milestones.map((x) => x.id)).toEqual([
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
    ]);
    expect(LIFECYCLE_DIAGRAM_TAXONOMY.endpoints.map((x) => x.id)).toEqual([
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

  it("handles empty and single bundles with namespaced nodes and links", () => {
    expect(projectLifecycleAt()).toMatchObject({
      includedApplications: 0,
      totalApplications: 0,
      links: [],
    });
    const result = projectLifecycleAt({
      applications: [app("a1")],
      lifecycleEvents: [],
    });
    expect(result.paths[0].nodes).toEqual([
      "origin:application_submitted",
      "endpoint:awaiting_response",
    ]);
    expect(result.links[0]).toEqual({
      id: "origin:application_submitted->endpoint:awaiting_response",
      source: "origin:application_submitted",
      target: "endpoint:awaiting_response",
      value: 1,
      applicationIds: ["a1"],
    });
  });

  it("covers every origin and endpoint with aggregation by application", () => {
    const origins = LIFECYCLE_DIAGRAM_TAXONOMY.origins.map((x) => x.id);
    const endpoints = [
      "employer_rejected",
      "candidate_withdrew",
      "offer_declined",
      "offer_expired_rescinded",
      "offer_accepted",
      "closed_archived",
      "offer_negotiating",
      "assessment_in_progress",
      "interviewing",
      "awaiting_response",
      "unknown",
    ];
    const applications = endpoints.map((endpoint, index) =>
      app(`a${index}`, {
        origin: origins[index % origins.length],
        status: endpoint === "unknown" ? "mystery" : "applied",
      }),
    );
    const lifecycleEvents = applications.flatMap((a, index) =>
      endpoints[index] === "unknown"
        ? []
        : [
            ev(
              `e${index}`,
              a.id,
              endpoints[index] === "interviewing"
                ? "recruiter_screen"
                : endpoints[index] === "assessment_in_progress"
                  ? "assessment_take_home"
                  : endpoints[index] === "awaiting_response"
                    ? a.origin
                    : endpoints[index],
              "2025-01-01T00:00:00.000Z",
              endpoints[index] === "assessment_in_progress"
                ? { actionStatus: "in_progress" }
                : {},
            ),
          ],
    );
    const result = projectLifecycleAt({ applications, lifecycleEvents });
    expect(result.includedApplications).toBe(endpoints.length);
    expect(result.totals.active + result.totals.terminal).toBe(
      endpoints.length,
    );
    for (const endpoint of endpoints)
      expect(result.totals.endpoints[`endpoint:${endpoint}`]).toBe(1);
  });

  it(
    "collapses repeated milestones, avoids skipped-stage invention, and warns on regressions " +
      "without backward links",
    () => {
      const result = projectLifecycleAt({
        applications: [app("a")],
        lifecycleEvents: [
          ev("e1", "a", "technical_interview"),
          ev("e2", "a", "technical_interview"),
          ev("e3", "a", "recruiter_screen", "2025-01-02T00:00:00.000Z"),
        ],
      });
      expect(result.paths[0].milestones).toEqual([
        "milestone:recruiter_screen",
        "milestone:technical_interview",
      ]);
      expect(result.warningCounts.regressive_history).toBe(1);
      expect(
        result.links.every(
          (l) =>
            !l.id.includes("technical_interview->milestone:recruiter_screen"),
        ),
      ).toBe(true);
    },
  );

  it("implements assessment action-status behavior", () => {
    expect(
      projectLifecycleAt({
        applications: [app("a")],
        lifecycleEvents: [
          ev("e", "a", "assessment_take_home", "2025-01-01T00:00:00.000Z", {
            actionStatus: "pending",
          }),
        ],
      }).paths[0].endpoint,
    ).toBe("endpoint:assessment_in_progress");
    expect(
      projectLifecycleAt({
        applications: [app("a")],
        lifecycleEvents: [
          ev("e", "a", "assessment_take_home", "2025-01-01T00:00:00.000Z", {
            actionStatus: "submitted",
          }),
        ],
      }).paths[0].endpoint,
    ).toBe("endpoint:awaiting_response");
  });

  it(
    "builds deterministic atomic timeline buckets for equal instants, offsets, " +
      "inclusive cutoffs, and date-only ordering",
    () => {
      const bundle = {
        applications: [app("a"), app("b")],
        lifecycleEvents: [
          ev(
            "z",
            "a",
            "application_submitted",
            "2025-01-02T01:00:00.000+01:00",
          ),
          ev("a", "b", "application_submitted", "2025-01-02T00:00:00.000Z"),
          ev("d", "a", "recruiter_screen", "2025-01-02", {
            occurredAtPrecision: "date",
          }),
        ],
      };
      const timeline = buildLifecycleTimeline(bundle);
      expect(timeline.buckets.map((b) => b.id)).toEqual([
        "unknown-date",
        "date:2025-01-02",
        "instant:2025-01-02T00:00:00.000Z",
        "current",
      ]);
      expect(timeline.buckets[2].eventIds).toEqual(["a", "z"]);
      expect(
        projectLifecycleAt(bundle, "instant:2025-01-02T00:00:00.000Z")
          .includedApplications,
      ).toBe(2);
    },
  );

  it(
    "isolates unknown-date, excludes unknown historically, includes it in current, " +
      "and prevents future leakage",
    () => {
      const bundle = {
        applications: [app("a"), app("b")],
        lifecycleEvents: [
          ev("u", "a", "application_submitted", "1970-01-01", {
            occurredAtPrecision: "unknown",
          }),
          ev("d", "b", "application_submitted", "2025-01-01"),
          ev("f", "b", "offer_accepted", "2025-01-03T00:00:00.000Z"),
        ],
      };
      expect(
        projectLifecycleAt(bundle, "unknown-date").paths.map(
          (p) => p.applicationId,
        ),
      ).toEqual(["a"]);
      expect(
        projectLifecycleAt(bundle, "date:2025-01-01").paths.map(
          (p) => p.applicationId,
        ),
      ).toEqual(["b"]);
      expect(
        projectLifecycleAt(bundle, "date:2025-01-01").paths[0].endpoint,
      ).toBe("endpoint:awaiting_response");
      expect(projectLifecycleAt(bundle).includedApplications).toBe(2);
    },
  );

  it("keeps terminal state until explicit reopen and flags lower-stage activity", () => {
    const closed = projectLifecycleAt({
      applications: [app("a")],
      lifecycleEvents: [
        ev("r", "a", "employer_rejected"),
        ev("i", "a", "technical_interview", "2025-01-02T00:00:00.000Z"),
      ],
    });
    expect(closed.paths[0].endpoint).toBe("endpoint:employer_rejected");
    expect(closed.warningCounts.terminal_without_reopen).toBe(1);
    const reopened = projectLifecycleAt({
      applications: [app("a")],
      lifecycleEvents: [
        ev("r", "a", "employer_rejected"),
        ev("o", "a", "application_reopened", "2025-01-02T00:00:00.000Z"),
        ev("i", "a", "technical_interview", "2025-01-03T00:00:00.000Z"),
      ],
    });
    expect(reopened.paths[0].endpoint).toBe("endpoint:interviewing");
  });

  it(
    "reports inferred, status mismatch, invalid, unknown, orphan, and supersession " +
      "handling",
    () => {
      const bundle = {
        applications: [
          app("a", { status: "accepted" }),
          app("b", { status: "accepted" }),
        ],
        lifecycleEvents: [
          ev("old", "a", "employer_rejected"),
          ev("new", "a", "unknown_weird", "bad", {
            occurredAtPrecision: "instant",
            supersedesEventId: "old",
            inferred: true,
          }),
          ev("mismatch", "b", "application_submitted"),
          ev("orphan", "missing", "application_submitted"),
        ],
      };
      const result = projectLifecycleAt(bundle);
      expect(result.paths[0].endpoint).toBe("endpoint:offer_accepted");
      expect(result.warningCounts.inferred_event).toBe(1);
      expect(result.warningCounts.status_mismatch).toBe(1);
      expect(result.warningCounts.invalid_timestamp).toBe(1);
      expect(result.warningCounts.unknown_event_type).toBe(1);
      expect(result.warningCounts.orphaned_event).toBe(1);
    },
  );

  it("is independent of input order and never mutates input or prior results", () => {
    const bundle = {
      applications: [app("b"), app("a")],
      lifecycleEvents: [
        ev("2", "b", "offer_received"),
        ev("1", "a", "application_submitted"),
      ],
    };
    const before = JSON.stringify(bundle);
    const r1 = projectLifecycleAt(bundle);
    const r2 = projectLifecycleAt({
      applications: [...bundle.applications].reverse(),
      lifecycleEvents: [...bundle.lifecycleEvents].reverse(),
    });
    expect(r2).toEqual(r1);
    expect(JSON.stringify(bundle)).toBe(before);
    expect(() => r1.paths.push({})).toThrow();
  });

  it("satisfies core graph invariants for a large aggregate fixture", () => {
    const applications = Array.from({ length: 120 }, (_, i) =>
      app(`app-${String(i).padStart(3, "0")}`),
    );
    const lifecycleEvents = applications.flatMap((a, i) => [
      ev(`s-${i}`, a.id, "application_submitted"),
      ...(i % 2 ? [ev(`r-${i}`, a.id, "recruiter_screen")] : []),
      ...(i % 3 ? [ev(`t-${i}`, a.id, "technical_interview")] : []),
      ...(i % 5 ? [ev(`o-${i}`, a.id, "offer_received")] : []),
    ]);
    const result = projectLifecycleAt({ applications, lifecycleEvents });
    expect(result.paths).toHaveLength(120);
    expect(
      Object.values(result.totals.origins).reduce((a, b) => a + b, 0),
    ).toBe(120);
    expect(
      Object.values(result.totals.endpoints).reduce((a, b) => a + b, 0),
    ).toBe(120);
    for (const link of result.links) {
      expect(Number.isInteger(link.value) && link.value > 0).toBe(true);
      expect(link.source).not.toBe(link.target);
      expect(new Set(link.applicationIds).size).toBe(
        link.applicationIds.length,
      );
      expect(link.value).toBe(link.applicationIds.length);
    }
    for (const path of result.paths)
      expect(new Set(path.milestones).size).toBe(path.milestones.length);
  });
});
