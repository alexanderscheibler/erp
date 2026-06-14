import { test, expect } from "../fixtures/test-fixtures";

/**
 * Spec 02: Transfer to Store
 *
 * Business flow: Stock received in WH/Stock needs to be moved to the
 * retail shop's shelf location so it becomes available for POS sales.
 *
 * Mirrors ANBL: central warehouse → retail store replenishment.
 *
 * Odoo 17 demo data locations:
 *   Source : WH/Stock          (the main warehouse stock location)
 *   Dest   : PoS Location      (the virtual location used by the POS)
 *
 * Note: The exact destination location name depends on the POS config
 * created by demo data. "PoS Location" is the standard demo name.
 * If your instance uses a different name, update DEST_LOCATION below.
 */

const SOURCE_LOCATION = "WH/Stock";
const DEST_LOCATION = "PoS Location";
const PRODUCT = "Acoustic Bloc Screens";
const TRANSFER_QTY = 5;

test.describe("Transfer Stock from Warehouse to Store", () => {
  test.describe.configure({ mode: "serial" });

  test("TC-02 | Create and validate an internal transfer to the POS location", async ({
    inventoryPage,
  }) => {
    await test.step("Open the Inventory app", async () => {
      await inventoryPage.open();
    });

    await test.step("Navigate to Internal Transfers", async () => {
      await inventoryPage.goToInternalTransfers();
    });

    await test.step("Create an internal transfer", async () => {
      const ref = await inventoryPage.createInternalTransfer(
        SOURCE_LOCATION,
        DEST_LOCATION,
        [{ product: PRODUCT, quantity: TRANSFER_QTY }]
      );

      expect(ref, "Transfer reference should be assigned").toMatch(/WH\/INT\/\d+/);
      console.log(`Created internal transfer: ${ref}`);
    });

    await test.step("Validate the transfer", async () => {
      await inventoryPage.validateTransfer();
    });

    await test.step("Assert transfer is in Done state", async () => {
      await expect(
        inventoryPage.page.locator(".o_statusbar_status button.active"),
        "Status bar should show 'Done'"
      ).toContainText("Done");
    });
  });
});
