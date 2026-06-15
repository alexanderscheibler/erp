import { test, expect } from "@fixtures/test-fixtures";
import { receiptScenarios } from "../data/receipt-scenarios";
import {
  getLocationByPath,
  getSubtreeLocationIds,
  getOnHandBySubtree,
  getStorabilityByProduct,
  getProductByDefaultCode,
  getPickingByReference,
  getMovesForPicking,
  sumMovesByProduct,
} from "@utils/db";

/** Sorted [product_id, qty] pairs — stable shape for comparing maps with toEqual. */
const normalize = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]);

/**
 * Spec 01: Receive Inventory — Happy Path
 *
 * Business flow: a vendor shipment arrives at the warehouse. The operator
 * creates a receipt, fills the demand line(s), saves, and validates so the
 * stock lands in WH/Stock (status → Done).
 *
 * Mirrors the Company incoming-shipment flow: goods accepted into the central
 * warehouse before distribution to retail stores.
 *
 * Design notes:
 * - Data-driven: every case in `receiptScenarios` becomes its own test.
 * - Fully independent: each test opens the app and creates its own receipt,
 *   so tests can run in any order / in parallel with no shared state.
 * - Locators follow the role-first hierarchy; assertions are native
 *   auto-retrying Playwright matchers only (no raw `assert`, no fixed waits).
 *
 * Database verification (the source of truth):
 * - We don't only trust the Odoo UI. Around the UI flow we snapshot the
 *   warehouse on-hand from the DB (via PostgREST), then after validation we
 *   read the persisted picking + moves and assert the DB changed correctly:
 *   the receipt is Done, each line was fully received, and on-hand at WH/Stock
 *   increased by exactly the received quantity per product.
 */

/** Receipts deposit stock into this location. */
const STOCK_LOCATION = "WH/Stock";

