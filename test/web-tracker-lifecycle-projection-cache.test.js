import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";
import { buildLifecycleTimeline } from "../src/web/tracker/lifecycleProjection.js";
import {
  contentHashForBundle,
  getOrComputeTimeline,
  scheduleAdjacentBucketPrecompute,
} from "../src/web/tracker/lifecycleProjectionCache.js";

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
const bundle = (applications, lifecycleEvents, extra = {}) => ({
  applications,
  lifecycleEvents,
  ...extra,
});
const threeEventBundle = () =>
  bundle(
    [app("a")],
    [
      ev("o", "a", "application_submitted", "2026-01-01"),
      ev("t", "a", "technical_interview", "2026-01-02"),
      ev("r", "a", "offer_received", "2026-01-03"),
    ],
  );

const deleteDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
afterEach(deleteDatabase);

describe("lifecycleProjectionCache", () => {
  it("a cache hit avoids recomputation", async () => {
    const store = await createIndexedDbRepository({ indexedDb: indexedDB });
    const b = threeEventBundle();
    const computeTimeline = vi.fn(buildLifecycleTimeline);

    const first = await getOrComputeTimeline(store, b, computeTimeline);
    await first.persisted;
    const second = await getOrComputeTimeline(store, b, computeTimeline);

    expect(computeTimeline).toHaveBeenCalledTimes(1);
    expect(second.hash).toBe(first.hash);
    expect(second.timeline).toEqual(first.timeline);
    store.close();
  });

  it("uses a versioned, unambiguous content-hash encoding", () => {
    expect(contentHashForBundle(threeEventBundle())).toMatch(
      /^v\d+:[0-9a-z]+:[0-9a-z]+$/,
    );
  });

  it("a miss computes and persists", async () => {
    const store = await createIndexedDbRepository({ indexedDb: indexedDB });
    const b = threeEventBundle();
    const computeTimeline = vi.fn(buildLifecycleTimeline);

    const { timeline, hash, persisted } = await getOrComputeTimeline(
      store,
      b,
      computeTimeline,
    );
    expect(computeTimeline).toHaveBeenCalledTimes(1);
    await persisted;

    expect(await store.getCachedLifecycleTimeline(hash)).toEqual(timeline);
    store.close();
  });

  // eslint-disable-next-line max-len
  it("a content change produces a different hash, a correct miss, and evicts the old hash's entries", async () => {
    const store = await createIndexedDbRepository({ indexedDb: indexedDB });
    const a = threeEventBundle();
    const { hash: hashA, persisted: persistedA } = await getOrComputeTimeline(
      store,
      a,
    );
    await persistedA;
    expect(await store.getCachedLifecycleTimeline(hashA)).not.toBeNull();

    const b = bundle(
      [app("a"), app("b")],
      [
        ...a.lifecycleEvents,
        ev("o2", "b", "application_submitted", "2026-01-04"),
      ],
    );
    const { hash: hashB, persisted: persistedB } = await getOrComputeTimeline(
      store,
      b,
    );
    await persistedB;

    expect(hashB).not.toBe(hashA);
    expect(await store.getCachedLifecycleTimeline(hashA)).toBeNull();
    expect(await store.getCachedLifecycleTimeline(hashB)).not.toBeNull();
    store.close();
  });

  // eslint-disable-next-line max-len
  it("an unrelated-store mutation with unchanged applications/lifecycleEvents is a cache hit -- the core value-add over the pre-existing in-memory cache", async () => {
    const store = await createIndexedDbRepository({ indexedDb: indexedDB });
    const { applications, lifecycleEvents } = threeEventBundle();
    const a = bundle(applications, lifecycleEvents, { contacts: [] });
    const computeTimeline = vi.fn(buildLifecycleTimeline);

    const first = await getOrComputeTimeline(store, a, computeTimeline);
    await first.persisted;

    // A NEW bundle object (as refresh() produces after every write), same
    // applications/lifecycleEvents, but a different unrelated store --
    // simulates adding a contact elsewhere in the tracker. The in-memory
    // WeakMap cache in lifecycleProjection.js would treat this as a full
    // miss (new object identity); this cache must not.
    const b = bundle(applications, lifecycleEvents, {
      contacts: [{ id: "c1" }],
    });
    expect(b).not.toBe(a);
    const second = await getOrComputeTimeline(store, b, computeTimeline);

    expect(computeTimeline).toHaveBeenCalledTimes(1);
    expect(second.hash).toBe(first.hash);
    store.close();
  });

  // eslint-disable-next-line max-len
  it("scheduleAdjacentBucketPrecompute populates only the immediately adjacent buckets", async () => {
    const store = await createIndexedDbRepository({ indexedDb: indexedDB });
    const b = threeEventBundle();
    const timeline = buildLifecycleTimeline(b);
    const hash = contentHashForBundle(b);
    expect(timeline.buckets.length).toBeGreaterThanOrEqual(3);
    const bucketIndex = 1;
    const bucketId = timeline.buckets[bucketIndex].id;
    const neighborIds = [
      timeline.buckets[bucketIndex - 1].id,
      timeline.buckets[bucketIndex + 1].id,
    ];

    let capturedCallback;
    scheduleAdjacentBucketPrecompute(store, () => b, timeline, hash, bucketId, {
      requestIdle: (callback) => {
        capturedCallback = callback;
        return "handle";
      },
      cancelIdle: () => {},
    });
    await capturedCallback();

    for (const neighborId of neighborIds) {
      expect(
        await store.getCachedLifecycleProjection(hash, neighborId),
      ).not.toBeNull();
    }
    const otherIds = timeline.buckets
      .map((bkt) => bkt.id)
      .filter((id) => id !== bucketId && !neighborIds.includes(id));
    for (const otherId of otherIds) {
      expect(
        await store.getCachedLifecycleProjection(hash, otherId),
      ).toBeNull();
    }
    store.close();
  });

  // eslint-disable-next-line max-len
  it("abandons a stale precompute when the content hash changes before the idle callback fires", async () => {
    const store = await createIndexedDbRepository({ indexedDb: indexedDB });
    const a = threeEventBundle();
    const timeline = buildLifecycleTimeline(a);
    const hash = contentHashForBundle(a);
    expect(timeline.buckets.length).toBeGreaterThanOrEqual(3);
    const bucketIndex = 1;
    const bucketId = timeline.buckets[bucketIndex].id;
    const neighborIds = [
      timeline.buckets[bucketIndex - 1].id,
      timeline.buckets[bucketIndex + 1].id,
    ];

    let currentBundle = a;
    let capturedCallback;
    scheduleAdjacentBucketPrecompute(
      store,
      () => currentBundle,
      timeline,
      hash,
      bucketId,
      {
        requestIdle: (callback) => {
          capturedCallback = callback;
          return "handle";
        },
        cancelIdle: () => {},
      },
    );

    // A real edit lands before the idle callback fires.
    currentBundle = bundle(
      [...a.applications, app("b")],
      [
        ...a.lifecycleEvents,
        ev("o2", "b", "application_submitted", "2026-01-04"),
      ],
    );
    await capturedCallback();

    for (const neighborId of neighborIds) {
      expect(
        await store.getCachedLifecycleProjection(hash, neighborId),
      ).toBeNull();
    }
    store.close();
  });

  it("cancels an in-flight precompute before it can queue another write", async () => {
    const b = threeEventBundle();
    const timeline = buildLifecycleTimeline(b);
    const hash = contentHashForBundle(b);
    const bucketId = timeline.buckets[1].id;
    let capturedCallback;
    let releaseFirstWrite;
    const firstWrite = new Promise((resolve) => {
      releaseFirstWrite = resolve;
    });
    const store = {
      putCachedLifecycleProjection: vi
        .fn()
        .mockImplementationOnce(() => firstWrite)
        .mockResolvedValue(undefined),
    };
    const cancel = scheduleAdjacentBucketPrecompute(
      store,
      () => b,
      timeline,
      hash,
      bucketId,
      {
        requestIdle: (callback) => {
          capturedCallback = callback;
          return "handle";
        },
        cancelIdle: () => {},
      },
    );

    const running = capturedCallback();
    expect(store.putCachedLifecycleProjection).toHaveBeenCalledTimes(1);
    cancel();
    releaseFirstWrite();
    await running;

    expect(store.putCachedLifecycleProjection).toHaveBeenCalledTimes(1);
  });
});
