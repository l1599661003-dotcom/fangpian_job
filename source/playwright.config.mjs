import { defineConfig } from '/usr/lib/node_modules/playwright/test.mjs';

export default defineConfig({
  testDir: './tests',
  testMatch: ['ui-regression.spec.mjs', 'mobile-journeys.spec.mjs'],
  workers: 1,
  reporter: 'line',
  use: { browserName: 'chromium', headless: true },
  webServer: {
    command: 'node tests/ui-static-server.mjs',
    port: 4178,
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
