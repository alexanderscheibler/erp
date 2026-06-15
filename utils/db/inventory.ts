/**
 * Inventory verification helpers (example layer over the generic client).
 *
 * These are thin, intention-revealing functions that read the *source of
 * truth* (the Odoo database via PostgREST) for the entities exercised by the
 * E2E specs:
 *   - 01-receive-inventory.spec.ts  → receipts (WH/IN/*) landing stock in WH/Stock
 *   - 02-transfer-to-store.spec.ts  → internal transfers (WH/INT/*) moving stock
 *                                      WH/Stock → WH/Stock/Shelf 2
 *
 * The intended pattern (the UI flow itself stays in Playwright):
 *   1. snapshot on-hand qty before the test          (getOnHandQty)
 *   2. [Playwright drives the receipt/transfer to Done]
 *   3. snapshot on-hand qty after, and read the persisted record
 *      (getPickingByReference + getMovesForPicking) to confirm the DB matches
 *      what the UI claimed.
 *
 * Odoo specifics handled here:
 * - Product display names live on `product_template.name`, which is a
 *   *translatable jsonb* column ({"en_US": "..."}) — filtered via `name->>en_US`.
 * - A variant (e.g. "(White)" vs "(Black)") is a `product_product` row; the
 *   stable, unambiguous key is its `default_code` (internal reference).
 * - On-hand quantity is split across multiple `stock_quant` rows (per lot /
 *   package / owner), so it must be summed.
 */

import { PostgrestClient } from "./postgrest-client";

// ---------------------------------------------------------------------------
// Row shapes (only the columns these helpers use; extend as needed).
// ---------------------------------------------------------------------------

export interface StockLocation {
  id: number;
  complete_name: string;
  /**
   * Odoo's materialized path of ancestor ids, e.g. "1/5/8/" (trailing slash).
   * Every descendant's `parent_path` starts with this prefix, so it's the key
   * to summing on-hand over a whole location subtree (see getOnHandBySubtree).
   */
  parent_path: string;
}

export interface ProductVariant {
  id: number;
  default_code: string | null;
  product_tmpl_id: number;
}

export interface StockPicking {
  id: number;
  name: string;
  state: string; // draft | waiting | confirmed | assigned | done | cancel
  location_id: number;
  location_dest_id: number;
  date_done: string | null;
}

