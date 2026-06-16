import { test, expect } from "@fixtures/test-fixtures";
import { posScenarios } from "../data/pos-scenarios";
import type { MailhogMessage } from "@utils/mail";

/**
 * Spec 03: POS Checkout — Happy Path
 *
 * Business flow: a retail cashier opens a POS register, adds a product to the
 * order, takes a full cash payment, validates (reaching the receipt screen),
 * and emails the receipt to the customer. This is the final step proving the
 * end-to-end supply chain works:
 *   Receive (spec 01) → Transfer to store (spec 02) → Sell at POS (spec 03).
 *
 * Coverage runs across BOTH registers (Furniture + Bakery), single + multi-unit
 * orders, and a multi-product order — see `posScenarios`.
 *
 * Design notes (same conventions as specs 01/02):
 * - Data-driven: every case in `posScenarios` becomes its own test.
 * - Self-contained: each test opens/resumes the register and rings up its own
 *   order, then returns to a clean product screen, so tests run in any order.
 * - Locators follow the role-first hierarchy; assertions are native
 *   auto-retrying Playwright matchers only (no raw `assert`, no fixed waits).
 * - The POS POM holds the SPA's locators and performs no assertions; all
 *   `expect`s live here.
 *
 * Email verification (two independent layers):
 * - UI: the receipt screen shows "Receipt sent successfully".
 * - Source of truth: the email is actually captured by the MailHog SMTP sink
 *   (queried over its HTTP API), proving Odoo really sent it — not just that
 *   the UI claimed success. A UNIQUE recipient per test keeps the MailHog
 *   assertion isolated across tests/workers.
 *
 * No stock/DB verification this round (per the latest instruction): the receipt
 * screen and the captured email are the signals that the sale committed.
 */

/** A fresh, unique recipient per test so MailHog lookups never collide. */
const uniqueRecipient = (scenarioId: string): string =>
  `pos-${scenarioId.toLowerCase()}-${Date.now()}@example.com`;

test.describe("POS Checkout — Complete a Retail Sale", () => {
  for (const scenario of posScenarios) {
    test(`${scenario.id} | ${scenario.title}`, async ({ posPage, mailhog }) => {
      const recipient = uniqueRecipient(scenario.id);

      await test.step("Open the Point of Sale dashboard", async () => {
        await posPage.openDashboard();
        await expect(posPage.page).toHaveURL(/\/odoo\/point-of-sale/);
      });

      await test.step(`Open (or resume) the ${scenario.shop} register`, async () => {
        await posPage.openRegister(scenario.shop);
        // Checkpoint: we are on the POS product screen (separate SPA route).
        await expect(posPage.page).toHaveURL(/\/pos\/ui\/\d+\/product\//);
      });

      await test.step("Add the order lines", async () => {
        for (const line of scenario.lines) {
          await posPage.addProductToOrder(line.product, line.quantity);
          // Each order line shows its product and the exact quantity rung up.
          const orderLine = posPage.orderLine(line.product);
          await expect(orderLine, `order line should show ${line.product}`).toBeVisible();
          await expect(
            orderLine,
            `order line for ${line.product} should reflect quantity ${line.quantity}`,
          ).toContainText(String(line.quantity));
        }
      });

      await test.step("Proceed to payment", async () => {
        await posPage.proceedToPayment();
        await expect(posPage.page).toHaveURL(/\/pos\/ui\/\d+\/payment\//);
      });

      await test.step("Pay in full with cash and validate", async () => {
        await posPage.payWithCashAndValidate();
      });

      await test.step("Receipt screen confirms the sale", async () => {
        await expect(posPage.page).toHaveURL(/\/pos\/ui\/\d+\/receipt\//);
        await expect(
          posPage.paymentSuccessfulBanner,
          "receipt screen should report a successful payment",
        ).toBeVisible();
        for (const line of scenario.lines) {
          await expect(
            posPage.orderLine(line.product),
            `receipt should itemise ${line.product}`,
          ).toBeVisible();
        }
      });

      await test.step("Email the receipt — UI confirms it was sent", async () => {
        await posPage.emailReceipt(recipient);
        await expect(
          posPage.receiptSentBanner,
          "receipt screen should confirm the email was sent",
        ).toBeVisible();
      });

      await test.step("Receipt email actually left Odoo — captured by MailHog", async () => {
        // Poll the SMTP sink: delivery is near-instant but asynchronous to the
        // UI confirmation, so we retry the lookup until the message lands
        // (bounded by Playwright's expect timeout) rather than asserting once.
        let captured: MailhogMessage[] = [];
        await expect
          .poll(
            async () => {
              captured = await mailhog.searchByRecipient(recipient);
              return captured.length;
            },
            {
              message: `MailHog should capture exactly one email to ${recipient}`,
              timeout: 15_000,
            },
          )
          .toBe(1);

        // Not just *an* email — verify it is genuinely THIS shop's receipt.
        const [message] = captured;
        expect(message.to, "captured email recipient").toContain(recipient);
        expect(message.subject, "captured email should be the shop's receipt").toContain(
          scenario.shop,
        );
        expect(message.subject, "subject should name a receipt").toMatch(/receipt/i);
      });

      await test.step("Start a new order (clean state for the next test)", async () => {
        await posPage.startNewOrder();
        await expect(posPage.page).toHaveURL(/\/pos\/ui\/\d+\/product\//);
      });
    });
  }
});
