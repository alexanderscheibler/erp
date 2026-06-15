import { chromium, type FullConfig } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import * as fs from "fs";
import * as path from "path";

const STORAGE_STATE_PATH = path.join(__dirname, "../../test-results/.auth/user.json");

/**
 * global-setup.ts
 * Runs once before the entire test suite.
 * Logs in as admin, provisions the required ERP environment settings,
 * and saves the browser storage state so individual specs don't need
 * to re-authenticate.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // Ensure the auth directory exists
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();

  // Safely grab the baseURL from the config
  const baseURL =
    config.projects[0]?.use?.baseURL || process.env.ODOO_BASE_URL || "http://localhost:8069";

  const context = await browser.newContext({
    baseURL: baseURL,
  });
  const page = await context.newPage();

  // 1. Log in using the LoginPage POM
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(process.env.ODOO_USER ?? "admin", process.env.ODOO_PASSWORD ?? "admin");
  console.log("✅ Authenticated as admin.");

  // 2. Save the authenticated state and close out
  await context.storageState({ path: STORAGE_STATE_PATH });
  await browser.close();

  console.log("✅ Global setup: authenticated session saved.");
}
