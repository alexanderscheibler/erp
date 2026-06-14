import { chromium, type FullConfig } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import * as fs from "fs";
import * as path from "path";

const STORAGE_STATE_PATH = path.join(__dirname, "../../test-results/.auth/user.json");

/**
 * global-setup.ts
 * Runs once before the entire test suite.
 * Logs in as admin and saves the browser storage state so individual
 * specs don't need to re-authenticate (saves ~10s per test).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // Ensure the auth directory exists
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: config.projects[0].use.baseURL,
  });
  const page = await context.newPage();

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(
    process.env.ODOO_USER ?? "admin",
    process.env.ODOO_PASSWORD ?? "admin"
  );

  await context.storageState({ path: STORAGE_STATE_PATH });
  await browser.close();

  console.log("✅ Global setup: authenticated session saved.");
}
