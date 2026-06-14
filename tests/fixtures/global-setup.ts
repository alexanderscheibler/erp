import { chromium, type FullConfig, expect } from "@playwright/test";
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
  const baseURL = config.projects[0]?.use?.baseURL || process.env.BASE_URL || "http://localhost:8069";

  const context = await browser.newContext({
    baseURL: baseURL,
  });
  const page = await context.newPage();

  // 1. Log in using your existing POM
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(
    process.env.ODOO_USER ?? "admin",
    process.env.ODOO_PASSWORD ?? "admin"
  );
  console.log("✅ Authenticated as admin.");

  // 2. Provision Odoo Environment Settings (Enable Internal Transfers)
  console.log("⚙️ Provisioning ERP Settings (Multi-Locations)...");

  await page.goto(`${baseURL}/odoo/action-stock.action_stock_config_settings`);
  await page.waitForLoadState('networkidle');

  const storageLocationsBox = page.locator('.o_setting_box', { hasText: 'Storage Locations' });
  const storageCheckbox = storageLocationsBox.locator('input[type="checkbox"]');

  const multiStepRoutesBox = page.locator('.o_setting_box', { hasText: 'Multi-Step Routes' });
  const routesCheckbox = multiStepRoutesBox.locator('input[type="checkbox"]');

  let settingsChanged = false;

  if (!(await storageCheckbox.isChecked())) {
    await storageCheckbox.check();
    console.log('   -> Enabled Storage Locations');
    settingsChanged = true;
  }

  if (!(await routesCheckbox.isChecked())) {
    await routesCheckbox.check();
    console.log('   -> Enabled Multi-Step Routes');
    settingsChanged = true;
  }

  // Save if changes were made and wait for the save to complete
  if (settingsChanged) {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.o_form_button_save')).toBeHidden({ timeout: 15000 });
    console.log('✅ Environment configuration saved successfully.');
  } else {
    console.log('✅ Environment already configured. Skipping save.');
  }

  // 3. Save state and close out
  await context.storageState({ path: STORAGE_STATE_PATH });
  await browser.close();

  console.log("✅ Global setup: authenticated session saved.");
}