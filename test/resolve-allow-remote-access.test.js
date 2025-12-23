import { describe, expect, it } from 'vitest';

import { resolveAllowRemoteAccess } from '../src/web/resolve-allow-remote-access.js';

describe('resolveAllowRemoteAccess', () => {
  it('returns true when the enable flag is present', () => {
    expect(resolveAllowRemoteAccess({ args: ['--allow-remote-access'] })).toBe(true);
  });

  it('returns false when the deny flag is present', () => {
    expect(resolveAllowRemoteAccess({ args: ['--deny-remote-access'] })).toBe(false);
  });

  it('throws when both allow and deny flags are provided', () => {
    expect(() =>
      resolveAllowRemoteAccess({ args: ['--allow-remote-access', '--deny-remote-access'] }),
    ).toThrow('Provide only one of --allow-remote-access or --deny-remote-access');
  });

  it('prefers CLI flags over environment settings', () => {
    const env = { JOBBOT_WEB_ALLOW_REMOTE: '0' };
    expect(resolveAllowRemoteAccess({ args: ['--allow-remote-access'], env })).toBe(true);
  });

  it('treats explicit false CLI values as a deny override', () => {
    const env = { JOBBOT_WEB_ALLOW_REMOTE: '1' };
    expect(
      resolveAllowRemoteAccess({ args: ['--allow-remote-access=false'], env }),
    ).toBe(false);
  });

  it('rejects conflicting allow-remote-access flag values to avoid accidental exposure', () => {
    expect(() =>
      resolveAllowRemoteAccess({
        args: ['--allow-remote-access=true', '--allow-remote-access=false'],
      }),
    ).toThrow(/allow-remote-access/i);
  });

  it('treats empty allow flags as a deny even when the environment enables remote', () => {
    const env = { JOBBOT_WEB_ALLOW_REMOTE: '1' };
    expect(
      resolveAllowRemoteAccess({
        args: ['--allow-remote-access='],
        env,
      }),
    ).toBe(false);
  });

  it('treats invalid = syntax as a deny without consuming the next arg', () => {
    const env = { JOBBOT_WEB_ALLOW_REMOTE: 'yes' };
    expect(
      resolveAllowRemoteAccess({
        args: ['--allow-remote-access=invalid', 'true'],
        env,
      }),
    ).toBe(false);
  });

  it('treats a bare allow flag as truthy even when followed by another option flag', () => {
    const env = { JOBBOT_WEB_ALLOW_REMOTE: '0' };
    expect(
      resolveAllowRemoteAccess({
        args: ['--allow-remote-access', '--host', '0.0.0.0', '--port', '3000'],
        env,
      }),
    ).toBe(true);
  });

  it('parses truthy and falsy environment values when no flags are set', () => {
    expect(resolveAllowRemoteAccess({ env: { JOBBOT_WEB_ALLOW_REMOTE: 'yes' } })).toBe(true);
    expect(resolveAllowRemoteAccess({ env: { JOBBOT_WEB_ALLOW_REMOTE: 'enabled' } })).toBe(true);
    expect(resolveAllowRemoteAccess({ env: { JOBBOT_WEB_ALLOW_REMOTE: 'no' } })).toBe(false);
    expect(resolveAllowRemoteAccess({ env: { JOBBOT_WEB_ALLOW_REMOTE: 'disabled' } })).toBe(false);
  });

  it('returns undefined when no inputs are provided', () => {
    expect(resolveAllowRemoteAccess()).toBeUndefined();
  });
});
