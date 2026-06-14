import { type Page, type Locator } from "@playwright/test";

/**
 * BasePage
 * Shared helpers for Odoo 17's web client conventions:
 * - Menu navigation via the top navbar
 * - Breadcrumb assertions
 * - Save / Discard form actions
 * - Generic "wait for page to be idle" (Odoo fires many XHR calls)
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Click the main app switcher and open a named application. */
  async openApp(appName: string): Promise<void> {
    await this.page.goto("/odoo");
    await this.page
      .locator(".o_app", { hasText: appName })
      .first()
      .click();
    await this.waitForIdle();
  }

  /** Navigate a top-level menu + optional submenu item. */
  async navigateTo(menu: string, submenu?: string): Promise<void> {
    const menuOptions = this.page.getByTitle('Home Menu');
    await menuOptions.click();

    const menuBar = this.page.locator(".o_menu_sections");
    await menuBar.getByRole("menuitem", { name: menu }).click();

    if (submenu) {
      await this.page
        .locator(".o_menu_sections .dropdown-menu", { hasText: submenu })
        .getByRole("menuitem", { name: submenu })
        .click();
    }

    await this.waitForIdle();
  }

  // ── Form actions ──────────────────────────────────────────────────────────

  /** Click the "New" button (renamed from "Create" in Odoo 17). */
  async clickNew(): Promise<void> {
    await this.page.getByRole("button", { name: "New" }).click();
    await this.waitForIdle();
  }

  async save(): Promise<void> {
    await this.page
      .locator(".o_form_button_save, button[name='save_manually']")
      .first()
      .click();
    await this.waitForIdle();
  }

  async discard(): Promise<void> {
    await this.page
      .locator(".o_form_button_cancel")
      .first()
      .click();
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  /** Click a status-bar button by label (e.g. "Confirm", "Validate"). */
  async clickStatusButton(label: string): Promise<void> {
    await this.page
      .locator(".o_statusbar_buttons button", { hasText: label })
      .click();
    await this.waitForIdle();
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /**
   * Wait for the Odoo loading overlay to disappear and the network to be idle.
   * Odoo 17 uses .o_loading_indicator during XHR calls.
   */
  async waitForIdle(): Promise<void> {
    // Wait for any Odoo blocking spinner to vanish
    await this.page
      .locator(".o_loading_indicator")
      .waitFor({ state: "hidden", timeout: 30_000 })
      .catch(() => {
        /* spinner may never appear for fast ops — that's fine */
      });

    await this.page.waitForLoadState("networkidle", { timeout: 30_000 });
  }

  /** Fill an Odoo many2one field (autocomplete widget). */
  async fillMany2One(fieldName: string, value: string): Promise<void> {
    const field = this.page
      .locator(`.o_field_widget[name="${fieldName}"] input`)
      .first();
    await field.fill(value);
    await this.page
      .locator(`.o_field_widget[name="${fieldName}"] .o_m2o_dropdown_option_search_create, .ui-menu-item`)
      .first()
      .waitFor({ timeout: 10_000 });
    // Pick the first matching option
    await this.page
      .locator(`.dropdown-menu .o_m2o_dropdown_option:not(.o_m2o_dropdown_option_search_create)`)
      .first()
      .click();
    await this.waitForIdle();
  }

  /** Return the current form's status bar state label. */
  statusBadge(): Locator {
    return this.page.locator(".o_statusbar_status .o_status_label, .o_field_status_bar .btn.active");
  }
}
