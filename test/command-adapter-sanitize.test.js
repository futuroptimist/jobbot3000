import { describe, expect, it } from 'vitest';

import { sanitizeOutputValue } from '../src/web/command-adapter.js';

describe('sanitizeOutputValue', () => {
  it('redacts secret-like strings when the key is not obviously sensitive', () => {
    const secretValue = 'aSecretTokenValue1Z';
    const result = sanitizeOutputValue({ REQUIRED_ONEPASSWORD_ENV: secretValue });

    expect(result).toEqual({ REQUIRED_ONEPASSWORD_ENV: '***' });
  });

  it('leaves non-secret configuration values intact', () => {
    const value = 'development';
    const result = sanitizeOutputValue({ ENVIRONMENT: value });

    expect(result).toEqual({ ENVIRONMENT: 'development' });
  });

  it('handles objects with circular references safely', () => {
    const payload = { level: 'info' };
    payload.self = payload;

    const result = sanitizeOutputValue(payload);

    expect(result).toEqual({ level: 'info', self: '[Circular]' });
  });
});
