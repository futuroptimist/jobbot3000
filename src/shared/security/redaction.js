const EMAIL_RE = /([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})/gi;
const PHONE_RE = /(\+?\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}/g;
const SECRET_RE = /(api|token|secret|password|key)[\s=:]+([^\s]+)/gi;
const SENSITIVE_KEY_RE = /(token|secret|password|passcode|apiKey|apikey|key)$/i;

function redactString(value) {
  if (value == null) return value;
  let text = String(value);
  text = text.replace(EMAIL_RE, (_, user, domain) => `${user.slice(0, 2)}***@${domain}`);
  text = text.replace(PHONE_RE, match => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 7) return match;
    return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
  });
  text = text.replace(SECRET_RE, (_, label) => `${label}=***redacted***`);
  return text;
}

export function redactValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        if (entry === null || entry === undefined) {
          result[key] = entry;
        } else if (typeof entry === 'object') {
          result[key] = redactValue(entry);
        } else {
          result[key] = '***redacted***';
        }
        continue;
      }
      result[key] = redactValue(entry);
    }
    return result;
  }
  return value;
}

export function createRedactionMiddleware({ logger } = {}) {
  return (req, _res, next) => {
    const body = redactValue(req.body);
    const query = redactValue(req.query);
    const headers = redactValue(req.headers);
    req.redacted = { body, query, headers };
    if (logger && typeof logger.debug === 'function') {
      logger.debug('Incoming request', {
        method: req.method,
        url: req.originalUrl || req.url,
        body,
        query,
      });
    }
    next();
  };
}
