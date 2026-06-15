import { type Page } from "@playwright/test";
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
  /**
   * Stable business key (Odoo internal reference / `default_code`) of the
   * exact product variant — e.g. "E-COM10". Used ONLY for DB verification:
   * the UI selects the product by its `product` label, while the assertions
   * bind each quantity to a specific product via this key (a display label is
   * not a reliable identifier; a default_code is unique and stable).
   */
  defaultCode?: string;
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

  /**
   * Retry a flaky interaction until it succeeds or the timeout elapses.
   *
   * This is interaction resilience, NOT a test assertion (so it lives in the
   * POM and uses no `expect`). It's needed for the editable-list product entry:
   * adding a line commits the previous row, and the resulting async re-render
   * can tear down the just-opened autocomplete, so a single fill+click may need
   * re-running. Each attempt's own action timeouts pace the loop (no sleep).
   */
  private async retryInteraction(
    action: () => Promise<void>,
    timeoutMs = 15_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    for (;;) {
      try {
        await action();
        return;
      } catch (error) {
        lastError = error;
        if (Date.now() >= deadline) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * The Demand-quantity input of the line currently being edited.
   *
   * Role-based, per the locator hierarchy: the lines list is the form's only
   * `table`, and in an Odoo editable list only the row in edit mode renders
   * inputs — its product cell is a `combobox`, so the single `textbox` in the
   * table is always the active row's Demand input. (The cell input itself has
   * no label/placeholder/test id to target more specifically.)
   */
  private get demandInput() {
    return this.page.getByRole("table").getByRole("textbox");
  }

  /**
   * The receipt reference (WH/IN/xxxxx) shown in the form's title heading.
   * The record title renders as an <h1> → role="heading"; we match the
   * reference pattern so we read the persisted reference, not the transient
   * "New" placeholder.
   */
  private get referenceField() {
    return this.page.getByRole("heading", { name: /WH\/IN\/\d+/ });
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
      // Treat "type the search term + pick the exact variant" as one atomic,
      // self-correcting unit (retried on the re-render race).
      //
      // We type the shorter search term because Odoo's name_search does not
      // match the full "(White)" variant label, then select by exact name.
      // "Search a product" is unique to the one empty line being edited.
      await this.retryInteraction(async () => {
        await this.page.getByPlaceholder("Search a product").fill(line.search ?? line.product);

        await this.page
          .getByRole("option", { name: line.product })
          .first()
          .click({ timeout: 2_000 });
      });

      // Demand qty: the editing row's quantity input (see demandInput).
      await this.demandInput.fill(String(line.quantity));
    }

    // Save is icon-only; its accessible name is "Save manually".
    await this.page.getByRole("button", { name: "Save manually" }).click();

    // The title heading shows "New" until the server assigns the sequence; the
    // referenceField locator already matches the WH/IN pattern, so wait for it
    // (a wait, not an assertion) and extract the reference from its text.
    await this.referenceField.waitFor({ state: "visible" });
    return this.extractReference(this.referenceField, /WH\/IN\/\d+/);
  }

  /** Read a reference matching `pattern` from a title-heading locator. */
  private async extractReference(
    heading: ReturnType<Page["getByRole"]>,
    pattern: RegExp,
  ): Promise<string> {
    const text = await heading.innerText();
    const match = text.match(pattern);
    if (!match) {
      throw new Error(`Could not read a ${pattern} reference from heading "${text}"`);
    }
    return match[0];
  }

  /**
   * Validate the currently open receipt.
   * A confirmation dialog (backorder / immediate transfer) is conditional, so
   * we confirm it only when it is present.
   */
  async validateReceipt(): Promise<void> {
    await this.page.getByRole("button", { name: "Validate" }).click();
    await this.confirmOptionalDialog();
  }

  /**
   * Confirm the post-Validate dialog Odoo may raise (backorder / immediate
   * transfer / insufficient quantity) — but only if it appears.
   *
   * The dialog is conditional and renders asynchronously, so an instantaneous
   * visibility probe races it. We instead wait a short, bounded time for it to
   * appear and click through only if it does. This bounded timeout is the
   * documented exception to "no custom timeouts": Playwright cannot auto-wait
   * on an element that may legitimately never exist.
   */
  private async confirmOptionalDialog(): Promise<void> {
    const confirmButton = this.page
      .getByRole("dialog")
      .getByRole("button", { name: /Validate|Apply|Create Backorder|Confirm/ });
    try {
      await confirmButton.waitFor({ state: "visible", timeout: 2_500 });
    } catch {
      return; // no dialog appeared — nothing to confirm
    }
    await confirmButton.click();
  }

  /**
   * The internal-transfer reference (WH/INT/xxxxx) in the form's title heading
   * (role="heading"), matched by pattern to skip the transient "New" title.
   */
  private get transferReferenceField() {
    return this.page.getByRole("heading", { name: /WH\/INT\/\d+/ });
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
   * Select a many2one location field (by its form label, e.g. "Source Location"
   * / "Destination Location") to the exact location path.
   *
   * Location options render their full path (e.g. "WH/Stock/Shelf A"), so we
   * match exactly to avoid "WH/Stock" also matching "WH/Stock/Shelf A".
   *
   * The inline autocomplete list is truncated, so a location may not appear in
   * it — in which case Odoo offers a "Search more..." option that opens a
   * list-view dialog. We handle both paths: click the inline option when it is
   * present, otherwise fall back through "Search more..." → search → pick row.
   */
  private async selectLocation(label: string, value: string): Promise<void> {
    const input = this.page.getByLabel(label, { exact: true });
    await input.click();
    await input.fill(value);

    const exactOption = this.page.getByRole("option", { name: value, exact: true });
    const searchMore = this.page.getByRole("option", { name: "Search more..." });

    // Wait for the dropdown to settle: either the exact match rendered, or only
    // the "Search more..." escape hatch is offered (location not in the list).
    await exactOption.or(searchMore).first().waitFor({ state: "visible" });

    if (await exactOption.isVisible()) {
      await exactOption.click();
      return;
    }

    // Fallback (only when the location is absent from the truncated inline
    // list): open the "Search more..." dialog and pick the location by its
    // EXACT full path, so e.g. "WH/Stock/Shelf 2" never selects
    // "WH/Stock/Shelf 2/Small Refrigerator". The dialog lists the locations by
    // complete name; clicking the matching cell selects the record and closes.
    await searchMore.click();
    const dialog = this.page.getByRole("dialog");
    await dialog.getByRole("cell", { name: value, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  /**
   * Create an internal transfer moving { product, quantity } lines from one
   * location to another. Returns the transfer reference (e.g. "WH/INT/00001").
   *
   * Reuses the receipt-form mechanics (same lines table, same "Add a Product"
   * control, same commit-on-add re-render handled via retryInteraction).
   */
  async createInternalTransfer(
    fromLocation: string,
    toLocation: string,
    lines: ReceiptLine[],
  ): Promise<string> {
    await this.page.getByRole("button", { name: "New" }).click();

    // Source defaults to WH/Stock but we set both explicitly so each test owns
    // its initial state regardless of operation-type defaults.
    await this.selectLocation("Source Location", fromLocation);
    await this.selectLocation("Destination Location", toLocation);

    for (const line of lines) {
      await this.page.getByRole("button", { name: "Add a Product" }).click();

      // Adding a row commits the previous (still-edited) line; that async
      // re-render can tear down this row's autocomplete before we click the
      // option. Treat type+select as one self-correcting unit (retried on the
      // re-render race). We also drop the "Create…" options.
      await this.retryInteraction(async () => {
        await this.page.getByPlaceholder("Search a product").fill(line.search ?? line.product);

        await this.page
          .getByRole("option", { name: line.product })
          .filter({ hasNotText: "Create" })
          .first()
          .click({ timeout: 2_000 });
      });

      // Demand qty — the editing row's quantity input (see demandInput).
      await this.demandInput.fill(String(line.quantity));
    }

    await this.page.getByRole("button", { name: "Save manually" }).click();

    // Title heading shows "New" until the sequence is assigned; wait for it
    // (a wait, not an assertion) and read the value.
    await this.transferReferenceField.waitFor({ state: "visible" });
    return this.extractReference(this.transferReferenceField, /WH\/INT\/\d+/);
  }

  /**
   * Validate the currently open internal transfer.
   * Any confirmation dialog (backorder / immediate transfer) is conditional,
   * so we confirm it only when present. The Done assertion lives in the spec.
   */
  async validateTransfer(): Promise<void> {
    await this.page.getByRole("button", { name: "Validate" }).click();
    await this.confirmOptionalDialog();
  }
}
