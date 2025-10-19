const DEFAULT_MAX_ENTRIES_PER_CLIENT = 5;

const clone =
  typeof structuredClone === "function"
    ? structuredClone
    : (value) => {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
      };

function sanitizeString(value) {
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
    if (isControl) {
      continue;
    }
    sanitized += value[index];
  }

  return sanitized.trim();
}

function sanitizeValue(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    const sanitized = sanitizeString(value);
    return sanitized === "" ? undefined : sanitized;
  }
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => sanitizeValue(entry))
      .filter((entry) => entry !== undefined);
    return entries;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object") {
    const sanitized = {};
    for (const key of Object.keys(value)) {
      const normalizedKey = sanitizeString(key);
      if (!normalizedKey) continue;
      const sanitizedEntry = sanitizeValue(value[key]);
      if (sanitizedEntry === undefined) continue;
      sanitized[normalizedKey] = sanitizedEntry;
    }
    return sanitized;
  }
  return undefined;
}

function normalizeClientId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeCommand(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function createClientPayloadStore(options = {}) {
  const limitRaw = options.maxEntriesPerClient ?? DEFAULT_MAX_ENTRIES_PER_CLIENT;
  const limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("maxEntriesPerClient must be a positive number");
  }

  const store = new Map();

  function record(clientId, command, payload) {
    const normalizedClientId = normalizeClientId(clientId);
    const normalizedCommand = normalizeCommand(command);
    if (!normalizedClientId || !normalizedCommand) {
      return null;
    }

    const sanitizedPayload = sanitizeValue(payload ?? {});
    const entry = {
      command: normalizedCommand,
      payload: sanitizedPayload ?? {},
      timestamp: new Date().toISOString(),
    };

    let entries = store.get(normalizedClientId);
    if (!entries) {
      entries = [];
      store.set(normalizedClientId, entries);
    }
    entries.push(entry);
    if (entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }
    return { ...entry, payload: clone(entry.payload) };
  }

  function getRecent(clientId) {
    const normalizedClientId = normalizeClientId(clientId);
    if (!normalizedClientId) {
      return [];
    }
    const entries = store.get(normalizedClientId);
    if (!entries || entries.length === 0) {
      return [];
    }
    return entries.map((entry) => ({
      command: entry.command,
      timestamp: entry.timestamp,
      payload: clone(entry.payload),
    }));
  }

  return { record, getRecent };
}

export function createClientIdentity({ subject, clientIp, userAgent }) {
  const parts = [];
  if (typeof subject === "string" && subject.trim()) {
    parts.push(subject.trim());
  } else {
    parts.push("guest");
  }

  if (typeof clientIp === "string" && clientIp.trim()) {
    parts.push(clientIp.trim());
  }

  if (typeof userAgent === "string" && userAgent.trim()) {
    parts.push(userAgent.trim());
  }

  return parts.join("|");
}

