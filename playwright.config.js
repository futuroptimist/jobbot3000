import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/playwright',
  timeout: 60000,
  use: {
    headless: true,
    browserName: 'chromium',
  },
  reporter: [['list']],
});
