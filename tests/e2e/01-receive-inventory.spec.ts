import { test, expect } from "@fixtures/test-fixtures";
import { receiptScenarios } from "../data/receipt-scenarios";

/**
 * Spec 01: Receive Inventory — Happy Path
 *
 * Business flow: a vendor shipment arrives at the warehouse. The operator
 * creates a receipt, fills the demand line(s), saves, and validates so the
 * stock lands in WH/Stock (status → Done).
 *
 * Mirrors the ANBL incoming-shipment flow: goods accepted into the central
 * warehouse before distribution to retail stores.
 *
 * Design notes:
 * - Data-driven: every case in `receiptScenarios` becomes its own test.
 * - Fully independent: each test opens the app and creates its own receipt,
 *   so tests can run in any order / in parallel with no shared state.
 * - Locators follow the role-first hierarchy; assertions are native
 *   auto-retrying Playwright matchers only (no raw `assert`, no fixed waits).
 */
test.describe("Receive Inventory into Warehouse — Happy Path", () => {
  for (const scenario of receiptScenarios) {
    test(`${scenario.id} | ${scenario.title}`, async ({ inventoryPage }) => {
      const { page } = inventoryPage;

      await test.step("Open the Inventory app", async () => {
        await inventoryPage.open();
        // Checkpoint: the Inventory app actually loaded.
        await expect(page).toHaveURL(/\/odoo\/inventory/);
      });

      await test.step("Navigate to Receipts", async () => {
        await inventoryPage.goToReceipts();
        // Checkpoint: the Receipts list is in view.
        await expect(page).toHaveURL(/\/odoo\/receipts/);
        await expect(
          page.getByRole("button", { name: "New" }),
          "Receipts list should expose the New button"
        ).toBeVisible();
      });

      let reference = "";
      await test.step("Create the receipt and capture its reference", async () => {
        reference = await inventoryPage.createReceipt(scenario.lines);
        expect(reference, "Receipt reference should match WH/IN/<number>").toMatch(
          /WH\/IN\/\d+/
        );
      });

      await test.step("Receipt starts in Draft state", async () => {
        // Checkpoint before the state transition: status bar shows Draft.
        await expect(
          page.getByRole("radio", { name: "Draft" }),
          "A freshly saved receipt should be in Draft"
        ).toBeChecked();
      });

      await test.step("Validate the receipt", async () => {
        await inventoryPage.validateReceipt();
      });

      await test.step("Receipt is in Done state", async () => {
        // In Odoo 19 the active status button carries aria-checked="true",
        // which toBeChecked() resolves for role="radio".
        await expect(
          page.getByRole("radio", { name: "Done" }),
          "Receipt should be in Done state after validation"
        ).toBeChecked();

        // And the reference is preserved on the validated record. The browser
        // tab title carries the reference unambiguously (the heading text also
        // appears in the breadcrumb, so we avoid a multi-match on heading).
        await expect(page).toHaveTitle(
          new RegExp(reference.replace(/\//g, "\\/"))
        );
      });
    });
  }
});
