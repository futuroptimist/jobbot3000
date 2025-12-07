import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const DEFAULT_MAX_ENTRIES_PER_CLIENT = 5;
const DEFAULT_MAX_CLIENTS = 200;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_IV_LENGTH = 12;
const DEFAULT_MAX_JITTER_MS = 750;

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
    if (entries.length === 0) {
      return undefined;
    }
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
    if (Object.keys(sanitized).length === 0) {
      return undefined;
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
  const sanitized = sanitizeString(value);
  if (!sanitized) return null;
  return sanitized;
}

function normalizeEncryptionKey(input) {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    return createHash("sha256").update(trimmed, "utf8").digest();
  }

  if (Buffer.isBuffer(input)) {
    if (input.length === 32) {
      return input;
    }
    return createHash("sha256").update(input).digest();
  }

  if (ArrayBuffer.isView(input)) {
    const view = Buffer.from(
      input.buffer,
      input.byteOffset,
      input.byteLength,
    );
    if (view.length === 32) {
      return view;
    }
    return createHash("sha256").update(view).digest();
  }

  if (input instanceof ArrayBuffer) {
    const buffer = Buffer.from(input);
    if (buffer.length === 32) {
      return buffer;
    }
    return createHash("sha256").update(buffer).digest();
  }

  return null;
}

function encryptPayload(payload, key) {
  const iv = randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const serialized = JSON.stringify(payload ?? {});
  const ciphertext = Buffer.concat([
    cipher.update(serialized, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptPayload(encrypted, key) {
  if (!encrypted || typeof encrypted !== "object") {
    return null;
  }

  try {
    const iv = Buffer.from(String(encrypted.iv ?? ""), "base64");
    const ciphertext = Buffer.from(
      String(encrypted.ciphertext ?? ""),
      "base64",
    );
    const tag = Buffer.from(String(encrypted.tag ?? ""), "base64");
    if (iv.length !== ENCRYPTION_IV_LENGTH || tag.length === 0) {
      return null;
    }
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

export function createClientPayloadStore(options = {}) {
  const limitRaw = options.maxEntriesPerClient ?? DEFAULT_MAX_ENTRIES_PER_CLIENT;
  const limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("maxEntriesPerClient must be a positive number");
  }

  const maxClientsRaw = options.maxClients ?? DEFAULT_MAX_CLIENTS;
  const maxClients = Number(maxClientsRaw);
  if (!Number.isFinite(maxClients) || maxClients <= 0) {
    throw new Error("maxClients must be a positive number");
  }

  const store = new Map();
  const encryption =
    options.encryption && typeof options.encryption === "object"
      ? options.encryption
      : null;
  const deriveKey =
    encryption && typeof encryption.deriveKey === "function"
      ? encryption.deriveKey
      : null;
  const encryptionEnabled = Boolean(deriveKey);
  const now =
    options.now && typeof options.now === "function" ? options.now : () => Date.now();
  const jitter =
    options.jitter && typeof options.jitter === "function"
      ? options.jitter
      : () => Math.round((Math.random() - 0.5) * 2 * DEFAULT_MAX_JITTER_MS);

  function enforceClientCapacity() {
    while (store.size > maxClients) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      store.delete(oldest);
    }
  }

  function record(clientId, command, payload, result) {
    const normalizedClientId = normalizeClientId(clientId);
    const normalizedCommand = normalizeCommand(command);
    if (!normalizedClientId || !normalizedCommand) {
      return null;
    }

    const sanitizedPayload = sanitizeValue(payload ?? {});
    const normalizedPayload = sanitizedPayload ?? {};
    const normalizedResult = sanitizeValue(result);
    let encryptedPayload = null;

    const baseTimestampMs = Number(now());
    const jitterMsRaw = Number(
      jitter({ clientId: normalizedClientId, command: normalizedCommand }),
    );
    const jitterMs = Number.isFinite(jitterMsRaw)
      ? Math.max(-DEFAULT_MAX_JITTER_MS, Math.min(DEFAULT_MAX_JITTER_MS, jitterMsRaw))
      : 0;
    const timestamp = new Date(baseTimestampMs + jitterMs).toISOString();

    const entryPayload = {
      payload: normalizedPayload,
    };
    if (normalizedResult !== undefined) {
      entryPayload.result = normalizedResult;
    }

    if (encryptionEnabled) {
      const key = normalizeEncryptionKey(
        deriveKey(normalizedClientId, { operation: "record" }),
      );
      if (!key) {
        return null;
      }
      encryptedPayload = encryptPayload(entryPayload, key);
    }

    const entry = {
      command: normalizedCommand,
      timestamp,
    };

    if (encryptedPayload) {
      entry.encryptedPayload = encryptedPayload;
    } else {
      entry.payload = entryPayload.payload;
      if ("result" in entryPayload) {
        entry.result = entryPayload.result;
      }
    }

    let entries = store.get(normalizedClientId);
    if (entries) {
      store.delete(normalizedClientId);
    } else {
      entries = [];
    }
    entries.push(entry);
    if (entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }
    store.set(normalizedClientId, entries);
    enforceClientCapacity();
    const returnValue = {
      command: entry.command,
      payload: clone(normalizedPayload),
      timestamp: entry.timestamp,
    };

    if (normalizedResult !== undefined) {
      returnValue.result = clone(normalizedResult);
    }

    return returnValue;
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
    const key = encryptionEnabled
      ? normalizeEncryptionKey(
          deriveKey(normalizedClientId, { operation: "read" }),
        )
      : null;
    return entries
      .map((entry) => {
        if (entry.encryptedPayload && encryptionEnabled) {
          if (!key) {
            return null;
          }
          const decrypted = decryptPayload(entry.encryptedPayload, key);
          if (decrypted === null || decrypted === undefined) {
            return null;
          }
          const returnValue = {
            command: entry.command,
            timestamp: entry.timestamp,
            payload: clone(decrypted.payload ?? {}),
          };

          if (decrypted.result !== undefined) {
            returnValue.result = clone(decrypted.result);
          }

          return returnValue;
        }
        const returnValue = {
          command: entry.command,
          timestamp: entry.timestamp,
          payload: clone(entry.payload ?? {}),
        };

        if (entry.result !== undefined) {
          returnValue.result = clone(entry.result);
        }

        return returnValue;
      })
      .filter(Boolean);
  }

  return { record, getRecent };
}

export function createClientIdentity({
  subject,
  clientIp,
  userAgent,
  sessionId,
  tokenFingerprint,
}) {
  const parts = [];
  if (typeof subject === "string" && subject.trim()) {
    parts.push(subject.trim());
  } else {
    parts.push("guest");
  }

  if (typeof tokenFingerprint === "string" && tokenFingerprint.trim()) {
    parts.push(`token:${tokenFingerprint.trim()}`);
  }

  if (typeof sessionId === "string" && sessionId.trim()) {
    parts.push(`session:${sessionId.trim()}`);
  }

  if (typeof clientIp === "string" && clientIp.trim()) {
    parts.push(`ip:${clientIp.trim()}`);
  }

  if (typeof userAgent === "string" && userAgent.trim()) {
    parts.push(`ua:${userAgent.trim()}`);
  }

  return parts.join("|");
}

