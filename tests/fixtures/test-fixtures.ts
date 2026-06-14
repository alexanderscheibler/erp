import { test as base, type BrowserContext } from "@playwright/test";
import { InventoryPage } from "../pages/InventoryPage";
import { PosPage } from "../pages/PosPage";
import * as path from "path";

const STORAGE_STATE_PATH = path.join(__dirname, "../../test-results/.auth/user.json");

type GalileoFixtures = {
  authenticatedContext: BrowserContext;
  inventoryPage: InventoryPage;
  posPage: PosPage;
};

/**
 * Extended test fixture that provides:
 * - An authenticated browser context (session from global-setup)
 * - Pre-instantiated Page Object Models
 */
export const test = base.extend<GalileoFixtures>({
  authenticatedContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
    });
    await use(context);
    await context.close();
  },

  inventoryPage: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    await use(new InventoryPage(page));
    await page.close();
  },

  posPage: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    await use(new PosPage(page));
    await page.close();
  },
});

export { expect } from "@playwright/test";
