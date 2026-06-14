import { type Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

export interface ReceiptLine {
  /** Exact variant label to select from the dropdown, e.g. "Acoustic Bloc Screens (White)". */
  product: string;
  /**
   * Optional shorter query to type into the search box. Odoo's name_search
   * does not match the full variant label (the "(White)" suffix), so type a
   * base term that returns results, then `product` picks the right variant.
   * Defaults to `product` when omitted.
   */
  search?: string;
  quantity: number;
}

/**
 * InventoryPage
 * Covers the Inventory app: Receipts (incoming shipments from vendor).
 *
 * Flow: Inventory → Operations → Receipts → New → fill lines → Validate
 */
export class InventoryPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** The product-lines one2many container on the receipt form. */
  private get linesContainer() {
    return this.page.locator('[name="move_ids"]');
  }

  /** The row currently being edited inside the lines table. */
  private get activeLineRow() {
    return this.linesContainer.locator("tr.o_selected_row");
  }

  /** The receipt reference (WH/IN/xxxxx) rendered in the form heading. */
  private get referenceField() {
    return this.page.locator('.o_form_sheet h1 [name="name"]');
  }

  async open(): Promise<void> {
    // Odoo 19 exposes deterministic slug routes; /odoo/inventory lands on the
    // Inventory Overview without depending on the Home Menu dropdown layout.
    // No manual idle wait: callers assert on the resulting page and Playwright
    // auto-waits. (networkidle is unreliable against Odoo's persistent bus.)
    await this.page.goto("/odoo/inventory");
  }

  async goToReceipts(): Promise<void> {
    // Odoo 19: Receipts lives directly under "Operations" — the intermediate
    // "Transfers" submenu from Odoo 17 no longer exists.
    await this.page.getByRole("button", { name: "Operations" }).click();
    await this.page.getByRole("menuitem", { name: "Receipts" }).click();
  }

  /**
   * Create a new receipt for lines of { product, quantity }.
   * Returns the receipt reference (e.g. "WH/IN/00001").
   */
  async createReceipt(lines: ReceiptLine[]): Promise<string> {
    await this.page.getByRole("button", { name: "New" }).click();

    for (const line of lines) {
      // Odoo 19 has no auto-empty editable row: a fresh product row only
      // appears after clicking "Add a Product" (renamed from "Add a line").
      await this.page.getByRole("button", { name: "Add a Product" }).click();

      // Adding a row commits the previous (still-edited) line, and that async
      // re-render can tear down THIS row's freshly-opened autocomplete before
      // we click the option — so the 2nd+ line's search would never resolve.
      //
      // Treat "type the search term + pick the exact variant" as one atomic,
      // self-correcting unit: expect.toPass re-runs it (web-first auto-retry,
      // not a fixed sleep) so a mid-flight re-render simply triggers a re-fill.
      //
      // We type the shorter search term because Odoo's name_search does not
      // match the full "(White)" variant label, then select by exact name.
      // "Search a product" is unique to the one empty line being edited.
      await expect(async () => {
        await this.page
          .getByPlaceholder("Search a product")
          .fill(line.search ?? line.product);

        await this.page
          .getByRole("option", { name: line.product })
          .first()
          .click({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });

      // Demand qty: Odoo field `name` attributes are stable, semantic anchors
      // (not dynamic ids/classes), so they are the canonical way to reach the
      // editable cell inside the lines table. There is no role/label on it.
      await this.activeLineRow
        .locator('[name="product_uom_qty"] input')
        .fill(String(line.quantity));
    }

    // Save is icon-only; its accessible name is "Save manually".
    await this.page.getByRole("button", { name: "Save manually" }).click();

    // The heading shows "New Receipt" until the server assigns the sequence,
    // so assert (auto-retry) on the WH/IN pattern before reading the value.
    await expect(this.referenceField).toHaveText(/WH\/IN\/\d+/);
    return (await this.referenceField.innerText()).trim();
  }

  /**
   * Validate the currently open receipt.
   * A confirmation dialog (backorder / immediate transfer) is conditional, so
   * we confirm it only when it is present.
   */
  async validateReceipt(): Promise<void> {
    await this.page.getByRole("button", { name: "Validate" }).click();

    // Conditional dialog — Playwright cannot auto-wait on "maybe appears", so
    // we probe current visibility and confirm only if Odoo raised one.
    const confirmButton = this.page
      .getByRole("dialog")
      .getByRole("button", { name: /Validate|Apply|Create Backorder|Confirm/ });
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }
  }

  /**
   * Navigate to Internal Transfers to initiate a store replenishment.
   */
  async goToInternalTransfers(): Promise<void> {
    await this.page.locator(".o_menu_sections").getByRole("menuitem", { name: "Operations" }).click();
    await this.page.getByRole("menuitem", { name: "Transfers" }).click();
    await this.waitForIdle();

    await this.page.getByRole("link", { name: "Internal Transfers" }).first().click();
    await this.waitForIdle();
  }

  /**
   * Create an internal transfer from one location to another.
   * Returns the transfer reference.
   */
  async createInternalTransfer(
    fromLocation: string,
    toLocation: string,
    lines: ReceiptLine[]
  ): Promise<string> {
    await this.clickNew();
    await this.waitForIdle();

    // Set source and destination locations
    await this.fillMany2One("location_id", fromLocation);
    await this.fillMany2One("location_dest_id", toLocation);

    // Add product lines
    for (const line of lines) {
      const productInput = this.page
        .locator(".o_field_one2many[name='move_ids_without_package'] .o_field_widget[name='product_id'] input")
        .last();
      await productInput.fill(line.product);

      await this.page
        .locator(".dropdown-menu .o_m2o_dropdown_option:not(.o_m2o_dropdown_option_search_create)")
        .first()
        .click();

      await this.waitForIdle();

      const qtyField = this.page
        .locator(".o_field_one2many[name='move_ids_without_package'] .o_field_widget[name='product_uom_qty'] input")
        .last();
      await qtyField.fill(String(line.quantity));

      if (lines.indexOf(line) < lines.length - 1) {
        await this.page.getByRole("button", { name: "Add a line" }).click();
        await this.waitForIdle();
      }
    }

    await this.save();

    const ref = await this.page
      .locator(".o_field_widget[name='name'] span, .o_field_char[name='name']")
      .first()
      .innerText();

    return ref.trim();
  }

  async validateTransfer(): Promise<void> {
    await this.page.getByRole("button", { name: "Validate" }).click();

    const dialog = this.page.locator(".modal-dialog", { hasText: "Immediate Transfer" });
    if (await dialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await dialog.getByRole("button", { name: "Validate" }).click();
    }

    await this.waitForIdle();

    await expect(
      this.page.locator(".o_statusbar_status button.active, .o_status_label"),
      "Transfer should be in Done state"
    ).toContainText("Done");
  }
}
