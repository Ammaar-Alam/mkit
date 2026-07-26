import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  testDir: "./tests/browser",
  ...(process.env.CI ? { workers: 1 } : {}),
  use: {
    colorScheme: "light",
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/fixtures/server.mjs",
    port: 4173,
    reuseExistingServer: true,
  },
});
