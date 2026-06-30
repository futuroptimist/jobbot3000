import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'test/playwright/**'],
    testTimeout: 30000,
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1,
        singleThread: true,
      },
    },
  },
});
