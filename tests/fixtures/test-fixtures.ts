import { test as base, type BrowserContext } from "@playwright/test";
import { InventoryPage } from "../pages/InventoryPage";
import { PosPage } from "../pages/PosPage";
import { PostgrestClient } from "@utils/db";
import * as path from "path";

const STORAGE_STATE_PATH = path.join(__dirname, "../../test-results/.auth/user.json");

type ErpFixtures = {
  authenticatedContext: BrowserContext;
  inventoryPage: InventoryPage;
  posPage: PosPage;
  /**
   * Read-only PostgREST client for verifying the source-of-truth database
   * independently of the UI. Config comes from env (POSTGREST_URL, default
   * http://localhost:3000); see utils/db/README.md.
   */
  db: PostgrestClient;
};

/**
 * Extended test fixture that provides:
 * - An authenticated browser context (session from global-setup)
 * - Pre-instantiated Page Object Models
 * - A PostgREST DB client for source-of-truth verification
 */
export const test = base.extend<ErpFixtures>({
  // Stateless and cheap; one instance per test is fine. Playwright requires the
  // first fixture argument to be an object-destructuring pattern, so the empty
  // `{}` is mandatory here (this fixture depends on no other fixtures); the
  // eslint-disable silences `no-empty-pattern` for that required pattern.
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    await use(new PostgrestClient());
  },

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
