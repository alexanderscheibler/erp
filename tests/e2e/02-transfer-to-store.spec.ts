import { test, expect } from "@fixtures/test-fixtures";
import { transferScenarios } from "../data/transfer-scenarios";

/**
 * Spec 02: Transfer to Store — Happy Path
 *
 * Business flow: stock sitting in the central warehouse (`WH/Stock`) is moved
 * to a retail store shelf via an Internal Transfer, then validated so the move
 * reaches the Done state.
 *
 * Mirrors the ANBL flow: central warehouse → retail store replenishment, the
 * step between "Receive Inventory" (spec 01) and "POS Checkout" (spec 03).
 *
 * Design notes (same conventions as spec 01):
 * - Data-driven: every case in `transferScenarios` becomes its own test.
 * - Fully independent: each test opens the app and creates its own transfer
 *   (own source/destination/lines), so tests run in any order / in parallel.
 * - Locators follow the role-first hierarchy; assertions are native
 *   auto-retrying Playwright matchers only (no raw `assert`, no fixed waits).
 */
test.describe("Transfer Stock from Warehouse to Store — Happy Path", () => {
  for (const scenario of transferScenarios) {
    test(`${scenario.id} | ${scenario.title}`, async ({ inventoryPage }) => {
      const { page } = inventoryPage;

      await test.step("Open the Inventory app", async () => {
        await inventoryPage.open();
        await expect(page).toHaveURL(/\/odoo\/inventory/);
      });

      await test.step("Navigate to Internal Transfers", async () => {
        await inventoryPage.goToInternalTransfers();
        await expect(page).toHaveURL(/\/odoo\/internal/);
        await expect(
          page.getByRole("button", { name: "New" }),
          "Internal Transfers list should expose the New button"
        ).toBeVisible();
      });

      let reference = "";
      await test.step("Create the internal transfer and capture its reference", async () => {
        reference = await inventoryPage.createInternalTransfer(
          scenario.source,
          scenario.destination,
          scenario.lines
        );
        // Sanity: the captured value has the internal-transfer shape.
        expect(reference, "Transfer reference should match WH/INT/<number>").toMatch(
          /WH\/INT\/\d+/
        );

        // The real check: the captured value must identify the record we just
        // saved — not merely match a pattern. The breadcrumb and the browser
        // tab title both render the persisted record's name, independently of
        // the form heading we read it from, so requiring all three to carry the
        // exact same reference confirms we captured THIS transfer's reference.
        const refPattern = new RegExp(reference.replace(/\//g, "\\/"));
        await expect(
          page.locator(".o_breadcrumb"),
          "Breadcrumb should show the created transfer's reference"
        ).toContainText(reference);
        await expect(
          page,
          "Tab title should be the created transfer's reference"
        ).toHaveTitle(refPattern);
      });

      await test.step("Transfer starts in Draft state", async () => {
        await expect(
          page.getByRole("radio", { name: "Draft" }),
          "A freshly saved transfer should be in Draft"
        ).toBeChecked();
      });

      await test.step("Validate the transfer", async () => {
        await inventoryPage.validateTransfer();
      });

      await test.step("Transfer is in Done state", async () => {
        await expect(
          page.getByRole("radio", { name: "Done" }),
          "Transfer should be in Done state after validation"
        ).toBeChecked();

        // Reference is preserved on the validated record (unique in the title).
        await expect(page).toHaveTitle(
          new RegExp(reference.replace(/\//g, "\\/"))
        );
      });
    });
  }
});
