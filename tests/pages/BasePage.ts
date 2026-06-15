import { type Page } from "@playwright/test";

/**
 * BasePage
 * Shared helpers for the Odoo 19 web client.
 *
 * No generic "wait for idle" helper: Playwright actions auto-wait for
 * actionability and web-first assertions auto-retry, so callers assert on the
 * concrete outcome they need (a URL, a status, a heading). (A blanket
 * networkidle wait is both an anti-pattern and unreliable against Odoo's
 * persistent long-poll bus, which never goes idle.)
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Open a named application via the Odoo Home Menu.
   *
   * Apps live behind the navbar "Home Menu" launcher, so we open it first, then
   * click the app's menu item (its accessible name is the app label). Going
   * straight to a `getByRole("menuitem")` without opening the launcher is why
   * this used to time out.
   */
  async openApp(appName: string): Promise<void> {
    await this.page.goto("/odoo");
    await this.page.getByRole("button", { name: "Home Menu" }).click();
    await this.page.getByRole("menuitem", { name: appName, exact: true }).click();
  }
}
