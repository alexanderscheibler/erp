import { type Page, type Locator } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * PosPage
 * Covers the Odoo 19 Point of Sale flow:
 *   dashboard → open/resume register → add product → cash payment → receipt.
 *
 * The POS is a separate OWL SPA served from `/pos/ui/<config>/...` (distinct
 * from the `/odoo/...` web client). Locators below were captured live against
 * the running instance and follow the project's role-first hierarchy.
 *
 * Conventions (same as the Inventory POM):
 * - NO `expect` here — assertions live only in the spec. Methods perform
 *   actions and use `locator.waitFor()` for synchronisation; locators the spec
 *   needs to assert on are exposed as getters that return a `Locator`.
 * - No `waitForTimeout`/sleep and no fixed short timeouts: session state is read
 *   from the dashboard card so synchronisation stays on concrete conditions.
 */
export class PosPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // --- Locators the spec asserts on (no assertions performed here) ----------

  /**
   * The order line for `productName` in the current order panel (and, after
   * checkout, on the receipt). Odoo renders each line as a `listitem`; we scope
   * by the product text rather than position so the assertion is order- and
   * index-independent.
   */
  orderLine(productName: string): Locator {
    return this.page.getByRole("listitem").filter({ hasText: productName });
  }

  /** The "Payment Successful" banner shown only on the receipt screen. */
  get paymentSuccessfulBanner(): Locator {
    return this.page.getByText("Payment Successful");
  }

  /** The receipt screen's "New Order" button (present only post-validation). */
  get newOrderButton(): Locator {
    return this.page.getByRole("button", { name: "New Order" });
  }

  /**
   * The "Receipt sent successfully" confirmation shown after emailing a receipt.
   * (Rendered as a `.text-success` element; we match on its text per the
   * role-first hierarchy.)
   */
  get receiptSentBanner(): Locator {
    return this.page.getByText("Receipt sent successfully");
  }

  // --- Actions --------------------------------------------------------------

  /** Open the POS dashboard (the kanban of registers) in the web client. */
  async openDashboard(): Promise<void> {
    await this.page.goto("/odoo/point-of-sale");
  }

  /**
   * Open or resume the register for `shopName`, then land on the product screen.
   *
   * The card's button tells us the session state deterministically:
   *   - "Open Register"   → the register is CLOSED; opening it ALWAYS raises the
   *     Opening Control popup (set the opening cash float), which we must clear.
   *   - "Continue Selling" → the register is already OPEN; no popup appears.
   *
   * We branch on that label rather than probing for the popup with a short
   * bounded wait. The popup renders a moment AFTER the product grid, so a race
   * (probe → not yet there → proceed → popup appears → covers the grid) was
   * leaving a modal intercepting the first product click. Because a fresh open
   * GUARANTEES the popup, we wait for it unconditionally and confirm it, with no
   * fixed short timeout (first POS boot is slow under parallel workers).
   */
  async openRegister(shopName: string): Promise<void> {
    // `name: shopName` is a (case-insensitive) substring match against the
    // card's accessible name (e.g. "Bakery Shop Continue Selling …").
    const card = this.page.getByRole("link", { name: shopName });
    const openButton = card.getByRole("button", { name: "Open Register" });
    const resumeButton = card.getByRole("button", { name: "Continue Selling" });

    // Wait for whichever button this card exposes, then read the state from it.
    await openButton.or(resumeButton).first().waitFor({ state: "visible" });
    const wasClosed = await openButton.isVisible();
    await (wasClosed ? openButton : resumeButton).click();

    if (wasClosed) {
      // Opening Control is guaranteed on a fresh open: wait for it, confirm the
      // opening float, and wait for it to fully close before touching the grid.
      const opening = this.page.getByRole("dialog").filter({ hasText: "Opening Control" });
      await opening.waitFor({ state: "visible" });
      await opening.getByRole("button", { name: "Open Register" }).click();
      await opening.waitFor({ state: "hidden" });
    }

    // Product screen is ready once its search box is rendered.
    await this.searchBox.waitFor({ state: "visible" });
  }

  /**
   * Add `productName` to the current order, optionally setting its quantity.
   *
   * We type into the product search first so the grid is filtered to the target
   * tile (robust against pagination/scrolling), then click the tile. Adding a
   * product auto-selects its order line, so the numpad acts on it directly.
   */
  async addProductToOrder(productName: string, quantity = 1): Promise<void> {
    await this.searchBox.fill(productName);
    await this.page.getByRole("button", { name: productName }).first().click();
    await this.searchBox.fill(""); // reset the filter for any subsequent adds

    if (quantity !== 1) await this.setQuantity(quantity);
  }

  /**
   * Overwrite the selected order line's quantity via the numpad.
   *
   * Clicking "Qty" puts the numpad in quantity mode and arms it to overwrite on
   * the next digit, so typing the digits replaces (not appends to) the value.
   */
  private async setQuantity(quantity: number): Promise<void> {
    await this.page.getByRole("button", { name: "Qty" }).click();
    for (const digit of String(quantity)) {
      await this.page.getByRole("button", { name: digit, exact: true }).click();
    }
  }

  /** Move from the product screen to the payment screen. */
  async proceedToPayment(): Promise<void> {
    await this.page.getByRole("button", { name: "Payment" }).click();
  }

  /**
   * Pay the full amount in cash and validate.
   *
   * Selecting "Cash" auto-tenders the exact amount due, which enables Validate;
   * the click auto-waits for it to become actionable.
   */
  async payWithCashAndValidate(): Promise<void> {
    await this.page.getByRole("button", { name: "Cash", exact: true }).click();
    await this.page.getByRole("button", { name: "Validate" }).click();
  }

  /**
   * Email the current receipt to `address` from the receipt screen.
   *
   * Locator note: Odoo's POS "send" control is an icon-only button (a bare
   * FontAwesome paper-plane) with NO accessible name, label, title, or test id,
   * so it cannot be resolved through the role-first hierarchy. We therefore
   * scope a `button` by the only stable semantic hook it exposes — its
   * paper-plane icon. This is a deliberate, documented exception (the same
   * spirit as the bounded-wait exception); the proper long-term fix is an
   * upstream `aria-label`/`data-testid` on the button, which QA should file.
   */
  async emailReceipt(address: string): Promise<void> {
    await this.page.getByPlaceholder("e.g. john.doe@mail.com").fill(address);
    await this.page
      .getByRole("button")
      .filter({ has: this.page.locator(".fa-paper-plane") })
      .click();
  }

  /** Return to a clean product screen from the receipt for the next order. */
  async startNewOrder(): Promise<void> {
    await this.newOrderButton.click();
    await this.searchBox.waitFor({ state: "visible" });
  }

  /** The product-screen search box (also the readiness signal for that screen). */
  private get searchBox(): Locator {
    return this.page.getByRole("textbox", { name: "Search products..." });
  }
}