export interface StockMove {
  id: number;
  product_id: number;
  state: string;
  product_uom_qty: number; // demand
  quantity: number; // done / actually moved
  location_id: number;
  location_dest_id: number;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Resolve a location by its full path (Odoo's `complete_name`),
 * e.g. "WH/Stock" or "WH/Stock/Shelf 2". Throws if not exactly one matches.
 */
export async function getLocationByPath(
  db: PostgrestClient,
  completeName: string,
): Promise<StockLocation> {
  return db
    .from<StockLocation>("stock_location")
    .select("id,complete_name,parent_path")
    .eq("complete_name", completeName)
    .single();
}

/**
 * Resolve a product *variant* by its internal reference (`default_code`),
 * e.g. "E-COM10" (Pedal Bin) or "CONS_0001" (Whiteboard Pen). This is the
 * reliable key when a template has multiple variants. Throws if not unique.
 */
export async function getProductByDefaultCode(
  db: PostgrestClient,
  defaultCode: string,
): Promise<ProductVariant> {
  return db
    .from<ProductVariant>("product_product")
    .select("id,default_code,product_tmpl_id")
    .eq("default_code", defaultCode)
    .single();
}

/**
 * Find product variants whose template name matches (case-insensitive,
 * substring) the given text — handy when you only know the display name.
 *
 * Returns *all* matching variants (a template like "Acoustic Bloc Screens"
 * expands to White/Black variants), so the caller disambiguates. Use
 * `getProductByDefaultCode` when you need exactly one.
 *
 * Implemented as two clear steps rather than an embedded-resource filter:
 * find the template id(s) by translatable name, then the variants under them.
 */
export async function findProductsByName(
  db: PostgrestClient,
  name: string,
): Promise<ProductVariant[]> {
  const templates = await db
    .from<{ id: number }>("product_template")
    // `name` is translatable jsonb → read/filter the en_US key.
    .select("id,name->>en_US")
    .ilike("name->>en_US", `*${name}*`);

  if (templates.length === 0) return [];

  return db
    .from<ProductVariant>("product_product")
    .select("id,default_code,product_tmpl_id")
    .in(
      "product_tmpl_id",
      templates.map((t) => t.id),
    );
}

// ---------------------------------------------------------------------------
// Stock state
// ---------------------------------------------------------------------------

/**
 * On-hand quantity of a product at a location, summed across all quant rows
 * (lots / packages / owners). Returns 0 when the product has never been
 * stocked there (no quant rows yet).
 *
 * This is the core "before vs after" metric: snapshot it around the Playwright
 * flow to prove a receipt added stock, or a transfer moved it.
 *
 * @param productId  product_product.id (the variant)
 * @param locationId stock_location.id
 */
export async function getOnHandQty(
  db: PostgrestClient,
  productId: number,
  locationId: number,
): Promise<number> {
  const quants = await db
    .from<{ quantity: number }>("stock_quant")
    .select("quantity")
    .eq("product_id", productId)
    .eq("location_id", locationId);

  // numeric values may arrive as number or string depending on driver; coerce.
  return quants.reduce((sum, q) => sum + Number(q.quantity ?? 0), 0);
}

/**
 * Read a transfer/receipt record by its reference (`name`), e.g. "WH/IN/00001"
 * or "WH/INT/00007". Throws if the reference is not unique/absent — exactly
 * what we want, since the spec captured a concrete reference. Use the returned
 * `state` to confirm it reached "done" in the DB, not just in the UI.
 */
export async function getPickingByReference(
  db: PostgrestClient,
  reference: string,
): Promise<StockPicking> {
  return db
    .from<StockPicking>("stock_picking")
    .select("id,name,state,location_id,location_dest_id,date_done")
    .eq("name", reference)
    .single();
}

/**
 * The stock moves (demand lines) for a picking. Compare `product_uom_qty`
 * (demanded) against `quantity` (actually moved) and check each `state` to
 * verify the validated transfer persisted the expected quantities per product.
 */
export async function getMovesForPicking(
  db: PostgrestClient,
  pickingId: number,
): Promise<StockMove[]> {
  return db
    .from<StockMove>("stock_move")
    .select("id,product_id,state,product_uom_qty,quantity,location_id,location_dest_id")
    .eq("picking_id", pickingId)
    .order("id", "asc");
}

/**
 * On-hand snapshot for an *entire location*: a map of `product_id → summed
 * on-hand quantity` across all quant rows (lots / packages / owners) at that
 * location.
 *
 * This is the snapshot primitive for the before/after pattern: you don't need
 * to know the product ids up front — capture the whole location before the UI
 * flow, capture it again after, then diff per product (the moves tell you which
 * product ids changed). Products with no quant row simply won't be keys (treat
 * a missing key as 0).
 *
 * @param locationId stock_location.id
 */
export async function getOnHandByLocation(
  db: PostgrestClient,
  locationId: number,
): Promise<Map<number, number>> {
  const quants = await db
    .from<{ product_id: number; quantity: number }>("stock_quant")
    .select("product_id,quantity")
    .eq("location_id", locationId);

  const byProduct = new Map<number, number>();
  for (const q of quants) {
    const prev = byProduct.get(q.product_id) ?? 0;
    byProduct.set(q.product_id, prev + Number(q.quantity ?? 0));
  }
  return byProduct;
}

/**
 * IDs of a location and *all* its descendants (the subtree), via Odoo's
 * `parent_path`. Every node under `location` has a `parent_path` that begins
 * with the node's own `parent_path` prefix; the node itself is included.
 *
 * Why this matters: in Odoo a parent location's on-hand is the aggregate of
 * itself plus its children, and stock physically lives in leaf locations. A
 * transfer "from WH/Stock" can reserve from a child sub-location, so checking
 * only the WH/Stock node's exact quant row misses the movement. Sum over the
 * subtree instead.
 */
export async function getSubtreeLocationIds(
  db: PostgrestClient,
  location: StockLocation,
): Promise<number[]> {
  const rows = await db
    .from<{ id: number }>("stock_location")
    // `*` is PostgREST's LIKE wildcard → matches the node and all descendants.
    .select("id")
    .like("parent_path", `${location.parent_path}*`);
  return rows.map((r) => r.id);
}

/**
 * On-hand snapshot for an entire location *subtree* (the location + every
 * descendant), as `product_id → summed on-hand quantity`.
 *
 * This is the correct "on-hand at WH/Stock" measure for hierarchical
 * locations. Use it for the before/after diff:
 * - Receipt: the destination subtree (e.g. WH/Stock) gains the received qty,
 *   regardless of which sub-location putaway routes goods into.
 * - Internal transfer within a subtree (WH/Stock → WH/Stock/Shelf 2): the
 *   *whole* WH/Stock subtree is conserved (net 0), while the Shelf 2 subtree
 *   gains the moved qty.
 */
export async function getOnHandBySubtree(
  db: PostgrestClient,
  location: StockLocation,
): Promise<Map<number, number>> {
  const locationIds = await getSubtreeLocationIds(db, location);
  if (locationIds.length === 0) return new Map();

  const quants = await db
    .from<{ product_id: number; quantity: number }>("stock_quant")
    .select("product_id,quantity")
    .in("location_id", locationIds);

  const byProduct = new Map<number, number>();
  for (const q of quants) {
    const prev = byProduct.get(q.product_id) ?? 0;
    byProduct.set(q.product_id, prev + Number(q.quantity ?? 0));
  }
  return byProduct;
}

/**
 * Aggregate move-like rows into `product_id → total done quantity`. Pure (no
 * I/O). Accepts anything carrying `product_id` + `quantity` (e.g. StockMove).
 * Pair with two on-hand snapshots to assert the exact per-product stock delta.
 */
export function sumMovesByProduct(
  moves: Array<{ product_id: number; quantity: number }>,
): Map<number, number> {
  const byProduct = new Map<number, number>();
  for (const m of moves) {
    const prev = byProduct.get(m.product_id) ?? 0;
    byProduct.set(m.product_id, prev + Number(m.quantity ?? 0));
  }
  return byProduct;
}

/**
 * Whether each product is inventory-tracked (`is_storable`). Returns a map of
 * `product_id → boolean`.
 *
 * Critical for on-hand assertions: in Odoo only storable products keep
 * `stock_quant` rows. A *consumable* (is_storable=false) records its moves as
 * `done` but never changes on-hand — so its on-hand delta is structurally 0 and
 * must NOT be asserted. Use this to gate on-hand checks.
 *
 * Resolved in two plain steps (product_product → product_template) to avoid
 * relying on embedded-resource behaviour.
 */
export async function getStorabilityByProduct(
  db: PostgrestClient,
  productIds: number[],
): Promise<Map<number, boolean>> {
  const result = new Map<number, boolean>();
  if (productIds.length === 0) return result;

  const products = await db
    .from<{ id: number; product_tmpl_id: number }>("product_product")
    .select("id,product_tmpl_id")
    .in("id", productIds);

  const tmplIds = [...new Set(products.map((p) => p.product_tmpl_id))];
  const templates = await db
    .from<{ id: number; is_storable: boolean }>("product_template")
    .select("id,is_storable")
    .in("id", tmplIds);

  const storableByTmpl = new Map(templates.map((t) => [t.id, Boolean(t.is_storable)]));
  for (const p of products) {
    result.set(p.id, storableByTmpl.get(p.product_tmpl_id) ?? false);
  }
  return result;
}
