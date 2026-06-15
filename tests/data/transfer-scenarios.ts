import { type ReceiptLine } from "../pages/InventoryPage";

/**
 * Parameterized data for the "Transfer to Store" (internal transfer) happy path.
 *
 * Each scenario drives one fully independent test: a new internal transfer
 * moving stock from the warehouse to a store shelf, then validated to Done.
 *
 * Environment prerequisites:
 * - Storage Locations enabled → Operation type "Internal Transfers" exists.
 * - Locations (full paths) used here: `WH/Stock/Shelf A` (source) and
 *   `WH/Stock/Shelf 2` (destination) — two *disjoint* sibling shelves, so the
 *   move never reserves from its own destination and the on-hand deltas are
 *   unambiguous (source loses the qty, destination gains it).
 * - Products: `[E-COM10] Pedal Bin`, `[CONS_0001] Whiteboard Pen` — both must
 *   exist in the target DB.
 * Each `product` is the exact label selected from the dropdown; `search` is the
 * (shorter) term typed first, then the exact label is picked (same lesson as
 * the receipt variants).
 */
export type TransferLine = ReceiptLine;

export interface TransferScenario {
  /** Stable test-case id surfaced in the report title (e.g. "TC-01"). */
  id: string;
  /** Human-readable description of the business case under test. */
  title: string;
  /** Source location (full path). */
  source: string;
  /** Destination store location (full path). */
  destination: string;
  /** One or more product lines to transfer. */
  lines: TransferLine[];
}

export const transferScenarios: TransferScenario[] = [
  {
    id: "TC-01",
    title: "Transfer 3 each of Pedal Bin and Whiteboard Pen from Shelf A to Shelf 2",
    source: "WH/Stock/Shelf A",
    destination: "WH/Stock/Shelf 2",
    lines: [
      // `defaultCode` is the stable key the DB assertions bind to (the bracketed
      // internal reference shown in Odoo, e.g. "[E-COM10] Pedal Bin").
      { search: "Pedal Bin", product: "Pedal Bin", quantity: 3, defaultCode: "E-COM10" },
      { search: "Whiteboard Pen", product: "Whiteboard Pen", quantity: 3, defaultCode: "CONS_0001" },
    ],
  },
];
