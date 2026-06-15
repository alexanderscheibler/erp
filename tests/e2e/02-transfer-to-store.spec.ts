import { test, expect } from "@fixtures/test-fixtures";
import { transferScenarios } from "../data/transfer-scenarios";
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
 * Spec 02: Transfer to Store — Happy Path
 *
 * Business flow: stock sitting in the central warehouse (`WH/Stock`) is moved
 * to a retail store shelf via an Internal Transfer, then validated so the move
 * reaches the Done state.
 *
 * Mirrors the Company flow: central warehouse → retail store replenishment, the
 * step between "Receive Inventory" (spec 01) and "POS Checkout" (spec 03).
 *
 * Design notes (same conventions as spec 01):
 * - Data-driven: every case in `transferScenarios` becomes its own test.
 * - Fully independent: each test opens the app and creates its own transfer
 *   (own source/destination/lines), so tests run in any order / in parallel.
 * - Locators follow the role-first hierarchy; assertions are native
 *   auto-retrying Playwright matchers only (no raw `assert`, no fixed waits).
 *
 * Database verification (the source of truth):
 * - On-hand is measured per *location subtree*, because in Odoo a parent
 *   location's stock aggregates its children (quants live in leaf locations).
 * - `WH/Stock/Shelf 2` is a child of `WH/Stock`, so this move stays *inside*
 *   the WH/Stock subtree. The correct expectations are therefore:
 *     • the destination (Shelf 2) subtree GAINS the moved qty, and
 *     • the WH/Stock subtree is CONSERVED (net 0) — nothing leaves the
 *       warehouse; it's an internal reshuffle.
 *   (Asserting the exact WH/Stock node drops by the qty is wrong: Odoo often
 *   reserves from a sub-location, so that node's own quant may not change.)
 * - No waits needed: the UI reaching "Done" means Odoo committed the transfer,
 *   and PostgREST reads that same DB.
 */

test.describe("Transfer Stock from Warehouse to Store — Happy Path", () => {
  for (const scenario of transferScenarios) {
    test(`${scenario.id} | ${scenario.title}`, async ({ inventoryPage, db }) => {
      const { page } = inventoryPage;

      // --- DB snapshot BEFORE the UI flow -----------------------------------
      // Resolve both endpoints and record current on-hand per product at each,
      // so we can assert the exact (mirrored) deltas after the transfer is Done.
      const source = await getLocationByPath(db, scenario.source);
      const destination = await getLocationByPath(db, scenario.destination);
      let sourceBefore = new Map<number, number>();
      let destBefore = new Map<number, number>();
      await test.step("Snapshot on-hand at source and destination subtrees", async () => {
        sourceBefore = await getOnHandBySubtree(db, source);
        destBefore = await getOnHandBySubtree(db, destination);
      });

      await test.step("Open the Inventory app", async () => {
        await inventoryPage.open();
        await expect(page).toHaveURL(/\/odoo\/inventory/);
      });

      await test.step("Navigate to Internal Transfers", async () => {
        await inventoryPage.goToInternalTransfers();
        await expect(page).toHaveURL(/\/odoo\/internal/);
        await expect(
          page.getByRole("button", { name: "New" }),
          "Internal Transfers list should expose the New button",
        ).toBeVisible();
      });

      let reference = "";
      await test.step("Create the internal transfer and capture its reference", async () => {
        reference = await inventoryPage.createInternalTransfer(
          scenario.source,
          scenario.destination,
          scenario.lines,
        );
        // No tautological title re-check: createInternalTransfer already read
        // this reference off the saved record's own heading. The reference's
        // existence, UNIQUENESS, and that this transfer moved the right
        // products/quantities are proven against the database below.
      });

      await test.step("Transfer starts in Draft state", async () => {
        await expect(
          page.getByRole("radio", { name: "Draft" }),
          "A freshly saved transfer should be in Draft",
        ).toBeChecked();
      });

      await test.step("Validate the transfer", async () => {
        await inventoryPage.validateTransfer();
      });

      await test.step("Transfer is in Done state", async () => {
        await expect(
          page.getByRole("radio", { name: "Done" }),
          "Transfer should be in Done state after validation",
        ).toBeChecked();
      });

      // --- DB verification AFTER the UI flow --------------------------------
      // The UI now says Done; assert the database agrees and stock actually
      // moved from source to destination.
      await test.step("Database reflects the validated transfer", async () => {
        const picking = await getPickingByReference(db, reference);
        const moves = await getMovesForPicking(db, picking.id);

        // Header record: persisted as Done, moving from source → destination.
        expect(picking.state, "stock_picking.state in DB").toBe("done");
        expect(picking.location_id, "transfer source location").toBe(source.id);
        expect(picking.location_dest_id, "transfer destination location").toBe(destination.id);

        // One move per demanded line (current scenarios use distinct products).
        expect(moves.length, "one stock_move per transfer line").toBe(scenario.lines.length);

        // EXACT product identity + quantity: resolve each line's stable key
        // (default_code) → product_id, sum demanded qty per product, and require
        // the DB moves to match that {product_id: qty} map exactly. Proves the
        // right product moved the right quantity, not just matching totals.
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

        // Each line fully moved: done quantity == demand, and move is Done.
        for (const move of moves) {
          expect(move.state, `move ${move.id} state`).toBe("done");
          expect(Number(move.quantity), `move ${move.id}: done qty should equal demand`).toBe(
            Number(move.product_uom_qty),
          );
        }

        // Movement is recorded on every stock_move regardless of product type
        // (consumables included): assert each move physically routes from inside
        // the source subtree to inside the destination subtree. (A move's
        // location may be the parent node while putaway lands the goods in a
        // child, so we check subtree membership, not exact equality.)
        const sourceIds = new Set(await getSubtreeLocationIds(db, source));
        const destIds = new Set(await getSubtreeLocationIds(db, destination));
        for (const move of moves) {
          expect(
            sourceIds.has(move.location_id),
            `move ${move.id} source should be within ${scenario.source}`,
          ).toBe(true);
          expect(
            destIds.has(move.location_dest_id),
            `move ${move.id} destination should be within ${scenario.destination}`,
          ).toBe(true);
        }

        // On-hand (stock_quant) verification — ONLY for inventory-tracked
        // (storable) products. Consumables never create quant rows, so their
        // on-hand is structurally 0 and asserting a delta on them is invalid.
        // Source and destination are disjoint sibling shelves, so for storable
        // products this is the real before/after proof:
        //  • the destination (Shelf 2) subtree GAINS exactly the moved qty, and
        //  • the source (Shelf A) subtree LOSES exactly the moved qty.
        const movedByProduct = sumMovesByProduct(moves);
        const storable = await getStorabilityByProduct(db, [...movedByProduct.keys()]);
        const sourceAfter = await getOnHandBySubtree(db, source);
        const destAfter = await getOnHandBySubtree(db, destination);
        for (const [productId, movedQty] of movedByProduct) {
          if (!storable.get(productId)) continue; // consumable: no on-hand to check
          const srcDelta =
            (sourceAfter.get(productId) ?? 0) - (sourceBefore.get(productId) ?? 0);
          const dstDelta = (destAfter.get(productId) ?? 0) - (destBefore.get(productId) ?? 0);
          expect(
            dstDelta,
            `destination ${scenario.destination} subtree delta for product ${productId}`,
          ).toBe(movedQty);
          expect(
            srcDelta,
            `source ${scenario.source} subtree delta for product ${productId}`,
          ).toBe(-movedQty);
        }
      });
    });
  }
});
