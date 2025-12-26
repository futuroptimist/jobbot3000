const PHONE_RE = /(\+?\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}/g;
const SECRET_RE = /(api|token|secret|password|key)[\s=:]+([^\s]+)/gi;
const SENSITIVE_KEY_RE = /(token|secret|password|passcode|apiKey|apikey|key)$/i;

const EMAIL_LOCAL_SYMBOLS = new Set(['.', '_', '%', '+', '-']);

function isDigit(charCode) {
  return charCode >= 48 && charCode <= 57;
}

function isUpperAlpha(charCode) {
  return charCode >= 65 && charCode <= 90;
}

function isLowerAlpha(charCode) {
  return charCode >= 97 && charCode <= 122;
}

function isAlphaNumericChar(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return isDigit(code) || isUpperAlpha(code) || isLowerAlpha(code);
}

function isEmailLocalChar(char) {
  if (!char) return false;
  if (EMAIL_LOCAL_SYMBOLS.has(char)) return true;
  return isAlphaNumericChar(char);
}

function isEmailDomainChar(char) {
  if (!char) return false;
  if (char === '.' || char === '-') return true;
  return isAlphaNumericChar(char);
}

function isValidTopLevelDomain(segment) {
  if (segment.length < 2) return false;
  for (const char of segment) {
    const code = char.charCodeAt(0);
    if (!isUpperAlpha(code) && !isLowerAlpha(code)) {
      return false;
    }
  }
  return true;
}

function isValidDomain(domain) {
  if (!domain || !domain.includes('.')) return false;
  const segments = domain.split('.');
  if (segments.some(part => part.length === 0)) return false;
  if (!isValidTopLevelDomain(segments[segments.length - 1])) return false;
  for (const part of segments) {
    for (let i = 0; i < part.length; i += 1) {
      const char = part[i];
      if (!isEmailDomainChar(char)) {
        return false;
      }
      if (char === '-' && (i === 0 || i === part.length - 1)) {
        return false;
      }
    }
  }
  return true;
}

function redactEmails(text) {
  let cursor = 0;
  let result = '';

  while (cursor < text.length) {
    const atIndex = text.indexOf('@', cursor);
    if (atIndex === -1) {
      result += text.slice(cursor);
      break;
    }

    let localStart = atIndex - 1;
    while (localStart >= 0 && isEmailLocalChar(text[localStart])) {
      localStart -= 1;
    }
    localStart += 1;

    if (localStart >= atIndex) {
      result += text.slice(cursor, atIndex + 1);
      cursor = atIndex + 1;
      continue;
    }

    let domainEnd = atIndex + 1;
    while (domainEnd < text.length && isEmailDomainChar(text[domainEnd])) {
      domainEnd += 1;
    }

    if (domainEnd === atIndex + 1) {
      result += text.slice(cursor, atIndex + 1);
      cursor = atIndex + 1;
      continue;
    }

    const localPart = text.slice(localStart, atIndex);
    const domain = text.slice(atIndex + 1, domainEnd);

    if (!isValidDomain(domain)) {
      result += text.slice(cursor, atIndex + 1);
      cursor = atIndex + 1;
      continue;
    }

    const prefixLength = Math.min(2, localPart.length);
    const maskedLocal = `${localPart.slice(0, prefixLength)}***`;
    result += text.slice(cursor, localStart) + `${maskedLocal}@${domain}`;
    cursor = domainEnd;
  }

  return result;
}

function redactString(value) {
  if (value == null) return value;
  let text = String(value);
  text = redactEmails(text);
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

/**
 * @typedef {{ debug?: (message: string, details?: Record<string, unknown>) => void }} LoggerLike
 */

/**
 * @param {{ logger?: LoggerLike }} [options]
 */
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
