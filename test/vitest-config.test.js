import { describe, expect, it } from 'vitest';

async function loadConfig() {
  return import(new URL('../vitest.config.mjs', import.meta.url));
}

describe('vitest config', () => {
  it('runs in a single thread to avoid RPC timeouts', async () => {
    const { default: config } = await loadConfig();
    expect(config?.test?.pool).toBe('threads');
    const threadOptions = config?.test?.poolOptions?.threads;
    expect(threadOptions).toMatchObject({
      minThreads: 1,
      maxThreads: 1,
      singleThread: true,
    });
  });
});
