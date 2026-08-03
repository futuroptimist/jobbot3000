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

  it("memoizes buildLifecycleTimeline and projectLifecycleAt per bundle reference", () => {
    const b = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );

    expect(buildLifecycleTimeline(b)).toBe(buildLifecycleTimeline(b));

    const timeline = buildLifecycleTimeline(b);
    const bucketA = timeline.buckets[1].id;
    const bucketB = timeline.buckets[2].id;
    expect(bucketA).not.toBe(bucketB);
    expect(projectLifecycleAt(b, bucketA)).toBe(projectLifecycleAt(b, bucketA));
    expect(projectLifecycleAt(b, bucketA)).not.toBe(
      projectLifecycleAt(b, bucketB),
    );

    // A value-equal but reference-distinct bundle must not share the cache —
    // caching is by object identity, not by deep equality.
    const bEqual = bundle(
      [app("a")],
      [
        ev("o", "a", "application_submitted", "2026-01-01"),
        ev("t", "a", "technical_interview", "2026-01-02"),
      ],
    );
    expect(projectLifecycleAt(bEqual, bucketA)).not.toBe(
      projectLifecycleAt(b, bucketA),
    );
    expect(projectLifecycleAt(bEqual, bucketA)).toEqual(
      projectLifecycleAt(b, bucketA),
    );
  });

  it("reuses an unchanged application's path across a bucket transition", () => {
    const b = bundle(
      [app("a"), app("b")],
      [
        ev("a1", "a", "application_submitted", "2026-01-01"),
        ev("b1", "b", "application_submitted", "2026-01-01"),
        ev("b2", "b", "recruiter_screen", "2026-01-05"),
      ],
    );
    const timeline = buildLifecycleTimeline(b);
    const bucketA = timeline.buckets[1].id;
    const bucketB = timeline.buckets[2].id;
    expect(bucketA).not.toBe(bucketB);

    const pathAt = (bucketId, applicationId) =>
      projectLifecycleAt(b, bucketId).paths.find(
        (path) => path.applicationId === applicationId,
      );

    // Application "a" gets no new events between bucketA and bucketB, so
    // its included-event-id-set is identical — the cached path object must
    // be reused verbatim rather than recomputed.
    expect(pathAt(bucketB, "a")).toBe(pathAt(bucketA, "a"));
    // Application "b" gains an event at bucketB, so its path must differ.
    expect(pathAt(bucketB, "b")).not.toBe(pathAt(bucketA, "b"));
    expect(pathAt(bucketB, "b").milestones).toContain("recruiter_screen");
  });

  it("includes isCurrent in the app-path cache key to avoid historical-bucket collisions", () => {
    // An application whose event-id-set at "current" is identical to its
    // set at the last historical bucket must not have its result wrongly
    // shared across the isCurrent boundary, since isCurrent affects the
    // status_mismatch warning check.
    const b = bundle(
      [app("a", { status: "rejected" })],
      [ev("a1", "a", "application_submitted", "2026-01-01")],
    );
    const timeline = buildLifecycleTimeline(b);
    const lastHistoricalBucket = timeline.buckets.at(-2).id;
    expect(lastHistoricalBucket).not.toBe("current");

    const historical = projectLifecycleAt(b, lastHistoricalBucket).paths[0];
    const current = projectLifecycleAt(b, "current").paths[0];
    expect(historical).not.toBe(current);
    // Only the "current" projection checks status_mismatch against
    // app.status ("rejected" vs. the replayed "awaiting_response").
    expect(historical.details.some((d) => d.code === "status_mismatch")).toBe(
      false,
    );
    expect(current.details.some((d) => d.code === "status_mismatch")).toBe(
      true,
    );
  });

  it("evicts the least-recently-used cached application path past the per-bundle cap", () => {
    // Guards the bounded per-application-path cache: without an eviction
    // policy, an application with a pathological number of distinct
    // event-id-set signatures (e.g. many reopen/supersede cycles) would
    // retain one cached path per signature indefinitely.
    const events = [ev("a0", "a", "application_submitted", "2026-01-01")];
    for (let i = 0; i < 520; i += 1) {
      const date = new Date(Date.UTC(2026, 1, 1));
      date.setUTCHours(date.getUTCHours() + i);
      events.push(
        ev("reopen-" + i, "a", "application_reopened", date.toISOString()),
      );
    }
    const b = bundle([app("a")], events);
    const timeline = buildLifecycleTimeline(b);
    const datedBucketIds = timeline.buckets
      .map((entry) => entry.id)
      .filter((id) => id !== "unknown-date" && id !== "current");
    expect(datedBucketIds.length).toBeGreaterThan(500);

    const firstBucketId = datedBucketIds[0];
    const firstPath = projectLifecycleAt(b, firstBucketId).paths[0];

    for (const bucketId of datedBucketIds.slice(1))
      projectLifecycleAt(b, bucketId);

    const revisitedPath = projectLifecycleAt(b, firstBucketId).paths[0];
    expect(revisitedPath).not.toBe(firstPath);
    expect(revisitedPath).toEqual(firstPath);
  });

  it("matches a cold (uncached) computation for a large randomized fixture", () => {
    // Cheap insurance against a bug in signature construction (id-ordering
    // assumptions, isCurrent handling, cap/eviction interactions) rather
    // than the state machine itself — projectApp's correctness is already
    // covered by the tests above; this only exercises the cache wrapper.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];

    const eventTypes = [
      "application_submitted",
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
      "employer_rejected",
      "candidate_withdrew",
      "application_reopened",
    ];
    const applications = Array.from({ length: 40 }, (_, i) => app(`a${i}`));
    const lifecycleEvents = [];
    for (let i = 0; i < 40; i += 1) {
      const eventCount = 3 + Math.floor(rand() * 10);
      for (let j = 0; j < eventCount; j += 1) {
        const day = 1 + Math.floor(rand() * 27);
        const hour = Math.floor(rand() * 24);
        lifecycleEvents.push(
          ev(
            `a${i}-e${j}`,
            `a${i}`,
            j === 0 ? "application_submitted" : pick(eventTypes),
            `2026-03-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`,
          ),
        );
      }
    }
    const liveBundle = bundle(applications, lifecycleEvents);
    const timeline = buildLifecycleTimeline(liveBundle);
    const bucketIds = timeline.buckets.map((entry) => entry.id);

    // Long random-order walk against one long-lived bundle to maximize
    // cache pressure and any key-construction bug surface area.
    const shuffledBucketIds = [...bucketIds];
    for (let i = shuffledBucketIds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [shuffledBucketIds[i], shuffledBucketIds[j]] = [
        shuffledBucketIds[j],
        shuffledBucketIds[i],
      ];
    }
    for (const bucketId of shuffledBucketIds) projectLifecycleAt(liveBundle, bucketId);

    // Sample buckets and compare the cache-exercised result against a
    // guaranteed-cold computation on a fresh, content-identical bundle
    // (its own empty cache entry — see the "value-equal but
    // reference-distinct bundle" test above for why this is cold).
    const sample = bucketIds.filter((_, index) => index % 5 === 0);
    for (const bucketId of sample) {
      const warm = projectLifecycleAt(liveBundle, bucketId);
      const cold = projectLifecycleAt(
        bundle(structuredClone(applications), structuredClone(lifecycleEvents)),
        bucketId,
      );
      expect(warm.paths).toEqual(cold.paths);
      expect(warm.nodes).toEqual(cold.nodes);
      expect(warm.links).toEqual(cold.links);
      expect(warm.totals).toEqual(cold.totals);
      expect(warm.warnings).toEqual(cold.warnings);
    }
  });

  it("evicts the least-recently-used cached projection past the per-bundle cap", () => {
    // Guards the bounded-cache fix: without an eviction policy, scrubbing
    // across many distinct buckets in one long-lived tab would retain a
    // fully-materialized projection per bucket forever.
    const dayEvents = Array.from({ length: 60 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1));
      date.setUTCDate(date.getUTCDate() + i + 1);
      return ev(
        `e${i}`,
        "a",
        "employer_response_received",
        date.toISOString().slice(0, 10),
      );
    });
    const b = bundle(
      [app("a")],
      [ev("o", "a", "application_submitted", "2026-01-01"), ...dayEvents],
    );
    const timeline = buildLifecycleTimeline(b);
    const datedBucketIds = timeline.buckets
      .map((entry) => entry.id)
      .filter((id) => id !== "unknown-date" && id !== "current");
    expect(datedBucketIds.length).toBeGreaterThan(50);

    const firstBucketId = datedBucketIds[0];
    const firstProjection = projectLifecycleAt(b, firstBucketId);

    // Visiting enough other distinct buckets pushes the first one out of the
    // bounded LRU cache.
    for (const bucketId of datedBucketIds.slice(1))
      projectLifecycleAt(b, bucketId);

    const revisited = projectLifecycleAt(b, firstBucketId);
    expect(revisited).not.toBe(firstProjection);
    expect(revisited).toEqual(firstProjection);

    // A recently visited bucket is still a cache hit.
    const lastBucketId = datedBucketIds.at(-1);
    const lastProjection = projectLifecycleAt(b, lastBucketId);
    expect(projectLifecycleAt(b, lastBucketId)).toBe(lastProjection);
  });

  it("keeps serving the cached projection if a bundle is mutated in place", () => {
    // Bundles must be treated as immutable once passed in: callers are
    // expected to always pass a *new* bundle object after any data change
    // (see src/web/tracker/tracker.js's refresh(), which always reassigns
    // state.bundle). This test pins that contract rather than leaving it
    // implicit — mutating a bundle in place and reusing the same reference
    // intentionally continues to serve the stale cached result.
    const b = bundle(
      [app("a")],
      [ev("o", "a", "application_submitted", "2026-01-01")],
    );
    const before = projectLifecycleAt(b, "current");
    expect(before.includedApplications).toBe(1);

    b.lifecycleEvents.push(
      ev("o2", "z", "application_submitted", "2026-01-02"),
    );
    b.applications.push(app("z"));

    const after = projectLifecycleAt(b, "current");
    expect(after).toBe(before);
    expect(after.includedApplications).toBe(1);
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

  it("preserves bare assessment milestones without activating progress", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "applied" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("assessment", "a", "assessment_take_home", "2026-01-02"),
        ],
      ),
    );

    expect(projection.paths[0].milestones).toEqual(["assessment_take_home"]);
    expect(projection.paths[0].endpoint).toBe("awaiting_response");
    expect(projection.totals.endpoints.assessment_in_progress).toBeUndefined();
  });

  it("normalizes bare legacy assessment aliases without activating progress", () => {
    for (const eventType of ["written_assessment", "take_home"]) {
      const projection = projectLifecycleAt(
        bundle(
          [app(`a_${eventType}`, { status: "applied" })],
          [
            ev(
              "origin",
              `a_${eventType}`,
              "application_submitted",
              "2026-01-01",
            ),
            ev("assessment", `a_${eventType}`, eventType, "2026-01-02"),
          ],
        ),
      );

      expect(projection.paths[0].milestones).toEqual(["assessment_take_home"]);
      expect(projection.paths[0].endpoint).toBe("awaiting_response");
      expect(projection.warningCounts.event_type_normalized).toBe(1);
    }
  });

  it("ignores unsupported assessment actions while preserving milestone state", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "applied" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("assessment", "a", "assessment_take_home", "2026-01-02", {
            actionStatus: "needs_review",
          }),
        ],
      ),
    );

    expect(projection.paths[0].milestones).toEqual(["assessment_take_home"]);
    expect(projection.paths[0].endpoint).toBe("awaiting_response");
  });

  it("activates requested assessments and clears them when done", () => {
    const requested = projectLifecycleAt(
      bundle(
        [app("a", { status: "technical_screen" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("request", "a", "assessment_take_home", "2026-01-02", {
            actionStatus: "requested",
          }),
        ],
      ),
    );
    expect(requested.paths[0].endpoint).toBe("assessment_in_progress");

    const done = projectLifecycleAt(
      bundle(
        [app("a", { status: "applied" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("request", "a", "assessment_take_home", "2026-01-02", {
            actionStatus: "requested",
          }),
          ev("done", "a", "assessment_take_home", "2026-01-03", {
            actionStatus: "done",
          }),
        ],
      ),
    );
    expect(done.paths[0].milestones).toEqual(["assessment_take_home"]);
    expect(done.paths[0].endpoint).toBe("awaiting_response");
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

  it("locks terminal endpoints from status-derived events until reopen", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "accepted" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("accepted", "a", "status_changed", "2026-01-02", {
            status: "accepted",
          }),
          ev("screen", "a", "recruiter_screen", "2026-01-03"),
        ],
      ),
    );

    expect(projection.paths[0].endpoint).toBe("offer_accepted");
    expect(projection.warningCounts.terminal_without_reopen).toBe(1);
    expect(projection.totals.terminal).toBe(1);
  });

  it("replays unknown-precision status snapshots after dated history", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "accepted" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("screen", "a", "technical_interview", "2026-01-02"),
          ev("snapshot", "a", "migration_status_snapshot", "2026-01-01", {
            occurredAtPrecision: "unknown",
            currentStatus: "accepted",
          }),
        ],
      ),
    );

    expect(projection.paths[0].endpoint).toBe("offer_accepted");
    expect(projection.warningCounts.status_mismatch).toBeUndefined();
  });

  it("does not let stale unknown terminal snapshots undo a dated reopen", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "technical_screen" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("reject", "a", "status_changed", "2026-01-02", {
            status: "rejected",
          }),
          ev("reopen", "a", "application_reopened", "2026-01-03"),
          ev("screen", "a", "technical_interview", "2026-01-04"),
          ev("snapshot", "a", "migration_status_snapshot", "2026-01-01", {
            occurredAtPrecision: "unknown",
            currentStatus: "rejected",
          }),
        ],
      ),
    );

    expect(projection.paths[0].endpoint).toBe("interviewing");
    expect(projection.totals.terminal).toBe(0);
    expect(projection.warningCounts.terminal_without_reopen).toBeUndefined();
  });

  it("keeps higher-precedence endpoints within the same timestamp bucket", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "offer" })],
        [
          ev("z_origin", "a", "application_submitted", "2026-01-01"),
          ev("a_offer", "a", "offer_received", "2026-01-01"),
        ],
      ),
    );

    expect(projection.paths[0].endpoint).toBe("offer_negotiating");
    expect(projection.paths[0].nodeIds).toContain("endpoint:offer_negotiating");
  });

  it("reports normalized legacy event types", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "recruiter_screen" })],
        [ev("legacy", "a", "recruiter_screen_scheduled", "2026-01-01")],
      ),
    );

    expect(projection.paths[0].milestones).toEqual(["recruiter_screen"]);
    expect(projection.warningCounts.event_type_normalized).toBe(1);
  });

  it("applies supersession only after the replacement is included", () => {
    const b = bundle(
      [app("a", { status: "offer" })],
      [
        ev("origin", "a", "application_submitted", "2026-01-01"),
        ev("screen", "a", "technical_interview", "2026-01-02"),
        ev("screen_fix", "a", "offer_received", "2026-01-03", {
          supersedesEventId: "screen",
        }),
      ],
    );

    expect(projectLifecycleAt(b, "2026-01-02|0").paths[0]).toMatchObject({
      milestones: ["technical_interview"],
      endpoint: "interviewing",
    });
    expect(projectLifecycleAt(b, "2026-01-03|0").paths[0]).toMatchObject({
      milestones: ["offer_received"],
      endpoint: "offer_negotiating",
    });
    expect(projectLifecycleAt(b).paths[0]).toMatchObject({
      milestones: ["offer_received"],
      endpoint: "offer_negotiating",
    });
  });

  it("keeps explicit 1970 date precision separate from unknown and invalid timestamps", () => {
    const b = bundle(
      [app("dated"), app("unknown"), app("invalid")],
      [
        ev("dated_epoch", "dated", "application_submitted", "1970-01-01", {
          occurredAtPrecision: "date",
        }),
        ev("unknown_epoch", "unknown", "application_submitted", "1970-01-01", {
          occurredAtPrecision: "unknown",
        }),
        ev("bad", "invalid", "application_submitted", "not-a-date", {
          occurredAtPrecision: "instant",
        }),
      ],
    );
    const timeline = buildLifecycleTimeline(b);

    expect(timeline.buckets.map((bucket) => bucket.id)).toEqual([
      "unknown-date",
      "1970-01-01|0",
      "current",
    ]);
    expect(
      projectLifecycleAt(b, "unknown-date").events.map((e) => e.id),
    ).toEqual(["unknown_epoch"]);
    expect(
      projectLifecycleAt(b, "1970-01-01|0").events.map((e) => e.id),
    ).toEqual(["dated_epoch"]);
    expect(projectLifecycleAt(b).warningCounts.invalid_timestamp).toBe(1);
  });

  it("uses status and stageLabel aliases without free-form stage inference", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "offer" })],
        [
          ev("status_alias", "a", "migration_status_snapshot", "2026-01-01", {
            status: "technical_screen",
          }),
          ev(
            "stage_label_alias",
            "a",
            "migration_status_snapshot",
            "2026-01-02",
            {
              stageLabel: "onsite_loop",
            },
          ),
          ev(
            "free_form_stage",
            "a",
            "migration_status_snapshot",
            "2026-01-03",
            {
              stage: "offer",
            },
          ),
        ],
      ),
    );

    expect(projection.paths[0].milestones).toEqual([
      "technical_interview",
      "onsite_final_loop",
    ]);
    expect(projection.paths[0].milestones).not.toContain("offer_received");
  });

  it("does not warn terminal_without_reopen for metadata-only events", () => {
    const projection = projectLifecycleAt(
      bundle(
        [app("a", { status: "rejected" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("reject", "a", "status_changed", "2026-01-02", {
            status: "rejected",
          }),
          ev("snapshot", "a", "migration_status_snapshot", "2026-01-03", {
            currentStatus: "rejected",
          }),
        ],
      ),
    );

    expect(projection.paths[0].endpoint).toBe("employer_rejected");
    expect(projection.warningCounts.terminal_without_reopen).toBeUndefined();
  });

  it("returns boundary events for dated projection buckets", () => {
    const b = bundle(
      [app("a")],
      [
        ev("origin", "a", "application_submitted", "2026-01-01"),
        ev("screen", "a", "technical_interview", "2026-01-02"),
      ],
    );
    const projection = projectLifecycleAt(b, "2026-01-02|0");

    expect(projection.paths[0].milestones).toEqual(["technical_interview"]);
    expect(projection.events.map((event) => event.id)).toEqual(["screen"]);
  });

  it("preserves status-derived terminals against active status events until reopen", () => {
    const noReopen = projectLifecycleAt(
      bundle(
        [app("a", { status: "rejected" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("reject", "a", "status_changed", "2026-01-02", {
            status: "rejected",
          }),
          ev("active_status", "a", "status_changed", "2026-01-03", {
            status: "technical_screen",
          }),
          ev(
            "active_snapshot",
            "a",
            "migration_status_snapshot",
            "2026-01-04",
            {
              currentStatus: "technical_screen",
            },
          ),
        ],
      ),
    );

    expect(noReopen.paths[0].endpoint).toBe("employer_rejected");
    expect(noReopen.warningCounts.terminal_without_reopen).toBe(2);

    const reopened = projectLifecycleAt(
      bundle(
        [app("a", { status: "technical_screen" })],
        [
          ev("origin", "a", "application_submitted", "2026-01-01"),
          ev("reject", "a", "status_changed", "2026-01-02", {
            status: "rejected",
          }),
          ev("reopen", "a", "application_reopened", "2026-01-03"),
          ev(
            "active_snapshot",
            "a",
            "migration_status_snapshot",
            "2026-01-04",
            {
              currentStatus: "technical_screen",
            },
          ),
        ],
      ),
    );

    expect(reopened.paths[0].endpoint).toBe("interviewing");
    expect(reopened.warningCounts.terminal_without_reopen).toBeUndefined();
  });

  it("clears same-bucket assessment activity when submitted or completed", () => {
    for (const actionStatus of ["submitted", "completed"]) {
      const projection = projectLifecycleAt(
        bundle(
          [app(`a_${actionStatus}`, { status: "applied" })],
          [
            ev(
              "origin",
              `a_${actionStatus}`,
              "application_submitted",
              "2026-01-01",
            ),
            ev(
              "request",
              `a_${actionStatus}`,
              "assessment_take_home",
              "2026-01-02",
              {
                actionStatus: "requested",
              },
            ),
            ev(
              "submit",
              `a_${actionStatus}`,
              "assessment_take_home",
              "2026-01-02",
              {
                actionStatus,
              },
            ),
          ],
        ),
      );

      expect(projection.paths[0].milestones).toEqual(["assessment_take_home"]);
      expect(projection.paths[0].endpoint).toBe("awaiting_response");
    }
  });

  it("lets the latest same-bucket status-derived terminal win by stable event id", () => {
    const rejectedWins = projectLifecycleAt(
      bundle(
        [app("a", { status: "rejected" })],
        [
          ev("a_accept", "a", "status_changed", "2026-01-01", {
            status: "accepted",
          }),
          ev("z_reject", "a", "status_changed", "2026-01-01", {
            status: "rejected",
          }),
        ],
      ),
    );
    expect(rejectedWins.paths[0].endpoint).toBe("employer_rejected");

    const acceptedWins = projectLifecycleAt(
      bundle(
        [app("a", { status: "accepted" })],
        [
          ev("a_reject", "a", "status_changed", "2026-01-01", {
            status: "rejected",
          }),
          ev("z_accept", "a", "status_changed", "2026-01-01", {
            status: "accepted",
          }),
        ],
      ),
    );
    expect(acceptedWins.paths[0].endpoint).toBe("offer_accepted");
  });

  it("exposes only effective same-bucket replacement events in timelines and projections", () => {
    const b = bundle(
      [app("a", { status: "offer" })],
      [
        ev("origin", "a", "application_submitted", "2026-01-01"),
        ev("old", "a", "technical_interview", "2026-01-02"),
        ev("replacement", "a", "offer_received", "2026-01-02", {
          supersedesEventId: "old",
        }),
      ],
    );

    const timelineBucket = buildLifecycleTimeline(b).buckets.find(
      (bucket) => bucket.id === "2026-01-02|0",
    );
    const projection = projectLifecycleAt(b, "2026-01-02|0");

    expect(timelineBucket.eventIds).toEqual(["replacement"]);
    expect(projection.events.map((event) => event.id)).toEqual(["replacement"]);
    expect(projection.paths[0]).toMatchObject({
      milestones: ["offer_received"],
      endpoint: "offer_negotiating",
    });
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
