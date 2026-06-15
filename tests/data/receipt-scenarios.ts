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

// Stable DB keys (Odoo internal reference / default_code) for the two variants,
// confirmed via live query against the target DB:
//   White → FURN_6666 (product_product id 37)
//   Black → FURN_6667 (product_product id 38)
// The UI selects by the `product` label; the DB assertions bind by these codes.
const SCREENS_WHITE = "FURN_6666";
const SCREENS_BLACK = "FURN_6667";

export const receiptScenarios: ReceiptScenario[] = [
  {
    id: "TC-01",
    title: "Receive a single product line and confirm Done state",
    lines: [
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (White)", quantity: 10, defaultCode: SCREENS_WHITE },
    ],
  },
  {
    id: "TC-02",
    title: "Receive a different quantity of the same product",
    lines: [
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (White)", quantity: 25, defaultCode: SCREENS_WHITE },
    ],
  },
  {
    id: "TC-03",
    title: "Receive multiple product lines in one receipt",
    lines: [
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (White)", quantity: 5, defaultCode: SCREENS_WHITE },
      { search: SCREENS_SEARCH, product: "Acoustic Bloc Screens (Black)", quantity: 3, defaultCode: SCREENS_BLACK },
    ],
  },
];
