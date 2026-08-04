import {
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "./lifecycleProjection.js";

/* global window */

// Two independent FNV-1a passes (different seeds) concatenated into one key
// -- same cost class as one hash, much larger collision space than a single
// 32-bit hash. No cryptographic property is needed: this only protects a
// same-origin, single-user local cache from serving one user's own stale
// data to themselves. Constants match the FNV-1a style already used in
// lifecycleReconciliation.js's hashPart (offset basis 2166136261, prime
// 16777619 are the standard 32-bit FNV-1a values); the second seed is just a
// different starting value so the two passes diverge.
const FNV_PRIME = 16777619;
const FNV_SEED_A = 2166136261;
const FNV_SEED_B = 84696351;

function fnv1a(input, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(36);
}

const codeCompare = (a, b) =>
  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

// Recursive key sort, applied on top of the row-level id sort below -- cheap
// defense-in-depth against any non-deterministic key insertion order within
// a single record (e.g. optional-field presence) silently hashing the same
// logical data two different ways and defeating every cache hit.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

// Only depends on applications + lifecycleEvents -- deliberately narrower
// than the bundle as a whole, so this cache (unlike the in-memory
// object-identity WeakMap cache in lifecycleProjection.js) survives both a
// page reload AND a same-session write to an unrelated store (contacts,
// outreach messages, reminders, artifacts), none of which the diagram reads.
// getAll() doesn't guarantee stable cross-call row ordering, so rows are
// sorted by id (both stores have keyPath: "id", unique) before serializing.
export function contentHashForBundle(bundle) {
  const applications = [...(bundle.applications ?? [])].sort((a, b) =>
    codeCompare(a.id, b.id),
  );
  const lifecycleEvents = [...(bundle.lifecycleEvents ?? [])].sort((a, b) =>
    codeCompare(a.id, b.id),
  );
  const serialized = JSON.stringify(
    canonicalize({ applications, lifecycleEvents }),
  );
  return `${fnv1a(serialized, FNV_SEED_A)}${fnv1a(serialized, FNV_SEED_B)}`;
}

// Cache reads/writes are best-effort -- a failure here must never break
// rendering, only forfeit the optimization for this one call.
function reportCacheError(error) {
  console.error("Lifecycle projection cache operation failed", error);
}

// `store` is the small repo.* adapter tracker.js wires up (getCached*/
// putCached*/evictStale*, delegating to indexedDbRepository.js). Injecting
// the real compute function as a default param (rather than spying on the
// lifecycleProjection.js export) keeps this module's tests independent of
// ESM live-binding/spy semantics.
export async function getOrComputeTimeline(
  store,
  bundle,
  computeTimeline = buildLifecycleTimeline,
) {
  const hash = contentHashForBundle(bundle);
  let cached = null;
  try {
    cached = await store.getCachedLifecycleTimeline(hash);
  } catch (error) {
    reportCacheError(error);
  }
  if (cached) return { timeline: cached, hash, persisted: Promise.resolve() };
  const timeline = computeTimeline(bundle);
  // Fire-and-forget from the caller's perspective -- render must never wait
  // on the *write*, only the *read* above. Returned so tests can await it
  // deterministically instead of polling on a timing-dependent write.
  const persisted = Promise.all([
    store.putCachedLifecycleTimeline(hash, timeline).catch(reportCacheError),
    store.evictStaleLifecycleProjectionCache(hash).catch(reportCacheError),
  ]);
  return { timeline, hash, persisted };
}

export async function getOrComputeProjection(
  store,
  bundle,
  hash,
  bucketId,
  computeProjection = projectLifecycleAt,
) {
  let cached = null;
  try {
    cached = await store.getCachedLifecycleProjection(hash, bucketId);
  } catch (error) {
    reportCacheError(error);
  }
  if (cached) return { projection: cached, persisted: Promise.resolve() };
  const projection = computeProjection(bundle, bucketId);
  const persisted = store
    .putCachedLifecycleProjection(hash, bucketId, projection)
    .catch(reportCacheError);
  return { projection, persisted };
}

// Schedules idle-time precompute of the buckets immediately adjacent (by
// index) to whichever bucket is currently selected -- not the whole
// timeline, which could be hundreds of buckets for a timestamp-diverse
// dataset. Returns a cancel function; callers should invoke any
// previously-returned cancel before scheduling a new one, so rapid
// scrubbing doesn't pile up stacked idle callbacks.
export function scheduleAdjacentBucketPrecompute(
  store,
  getBundle,
  timeline,
  hash,
  bucketId,
  {
    requestIdle = window.requestIdleCallback ??
      ((callback) =>
        window.setTimeout(
          () => callback({ didTimeout: true, timeRemaining: () => 0 }),
          200,
        )),
    cancelIdle = window.cancelIdleCallback ?? window.clearTimeout,
  } = {},
) {
  const index = timeline.buckets.findIndex((bucket) => bucket.id === bucketId);
  const neighborIds = [
    timeline.buckets[index - 1]?.id,
    timeline.buckets[index + 1]?.id,
  ].filter(Boolean);
  if (neighborIds.length === 0) return () => {};

  const handle = requestIdle(async () => {
    // A real edit can land between scheduling and this callback firing --
    // abandon rather than precompute against data that's already stale.
    if (contentHashForBundle(getBundle()) !== hash) return;
    for (const neighborId of neighborIds) {
      const projection = projectLifecycleAt(getBundle(), neighborId);
      // Re-check before EACH write, not just once for the whole batch -- an
      // edit can land between computing one neighbor and the next.
      if (contentHashForBundle(getBundle()) !== hash) return;
      store
        .putCachedLifecycleProjection(hash, neighborId, projection)
        .catch(reportCacheError);
    }
  });
  return () => cancelIdle(handle);
}
