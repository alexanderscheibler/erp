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

  /** The internal-transfer reference (WH/INT/xxxxx) in the form heading. */
  private get transferReferenceField() {
    return this.page.locator('.o_form_sheet h1 [name="name"]');
  }

  /**
   * Navigate to Internal Transfers (Inventory → Operations → Internal).
   * In Odoo 19 the entry is labelled "Internal" (no "Transfers" submenu) and
   * resolves to /odoo/internal.
   */
  async goToInternalTransfers(): Promise<void> {
    await this.page.getByRole("button", { name: "Operations" }).click();
    await this.page.getByRole("menuitem", { name: "Internal", exact: true }).click();
  }

  /**
   * Select a many2one location field (Source / Destination) by its exact path.
   *
   * Location options render their full path (e.g. "WH/Stock/Shelf A"), so we
   * match exactly to avoid "WH/Stock" also matching "WH/Stock/Shelf A".
   *
   * The inline autocomplete list is truncated, so a location may not appear in
   * it — in which case Odoo offers a "Search more..." option that opens a
   * list-view dialog. We handle both paths: click the inline option when it is
   * present, otherwise fall back through "Search more..." → search → pick row.
   */
  private async selectLocation(fieldName: string, value: string): Promise<void> {
    const leaf = value.split("/").pop() ?? value;
    const input = this.page.locator(`[name="${fieldName}"] input`);
    await input.click();
    await input.fill(value);

    const exactOption = this.page.getByRole("option", { name: value, exact: true });
    const searchMore = this.page.getByRole("option", { name: "Search more..." });

    // Wait for the dropdown to settle: either the exact match rendered, or only
    // the "Search more..." escape hatch is offered (location not in the list).
    await expect(exactOption.or(searchMore).first()).toBeVisible();

    if (await exactOption.isVisible()) {
      await exactOption.click();
      return;
    }

    // Fallback: open the "Search more..." dialog, filter by the location's leaf
    // name, and select the matching row.
    await searchMore.click();
    const dialog = this.page.getByRole("dialog");
    // The dialog's search box has no accessible name; target the searchview
    // input, type the leaf, and confirm the facet with Enter.
    const search = dialog.locator(".o_searchview_input, .o_searchview input").first();
    await search.fill(leaf);
    await search.press("Enter");

    // Single-select: clicking the matching data row selects it and closes.
    await dialog
      .locator("tr.o_data_row")
      .filter({ hasText: leaf })
      .first()
      .click();
    await expect(dialog).toBeHidden();
  }

  /**
   * Create an internal transfer moving { product, quantity } lines from one
   * location to another. Returns the transfer reference (e.g. "WH/INT/00001").
   *
   * Reuses the receipt-form mechanics (same `move_ids` lines table, same
   * "Add a Product" control, same commit-on-add re-render handled via toPass).
   */
  async createInternalTransfer(
    fromLocation: string,
    toLocation: string,
    lines: ReceiptLine[]
  ): Promise<string> {
    await this.page.getByRole("button", { name: "New" }).click();

    // Source defaults to WH/Stock but we set both explicitly so each test owns
    // its initial state regardless of operation-type defaults.
    await this.selectLocation("location_id", fromLocation);
    await this.selectLocation("location_dest_id", toLocation);

    for (const line of lines) {
      await this.page.getByRole("button", { name: "Add a Product" }).click();

      // Adding a row commits the previous (still-edited) line; that async
      // re-render can tear down this row's autocomplete before we click the
      // option. Treat type+select as one self-correcting unit (web-first
      // auto-retry, not a fixed sleep). We also drop the "Create…" options.
      await expect(async () => {
        await this.page
          .getByPlaceholder("Search a product")
          .fill(line.search ?? line.product);

        await this.page
          .getByRole("option", { name: line.product })
          .filter({ hasNotText: "Create" })
          .first()
          .click({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });

      // Demand qty — stable Odoo field name attr (no role/label on the cell).
      await this.activeLineRow
        .locator('[name="product_uom_qty"] input')
        .fill(String(line.quantity));
    }

    await this.page.getByRole("button", { name: "Save manually" }).click();

    // Heading shows "New Transfer" until the sequence is assigned; assert the
    // WH/INT pattern (auto-retry) before reading the reference.
    await expect(this.transferReferenceField).toHaveText(/WH\/INT\/\d+/);
    return (await this.transferReferenceField.innerText()).trim();
  }

  /**
   * Validate the currently open internal transfer.
   * Any confirmation dialog (backorder / immediate transfer) is conditional,
   * so we confirm it only when present. The Done assertion lives in the spec.
   */
  async validateTransfer(): Promise<void> {
    await this.page.getByRole("button", { name: "Validate" }).click();

    const confirmButton = this.page
      .getByRole("dialog")
      .getByRole("button", { name: /Validate|Apply|Create Backorder|Confirm/ });
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }
  }
}
