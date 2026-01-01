import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { sanitizeOutputString } from "../shared/logging/sanitize-output.js";
import { redactValue } from "../shared/security/redaction.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_OUTBOX = path.join(
  process.env.JOBBOT_DATA_DIR
    ? path.resolve(process.env.JOBBOT_DATA_DIR)
    : path.resolve("data"),
  "alerts",
);
const DEFAULT_PLAYBOOK_URL =
  "https://github.com/jobbot3000/jobbot3000/blob/main/docs/web-operational-playbook.md";

function sanitizeString(value) {
  if (typeof value !== "string") return "";
  return sanitizeOutputString(value.trim());
}

function sanitizeValue(value) {
  if (value == null) return undefined;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => sanitizeValue(entry))
      .filter((entry) => entry !== undefined);
    return entries.length > 0 ? entries : undefined;
  }
  if (typeof value === "object") {
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = sanitizeString(key);
      if (!normalizedKey) continue;
      const normalizedValue = sanitizeValue(entry);
      if (normalizedValue === undefined) continue;
      sanitized[normalizedKey] = normalizedValue;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }
  return undefined;
}

function normalizeEmails(rotation) {
  if (!rotation) return [];
  const source = Array.isArray(rotation) ? rotation : String(rotation).split(",");
  const normalized = [];
  const seen = new Set();
  for (const entry of source) {
    const value = sanitizeString(entry);
    const email = value.toLowerCase();
    if (!email || !EMAIL_RE.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }
  return normalized;
}

function createFileName(email, timestamp) {
  const safeEmail = email.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const suffix = safeEmail || "oncall";
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  return `${safeTimestamp}-${suffix}-${randomUUID()}.eml`;
}

function formatAlertBody(event, { timestamp, playbookUrl }) {
  const lines = ["jobbot-web security alert", `Timestamp: ${timestamp}`];
  if (event.category) lines.push(`Category: ${event.category}`);
  if (event.reason) lines.push(`Reason: ${event.reason}`);
  if (event.command) lines.push(`Command: ${event.command}`);
  if (event.httpStatus) lines.push(`HTTP status: ${event.httpStatus}`);
  if (event.clientIp) lines.push(`Client: ${event.clientIp}`);
  if (event.userAgent) lines.push(`User agent: ${event.userAgent}`);
  if (event.sessionId) lines.push(`Session: ${event.sessionId}`);
  lines.push(`Playbook: ${playbookUrl}`);
  lines.push("");
  lines.push("Details");
  lines.push("-------");
  lines.push(JSON.stringify(event, null, 2));
  lines.push("");
  return lines.join("\n");
}

export function createSecurityAlertDispatcher(options = {}) {
  const rotation = normalizeEmails(options.rotation ?? options.recipients ?? options.onCall);
  if (rotation.length === 0) return null;
  const outbox =
    typeof options.outbox === "string" && options.outbox.trim()
      ? path.resolve(options.outbox.trim())
      : DEFAULT_OUTBOX;
  const now =
    typeof options.now === "function"
      ? () => options.now()
      : () => new Date();
  const playbookUrl =
    typeof options.playbookUrl === "string" && options.playbookUrl.trim()
      ? options.playbookUrl.trim()
      : DEFAULT_PLAYBOOK_URL;
  const logger = options.logger;

  return async function dispatchSecurityAlert(event) {
    const sanitized = sanitizeValue(redactValue(event ?? {})) ?? {};
    const timestamp = now();
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    const subject = sanitized.category
      ? `jobbot web security alert: ${sanitized.category}`
      : "jobbot web security alert";
    const body = formatAlertBody(sanitized, { timestamp: iso, playbookUrl });
    try {
      await fs.mkdir(outbox, { recursive: true });
      await Promise.all(
        rotation.map(async (email) => {
          const fileName = createFileName(email, iso);
          const filePath = path.join(outbox, fileName);
          const content = [
            `To: ${email}`,
            `Subject: ${subject}`,
            "Content-Type: text/plain; charset=utf-8",
            "",
            body,
            "",
          ].join("\n");
          await fs.writeFile(filePath, `${content}\n`, "utf8");
        }),
      );
    } catch (error) {
      logger?.warn?.("Failed to write security alert", error);
    }
  };
}
