import { type Page } from "@playwright/test";

/**
 * LoginPage
 * Handles Odoo's /web/login screen.
 */
export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto("/web/login");
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.locator('input[name="login"]').fill(username);
    await this.page.locator('input[name="password"]').fill(password);
    await this.page.locator('button[type="submit"]').click();

    // Wait until we've left the login page
    await this.page.waitForURL("**/odoo**", { timeout: 30_000 });
  }
}
