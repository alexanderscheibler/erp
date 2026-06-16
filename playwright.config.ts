import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from "dotenv";
import path from "path";
dotenv.config({
  quiet: true,
  path: path.resolve(__dirname, ".env"),
});

const BASE_URL = process.env.ODOO_BASE_URL ?? "http://localhost:8069";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['blob'],
    ["list"],
    [
      "html",
      {
        outputFolder: "playwright-report",
        open: process.env.CI ? "never" : "on-failure",
      },
    ],
    /* JUnit output for Azure DevOps "Publish Test Results" task */
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: BASE_URL,

    /* Reuse the authenticated session saved by global-setup.ts */
    storageState: "test-results/.auth/user.json",

    /* Keep screenshots + video only on failure to keep artifacts small */
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",

    /* Odoo's SPA can be slow, especially on first load after module install */
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    //
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
  /* Global setup seeds the Odoo session so tests don't repeat login */
  globalSetup: "./tests/fixtures/global-setup.ts",
});
