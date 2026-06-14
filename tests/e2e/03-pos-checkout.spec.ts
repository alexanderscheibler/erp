import { test, expect } from "../fixtures/test-fixtures";

/**
 * Spec 03: POS Checkout
 *
 * Business flow: A retail cashier opens a POS session, adds a product
 * that was transferred from the warehouse, collects cash payment,
 * and validates the receipt.
 *
 * Mirrors ANBL: retail store point-of-sale transaction — the final
 * step that proves the end-to-end supply chain is working.
 */

const PRODUCT_TO_SELL = "Acoustic Bloc Screens";

test.describe("POS Checkout — Complete a Retail Sale", () => {
  test.describe.configure({ mode: "serial" });

  test("TC-03 | Open a POS session, sell a product, and validate the receipt", async ({
    posPage,
  }) => {
    await test.step("Open the Point of Sale app", async () => {
      await posPage.openDashboard();
    });

    await test.step("Open (or resume) a POS session", async () => {
      await posPage.openSession();
    });

    await test.step("Add product to the order", async () => {
      await posPage.addProductByName(PRODUCT_TO_SELL);

      // Confirm the order line appeared
      await expect(
        posPage.page.locator(".order-line .product-name, .orderline .product-name"),
        "Order line should contain the product name"
      ).toContainText(PRODUCT_TO_SELL);
    });

    await test.step("Proceed to cash payment", async () => {
      await posPage.checkoutWithCash();
    });

    await test.step("Assert receipt screen is displayed", async () => {
      await posPage.assertReceiptVisible();
    });

    await test.step("Start a new order (clean state for reruns)", async () => {
      await posPage.startNewOrder();
    });
  });
});
