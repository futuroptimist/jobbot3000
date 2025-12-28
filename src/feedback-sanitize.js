import { redactValue } from './shared/security/redaction.js';

// eslint-disable-next-line no-control-regex -- strip ASCII control characters from feedback entries
const FEEDBACK_CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeFeedbackEntries(entries, { redact = true } = {}) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }

      const normalizedEntry = redact ? redactValue(entry) : entry;
      const sanitized = {};

      for (const [key, value] of Object.entries(normalizedEntry)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') {
          const cleaned = value.replace(FEEDBACK_CONTROL_CHARS_RE, '').trim();
          if (!cleaned) continue;
          sanitized[key] = cleaned;
          continue;
        }
        sanitized[key] = value;
      }

      return Object.keys(sanitized).length ? sanitized : null;
    })
    .filter(Boolean);
}

export function sanitizeFeedbackResponse(raw, options) {
  const feedbackEntries = Array.isArray(raw?.feedback) ? raw.feedback : raw ?? [];
  return { feedback: sanitizeFeedbackEntries(feedbackEntries, options) };
}
