import { defineConfig, devices } from "@playwright/test";

// The jarvis3 variant's web e2e: a static `APP_VARIANT=jarvis3` web export (dist-jarvis3, built
// beforehand: `npm run build:web:jarvis3`) served by a mock Jarvis 3 instance that relays the
// chat to a real Paseo daemon. No Metro, no shared daemon. See JARVIS3.md.
export default defineConfig({
  testDir: "./e2e-jarvis3",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
