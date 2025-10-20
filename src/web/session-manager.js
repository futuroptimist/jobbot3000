import { randomBytes } from "node:crypto";

const DEFAULT_ROTATE_AFTER_MS = 15 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 10_000;

function resolvePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.floor(numeric);
}

function now(clock) {
  if (clock && typeof clock.now === "function") {
    const current = Number(clock.now());
    if (Number.isFinite(current)) {
      return current;
    }
  }
  return Date.now();
}

function clampDeadline(candidate, fallback) {
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return fallback;
  }
  return candidate;
}

export function createSessionManager(options = {}) {
  const rotateAfterMs = resolvePositiveInteger(
    options.rotateAfterMs,
    DEFAULT_ROTATE_AFTER_MS,
  );
  const idleTimeoutMs = resolvePositiveInteger(
    options.idleTimeoutMs,
    DEFAULT_IDLE_TIMEOUT_MS,
  );
  const absoluteTimeoutMs = resolvePositiveInteger(
    options.absoluteTimeoutMs,
    DEFAULT_ABSOLUTE_TIMEOUT_MS,
  );
  const maxSessions = resolvePositiveInteger(
    options.maxSessions,
    DEFAULT_MAX_SESSIONS,
  );
  const clock = options.clock;

  const sessions = new Map();

  function evictOldestSession() {
    const oldest = sessions.keys().next();
    if (oldest.done) {
      return false;
    }
    sessions.delete(oldest.value);
    return true;
  }

  function cleanup(current) {
    for (const [id, session] of sessions) {
      if (
        current >= session.absoluteExpiresAt ||
        current >= session.idleExpiresAt
      ) {
        sessions.delete(id);
      }
    }
  }

  function createSession({
    current,
    absoluteDeadline,
    previousId = null,
    reason = "created",
  } = {}) {
    while (sessions.size >= maxSessions) {
      if (!evictOldestSession()) {
        break;
      }
    }
    if (sessions.size >= maxSessions) {
      throw new Error("Session capacity exceeded");
    }
    const id = randomBytes(24).toString("hex");
    const absoluteExpiresAt = Math.min(
      clampDeadline(absoluteDeadline, Number.POSITIVE_INFINITY),
      current + absoluteTimeoutMs,
    );
    const idleExpiresAt = Math.min(absoluteExpiresAt, current + idleTimeoutMs);
    const rotateAt = Math.min(absoluteExpiresAt, current + rotateAfterMs);
    const session = {
      id,
      createdAt: current,
      lastSeenAt: current,
      absoluteExpiresAt,
      idleExpiresAt,
      rotateAt,
      previousId,
      reason,
    };
    sessions.set(id, session);
    return {
      session,
      created: true,
      rotated: reason === "rotated",
      previousId,
      reason,
    };
  }

  function rotateSession(session, current) {
    sessions.delete(session.id);
    return createSession({
      current,
      absoluteDeadline: session.absoluteExpiresAt,
      previousId: session.id,
      reason: "rotated",
    });
  }

  function ensureSession(existingId, options = {}) {
    const createIfMissing = options.createIfMissing !== false;
    const current = now(clock);
    cleanup(current);

    if (existingId) {
      const session = sessions.get(existingId);
      if (session) {
        if (
          current >= session.absoluteExpiresAt ||
          current >= session.idleExpiresAt
        ) {
          sessions.delete(existingId);
          if (!createIfMissing) {
            return null;
          }
          return createSession({
            current,
            absoluteDeadline: session.absoluteExpiresAt,
            previousId: session.id,
            reason: "expired",
          });
        }

        session.lastSeenAt = current;
        session.idleExpiresAt = Math.min(
          session.absoluteExpiresAt,
          current + idleTimeoutMs,
        );

        if (current >= session.rotateAt) {
          return rotateSession(session, current);
        }

        return {
          session,
          created: false,
          rotated: false,
          previousId: null,
          reason: "active",
        };
      }
    }

    if (!createIfMissing) {
      return null;
    }

    return createSession({ current, reason: existingId ? "renewed" : "new" });
  }

  function revokeSession(sessionId) {
    if (typeof sessionId !== "string") {
      return false;
    }
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return false;
    }
    return sessions.delete(trimmed);
  }

  function getCookieMetadata(session) {
    if (!session) {
      return { maxAgeSeconds: 0 };
    }
    const current = now(clock);
    const deadline = Math.min(
      session.rotateAt,
      session.idleExpiresAt,
      session.absoluteExpiresAt,
    );
    const remainingMs = Math.max(0, deadline - current);
    const maxAgeSeconds = Math.max(1, Math.floor(remainingMs / 1000));
    return { maxAgeSeconds };
  }

  return {
    ensureSession,
    revokeSession,
    getCookieMetadata,
  };
}
