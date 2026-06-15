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
    // Role/label locators per the project hierarchy: the login form labels its
    // inputs "Email"/"Password" and the submit button reads "Log in".
    await this.page.getByLabel("Email").fill(username);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Log in" }).click();

    // Wait until we've left the login page
    await this.page.waitForURL("**/odoo**", { timeout: 30_000 });
  }
}
