import { randomUUID } from "node:crypto";

const DEFAULT_MAX_ENTRIES_PER_CLIENT = 20;
const DEFAULT_MAX_CLIENTS = 200;

function sanitizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isControl =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f;
    if (isControl) continue;
    sanitized += value[index];
  }

  return sanitized.trim();
}

function sanitizeOptional(value) {
  const sanitized = sanitizeText(value);
  return sanitized || undefined;
}

export function createFeedbackStore({
  maxEntriesPerClient = DEFAULT_MAX_ENTRIES_PER_CLIENT,
  maxClients = DEFAULT_MAX_CLIENTS,
} = {}) {
  const entriesByClient = new Map();

  const rotateClientsIfNeeded = () => {
    while (entriesByClient.size > maxClients) {
      const oldestKey = entriesByClient.keys().next().value;
      if (oldestKey) {
        entriesByClient.delete(oldestKey);
      } else {
        break;
      }
    }
  };

  const record = (identity, payload) => {
    const message = sanitizeOptional(payload?.message);
    if (!message) {
      return null;
    }

    const entry = {
      id: randomUUID(),
      message,
      recordedAt: new Date().toISOString(),
    };

    const path = sanitizeOptional(payload?.path);
    if (path) entry.path = path;

    const contact = sanitizeOptional(payload?.contact);
    if (contact) entry.contact = contact;

    const contextInput =
      payload && typeof payload.context === "object" && payload.context !== null
        ? payload.context
        : undefined;
    if (contextInput && Object.keys(contextInput).length > 0) {
      const sanitizedContext = {};
      for (const [key, value] of Object.entries(contextInput)) {
        if (typeof value === "string") {
          const sanitizedValue = sanitizeOptional(value);
          if (sanitizedValue !== undefined) {
            sanitizedContext[key] = sanitizedValue;
          }
          continue;
        }
        sanitizedContext[key] = value;
      }
      if (Object.keys(sanitizedContext).length > 0) {
        entry.context = sanitizedContext;
      }
    }

    const clientKey = typeof identity === "string" && identity.trim()
      ? identity.trim()
      : "guest";
    const list = entriesByClient.get(clientKey) ?? [];
    list.unshift(entry);
    if (list.length > maxEntriesPerClient) {
      list.length = maxEntriesPerClient;
    }
    entriesByClient.set(clientKey, list);
    rotateClientsIfNeeded();
    return entry;
  };

  const getRecent = (identity) => {
    const clientKey = typeof identity === "string" && identity.trim()
      ? identity.trim()
      : "guest";
    return entriesByClient.get(clientKey) ?? [];
  };

  return { record, getRecent };
}

