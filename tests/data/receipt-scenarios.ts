import { type ReceiptLine } from "../pages/InventoryPage";

/**
 * Parameterized data for the "Receive Inventory" happy path.
 *
 * Each scenario drives one fully independent test (own receipt, own state).
 * Add a new object here to get a new test case for free — no code changes
 * needed in the spec.
 *
 * IMPORTANT: every `product` listed below must already exist in the target
 * Odoo database AND be of type "consu" (the receipt line domain filters to
 * `[('type', '=', 'consu')]`). The standard Odoo demo data ships these.
 */
export interface ReceiptScenario {
  /** Stable test-case id surfaced in the report title (e.g. "TC-01"). */
  id: string;
  /** Human-readable description of the business case under test. */
  title: string;
  /** One or more product lines to receive in a single receipt. */
  lines: ReceiptLine[];
}

// Product names below are the exact variant labels confirmed to exist in the
// target DB via live exploration (the plain "Acoustic Bloc Screens" is not a
// sellable product — only its White/Black variants are).
const SCREENS_SEARCH = "Acoustic Bloc Screens";

export const receiptScenarios: ReceiptScenario[] = [
  {
    id: "TC-01",
    title: "Receive a single product line and confirm Done state",
    lines: [
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (White)", quantity: 10 },
    ],
  },
  {
    id: "TC-02",
    title: "Receive a different quantity of the same product",
    lines: [
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (White)", quantity: 25 },
    ],
  },
  {
    id: "TC-03",
    title: "Receive multiple product lines in one receipt",
    lines: [
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (White)", quantity: 5 },
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (Black)", quantity: 3 },
    ],
  },
];
