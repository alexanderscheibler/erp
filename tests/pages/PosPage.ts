import { type Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * PosPage
 * Covers the Point of Sale app: open session → add product → checkout.
 *
 * Odoo 17 POS is a full SPA that loads separately from the backend.
 * It does NOT use the standard Odoo web client URL scheme.
 */
export class PosPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** Navigate to the POS dashboard from the backend. */
  async openDashboard(): Promise<void> {
    await this.openApp("Point of Sale");  }

  /**
   * Open (or resume) a POS session.
   * Clicks "Open" on the first POS config card, handles the cash control modal.
   */
  async openSession(): Promise<void> {
    // The POS dashboard shows a card per shop — click Open or New Session
    const openBtn = this.page.getByRole("button", { name: /Open|New Session/i }).first();
    await openBtn.click();

    // Cash control dialog — click "Open" to confirm opening float
    const cashControlModal = this.page.locator(".modal-dialog, .o_dialog", {
      hasText: /Opening Control|Cash Control/i,
    });

    if (await cashControlModal.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await cashControlModal.getByRole("button", { name: /Open/i }).click();
    }

    // Wait for the POS product screen to load
    await this.page.waitForSelector(".pos-content .product-list, .pos-content .productlist", {
      timeout: 30_000,
    });
  }

  /**
   * Add a product to the order by clicking its tile.
   * Uses the search field if the product tile isn't immediately visible.
   */
  async addProductByName(productName: string): Promise<void> {
    // Try clicking the tile directly first
    const tile = this.page.locator(".product-list .product-name, .productlist .product-name", {
      hasText: productName,
    });

    if (await tile.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await tile.click();
    } else {
      // Fall back to search
      const searchInput = this.page.locator(".search-box input, input.search-input");
      await searchInput.fill(productName);
      await this.page.waitForTimeout(500); // debounce
      await this.page
        .locator(".product-list .product-name, .productlist .product-name", {
          hasText: productName,
        })
        .first()
        .click();
      await searchInput.fill(""); // clear search so subsequent adds work
    }
  }

  /** Set the quantity of the currently selected order line. */
  async setQuantity(qty: number): Promise<void> {
    await this.page.locator(".numpad button", { hasText: "Qty" }).click();
    // Clear current value then type new one
    await this.page.locator(".numpad input, .payment-input").fill(String(qty));
  }

  /** Proceed to payment and complete a cash payment for the full amount. */
  async checkoutWithCash(): Promise<void> {
    await this.page.getByRole("button", { name: /Payment/i }).click();
    // Select Cash payment method
    await this.page
      .locator(".payment-method-button, button.paymentmethod", {
        hasText: /Cash/i,
      })
      .click();

    // Confirm the exact amount (Odoo pre-fills the due amount)
    await this.page
      .getByRole("button", { name: /Validate|Send/i })
      .first()
      .click();  }

  /**
   * Assert the receipt screen is shown after a successful payment.
   * The receipt screen is the definitive signal the transaction is complete.
   */
  async assertReceiptVisible(): Promise<void> {
    await expect(
      this.page.locator(".receipt-screen, .pos-receipt-container"),
      "Receipt screen should appear after successful checkout",
    ).toBeVisible({ timeout: 15_000 });
  }

  /** Click "New Order" on the receipt screen to return to the product screen. */
  async startNewOrder(): Promise<void> {
    await this.page.getByRole("button", { name: /New Order/i }).click();  }

  /** Close the POS session from the hamburger/session menu. */
  async closeSession(): Promise<void> {
    await this.page
      .locator(".pos-top-bar .o_menu_toggle, button[aria-label='Close']")
      .first()
      .click();
    await this.page.getByRole("menuitem", { name: /Close/i }).click();

    // Closing control modal
    const closeModal = this.page.locator(".modal-dialog", { hasText: /Closing/i });
    if (await closeModal.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await closeModal.getByRole("button", { name: /Close/i }).click();
    }
  }
}
