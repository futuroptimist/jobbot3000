const SECRET_KEYS = [
  "api[-_]?key",
  "api[-_]?token",
  "auth[-_]?token",
  "authorization",
  "client[-_]?secret",
  "client[-_]?token",
  "secret",
  "token",
  "password",
  "passphrase",
];

const SECRET_KEY_VALUE_PATTERN = String.raw`(?:["']?)(?:${SECRET_KEYS.join(
  "|",
)})(?:["']?)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^,;\s\r\n)\]"'}]+))`;
const SECRET_KEY_VALUE_RE = new RegExp(SECRET_KEY_VALUE_PATTERN, "gi");
const SECRET_BEARER_RE = /\bBearer\s+([A-Za-z0-9._\-+/=]{8,})/gi;
const SECRET_KEY_FIELD_RE = new RegExp(`(?:${SECRET_KEYS.join("|")})`, "i");
const SECRET_KEY_FIELD_SAFE_OVERRIDES = new Set(["tokenStatus", "hasToken"]);
// eslint-disable-next-line no-control-regex -- intentionally strip ASCII control characters.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions?/gi,
  /disregard\s+all\s+prior\s+instructions?/gi,
  /\b(system|developer)\s+prompt\b/gi,
  /\breset\s+the\s+system\b/gi,
  /<<\s*sys\s*>>/gi,
  /\[\/?inst]/gi,
];
const PROMPT_INJECTION_PLACEHOLDER = "[prompt injection removed]";

function scrubPromptInjection(value) {
  if (typeof value !== "string" || !value) return value;
  let sanitized = value;
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, PROMPT_INJECTION_PLACEHOLDER);
  }
  return sanitized;
}

function replaceSecret(match, doubleQuoted, singleQuoted, bareValue) {
  if (doubleQuoted) {
    return match.replace(doubleQuoted, "***");
  }
  if (singleQuoted) {
    return match.replace(singleQuoted, "***");
  }
  if (bareValue) {
    return match.replace(bareValue, "***");
  }
  return match;
}

function redactSecrets(value) {
  if (typeof value !== "string" || !value) return value;
  let redacted = value;
  redacted = redacted.replace(SECRET_KEY_VALUE_RE, replaceSecret);
  redacted = redacted.replace(SECRET_BEARER_RE, (match, token) =>
    match.replace(token, "***"),
  );
  return redacted;
}

function sanitizeOutputString(value) {
  if (typeof value !== "string") return value;
  const withoutControlChars = value.replace(CONTROL_CHARS_RE, "");
  const redacted = redactSecrets(withoutControlChars);
  return scrubPromptInjection(redacted);
}

function sanitizeOutputValue(value, options = {}) {
  const { key } = options;
  const keyString = key != null ? String(key) : undefined;
  if (keyString === "hasToken") {
    return value === true;
  }
  if (keyString && SECRET_KEY_FIELD_SAFE_OVERRIDES.has(keyString)) {
    // Fall through to sanitize nested structures without redacting them entirely.
  } else if (keyString && SECRET_KEY_FIELD_RE.test(keyString)) {
    return "***";
  }
  if (typeof value === "string") {
    return sanitizeOutputString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeOutputValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sanitized = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeOutputValue(entryValue, { key: entryKey });
  }
  return sanitized;
}

export { sanitizeOutputString, sanitizeOutputValue, redactSecrets };