test.describe("Receive Inventory into Warehouse — Happy Path", () => {
  for (const scenario of receiptScenarios) {
    test(`${scenario.id} | ${scenario.title}`, async ({ inventoryPage, db }) => {
      const { page } = inventoryPage;

      // --- DB snapshot BEFORE the UI flow -----------------------------------
      // Resolve the destination location once and record current on-hand per
      // product, so we can assert the exact delta after the receipt is Done.
      // Measure the WH/Stock *subtree* (the location + all sub-locations): in
      // Odoo a parent location's on-hand aggregates its children, and putaway
      // may route received goods into a sub-location, so the exact WH/Stock
      // node alone would understate the change.
      const stock = await getLocationByPath(db, STOCK_LOCATION);
      let onHandBefore = new Map<number, number>();
      await test.step("Snapshot warehouse on-hand before receiving", async () => {
        onHandBefore = await getOnHandBySubtree(db, stock);
      });

      await test.step("Open the Inventory app", async () => {
        await inventoryPage.open();
        // Checkpoint: the Inventory app actually loaded.
        await expect(page).toHaveURL(/\/odoo\/inventory/);
      });

      await test.step("Navigate to Receipts", async () => {
        await inventoryPage.goToReceipts();
        // Checkpoint: the Receipts list is in view.
        await expect(page).toHaveURL(/\/odoo\/receipts/);
        await expect(
          page.getByRole("button", { name: "New" }),
          "Receipts list should expose the New button",
        ).toBeVisible();
      });

      let reference = "";
      await test.step("Create the receipt and capture its reference", async () => {
        reference = await inventoryPage.createReceipt(scenario.lines);
        // No tautological title re-check here: createReceipt already read this
        // reference off the saved record's own heading, so re-asserting the
        // heading shows it can never fail. Whether the reference is real,
        // UNIQUE, and attached to a receipt holding the right products and
        // quantities is proven against the database in the verification step.
      });

      await test.step("Receipt starts in Draft state", async () => {
        // Checkpoint before the state transition: status bar shows Draft.
        await expect(
          page.getByRole("radio", { name: "Draft" }),
          "A freshly saved receipt should be in Draft",
        ).toBeChecked();
      });

      await test.step("Validate the receipt", async () => {
        await inventoryPage.validateReceipt();
      });

      await test.step("Receipt is in Done state", async () => {
        await expect(
          page.getByRole("radio", { name: "Done" }),
          "Receipt should be in Done state after validation",
        ).toBeChecked();
      });

      // --- DB verification AFTER the UI flow --------------------------------
      // The UI now says Done; assert the database agrees and changed correctly.
      await test.step("Database reflects the validated receipt", async () => {
        // AUTHORITATIVE reference verification: look the record up by the exact
        // reference the UI gave us. `getPickingByReference` uses `.single()`,
        // which fails unless EXACTLY ONE persisted receipt carries that name —
        // so this proves the captured reference is real and unique, not merely
        // WH/IN-shaped. (A wrong/garbage reference → 0 rows → hard failure.)
        const picking = await getPickingByReference(db, reference);
        const moves = await getMovesForPicking(db, picking.id);

        // Header record: persisted as Done, landing into WH/Stock.
        expect(picking.state, "stock_picking.state in DB").toBe("done");
        expect(picking.location_dest_id, "receipt destination should be WH/Stock").toBe(stock.id);

        // One move per demanded line (current scenarios use distinct products;
        // Odoo would merge same-product lines into one move).
        expect(moves.length, "one stock_move per receipt line").toBe(scenario.lines.length);

        // EXACT product identity + quantity. Resolve each line's stable key
        // (default_code) → product_id and sum the demanded qty per product,
        // then require the DB moves to match that {product_id: qty} map exactly.
        // This proves the RIGHT variant got the RIGHT quantity (e.g. White=5,
        // Black=3) — not merely that the totals happen to line up.
        const expectedByProduct = new Map<number, number>();
        for (const line of scenario.lines) {
          expect(
            line.defaultCode,
            `scenario line "${line.product}" needs a defaultCode for identity verification`,
          ).toBeTruthy();
          const product = await getProductByDefaultCode(db, line.defaultCode!);
          expectedByProduct.set(
            product.id,
            (expectedByProduct.get(product.id) ?? 0) + line.quantity,
          );
        }
        expect(
          normalize(sumMovesByProduct(moves)),
          "DB moves must match the expected {product_id: quantity} exactly",
        ).toEqual(normalize(expectedByProduct));

        // Each line fully received: done quantity == demand, and move is Done.
        for (const move of moves) {
          expect(move.state, `move ${move.id} state`).toBe("done");
          expect(Number(move.quantity), `move ${move.id}: done qty should equal demand`).toBe(
            Number(move.product_uom_qty),
          );
        }

        // Movement is recorded on every stock_move regardless of product type:
        // assert each move lands inside the WH/Stock subtree (putaway may route
        // goods into a sub-location, so we check subtree membership).
        const stockIds = new Set(await getSubtreeLocationIds(db, stock));
        for (const move of moves) {
          expect(
            stockIds.has(move.location_dest_id),
            `move ${move.id} destination should be within ${STOCK_LOCATION}`,
          ).toBe(true);
        }

        // On-hand (stock_quant) verification — ONLY for inventory-tracked
        // (storable) products. Consumables never create quant rows, so their
        // on-hand is structurally 0 and a delta assertion on them is invalid.
        // For storable products this is the real proof: warehouse on-hand
        // (WH/Stock subtree) increased by exactly the received amount.
        // Exact deltas are safe: fullyParallel=false runs tests within a file
        // serially, and these products' quant rows are disjoint from other
        // spec files'. (If fullyParallel is turned on, the White variant shared
        // by TC-01/TC-02 would need a looser `>=` check.)
        const movedByProduct = sumMovesByProduct(moves);
        const storable = await getStorabilityByProduct(db, [...movedByProduct.keys()]);
        const onHandAfter = await getOnHandBySubtree(db, stock);
        for (const [productId, movedQty] of movedByProduct) {
          if (!storable.get(productId)) continue; // consumable: no on-hand to check
          const before = onHandBefore.get(productId) ?? 0;
          const after = onHandAfter.get(productId) ?? 0;
          expect(
            after - before,
            `on-hand delta for product ${productId} in ${STOCK_LOCATION} subtree`,
          ).toBe(movedQty);
        }
      });
    });
  }
});
