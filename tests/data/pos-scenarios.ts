/**
 * Parameterized data for the "POS Checkout" happy path.
 *
 * Each scenario drives one fully independent test: open the shop's register,
 * ring up one or more product lines for cash, reach the receipt, and email it.
 * Add an object here to get a new test case for free — no spec changes needed.
 *
 * Coverage spans BOTH retail registers, single + multi-unit, AND multi-product
 * orders:
 *   - Furniture Shop sells the supply-chain products from specs 01/02 (Pedal
 *     Bin was transferred to the store in spec 02), so selling here closes the
 *     receive → transfer → sell loop end-to-end.
 *   - Bakery Shop is a second, independent register/catalogue.
 *
 * Environment prerequisites (verified live against the running instance):
 * - The named `shop` exists on the POS dashboard (`/odoo/point-of-sale`) as a
 *   register card with an "Open Register" / "Continue Selling" button.
 * - Every `product` is sellable in that shop's POS AND has NO variants /
 *   optional attributes, so clicking its tile adds it directly without opening
 *   a product-configurator popup. (This is why we use "Pedal Bin" rather than
 *   "Acoustic Bloc Screens", which is a configurable template.)
 */

/** One order line: a product and how many units to sell. */
export interface PosLine {
  /** Exact sellable product label (the product-tile accessible name). */
  product: string;
  /** Quantity to sell. */
  quantity: number;
}

export interface PosScenario {
  /** Stable test-case id surfaced in the report title (e.g. "TC-01"). */
  id: string;
  /** Human-readable description of the business case under test. */
  title: string;
  /** POS register/shop name as shown on the dashboard card. */
  shop: string;
  /** One or more product lines rung up in a single order. */
  lines: PosLine[];
}

export const posScenarios: PosScenario[] = [
  {
    id: "TC-01",
    title: "Furniture Shop — sell a single Pedal Bin for cash",
    shop: "Furniture Shop",
    lines: [{ product: "Pedal Bin", quantity: 1 }],
  },
  {
    id: "TC-02",
    title: "Furniture Shop — sell multiple units of a single product",
    shop: "Furniture Shop",
    lines: [{ product: "Whiteboard Pen", quantity: 4 }],
  },
  {
    id: "TC-03",
    title: "Furniture Shop — sell two different products with different units",
    shop: "Furniture Shop",
    lines: [
      { product: "Pedal Bin", quantity: 1 },
      { product: "Whiteboard Pen", quantity: 2 },
    ],
  },
  {
    id: "TC-04",
    title: "Bakery Shop — sell a single product for cash",
    shop: "Bakery Shop",
    lines: [{ product: "Butter Croissant", quantity: 1 }],
  },
  {
    id: "TC-05",
    title: "Bakery Shop — sell multiple units of a single product",
    shop: "Bakery Shop",
    lines: [{ product: "Sourdough Loaf", quantity: 3 }],
  },
];
