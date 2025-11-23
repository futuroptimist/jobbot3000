import { describe, expect, it } from 'vitest';

import { resolveEnableNativeCli } from '../src/web/resolve-native-cli-flag.js';

describe('resolveEnableNativeCli', () => {
  it('defaults to true for development runs when no overrides are provided', () => {
    const result = resolveEnableNativeCli({
      args: ['--env', 'development'],
      env: {},
      configEnv: 'development',
    });

    expect(result).toBe(true);
  });

  it('returns false when the disable flag is supplied', () => {
    const result = resolveEnableNativeCli({
      args: ['--env', 'development', '--disable-native-cli'],
      env: {},
      configEnv: 'development',
    });

    expect(result).toBe(false);
  });

  it('respects explicit enable flags over environment defaults', () => {
    const result = resolveEnableNativeCli({
      args: ['--env', 'production', '--enable-native-cli'],
      env: {},
      configEnv: 'production',
    });

    expect(result).toBe(true);
  });

  it('defers to environment variables when provided', () => {
    const result = resolveEnableNativeCli({
      args: ['--env', 'development'],
      env: { JOBBOT_WEB_ENABLE_NATIVE_CLI: '0' },
      configEnv: 'development',
    });

    expect(result).toBe(false);
  });

  it('leaves production runs disabled by default', () => {
    const result = resolveEnableNativeCli({
      args: ['--env', 'production'],
      env: {},
      configEnv: 'production',
    });

    expect(result).toBeUndefined();
  });

  it('enables native CLI execution when the environment variable is truthy', () => {
    const result = resolveEnableNativeCli({
      args: [],
      env: { JOBBOT_WEB_ENABLE_NATIVE_CLI: 'yes' },
      configEnv: 'production',
    });

    expect(result).toBe(true);
  });
});
