// TESTING (2026-07): Playwright configuration for e2e tests, based on the
// @grafana/create-plugin scaffold. The tests run against an already-running
// Grafana instance (NO Docker required) - see refactor_notes.md for how to
// start one locally on macOS. Point GRAFANA_URL elsewhere to override.
import { dirname } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import type { PluginOptions } from '@grafana/plugin-e2e';

// @grafana/plugin-e2e ships a ready-made "auth" test that logs into Grafana
// (default admin/admin) and stores the session for the real tests.
const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

export default defineConfig<PluginOptions>({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'auth',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
    },
    {
      name: 'run-tests',
      use: {
        ...devices['Desktop Chrome'],
        // Large viewport so the edit-mode panel is tall enough for the chord
        // diagram, which refuses to render below a 180px radius.
        viewport: { width: 1920, height: 1080 },
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['auth'],
    },
  ],
});
